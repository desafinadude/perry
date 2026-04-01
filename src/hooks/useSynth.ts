import { useState, useRef, useCallback, useEffect } from 'react'
import type { Preset, LoadedFont, Zone } from '../types'

type InitStatus = 'idle' | 'loading' | 'ready' | 'error'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySynth = any

function parsePresets(list: AnySynth[]): Preset[] {
  return list
    .map((p: AnySynth) => ({
      bank: p.bankMSB,
      program: p.program,
      name: p.name,
      isDrum: !!p.isAnyDrums,
    }))
    .sort((a, b) => Number(a.isDrum) - Number(b.isDrum) || a.bank - b.bank || a.program - b.program)
}

function firstMelodicPreset(presets: Preset[]) {
  return presets.find((p) => !p.isDrum) ?? presets[0]
}

export function useSynth() {
  const [status, setStatus] = useState<InitStatus>('loading')
  const [loadProgress, setLoadProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [fonts, setFonts] = useState<LoadedFont[]>([])
  const [isLoadingDefault, setIsLoadingDefault] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  // Map fontId → WorkletSynthesizer instance
  const synthMapRef = useRef<Map<string, AnySynth>>(new Map())
  const workletLoadedRef = useRef(false)

  // ── Audio context / worklet bootstrap ──────────────────────────────────────
  const ensureAudio = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    await ctx.resume()
    return ctx
  }, [])

  const ensureWorklet = useCallback(async (ctx: AudioContext) => {
    if (workletLoadedRef.current) return
    await ctx.audioWorklet.addModule('/spessasynth_processor.min.js')
    workletLoadedRef.current = true
  }, [])

  // ── Core: create one synth for one font buffer ──────────────────────────────
  const createFontSynth = useCallback(async (
    buffer: ArrayBuffer,
    fontId: string,
    fontName: string,
    onProgress?: (pct: number) => void,
  ): Promise<LoadedFont> => {
    const { WorkletSynthesizer } = await import('spessasynth_lib')
    const ctx = await ensureAudio()
    await ensureWorklet(ctx)

    const synth = new WorkletSynthesizer(ctx)
    synth.connect(ctx.destination)

    let resolvedPresets: Preset[] = []
    const presetsReady = new Promise<Preset[]>((resolve) => {
      synth.eventHandler.addEvent('presetListChange', fontId, (list: AnySynth[]) => {
        resolvedPresets = parsePresets(list)
        resolve(resolvedPresets)
      })
    })

    await synth.soundBankManager.addSoundBank(buffer, 'main')
    onProgress?.(95)
    await synth.isReady
    onProgress?.(98)

    // Prefer event-driven presets; fall back to direct read
    const presets = resolvedPresets.length > 0
      ? resolvedPresets
      : synth.presetList?.length > 0
        ? parsePresets(synth.presetList)
        : await presetsReady

    onProgress?.(100)
    synthMapRef.current.set(fontId, synth)
    return { id: fontId, name: fontName, presets }
  }, [ensureAudio, ensureWorklet])

  // ── Load an additional / replacement font ────────────────────────────────────
  const loadFont = useCallback(async (
    buffer: ArrayBuffer,
    name: string,
    replaceId?: string,   // if set, replaces that font slot; otherwise adds new
  ): Promise<string> => {
    const fontId = replaceId ?? ('font_' + Date.now())

    // Destroy old synth for this slot
    if (synthMapRef.current.has(fontId)) {
      try { synthMapRef.current.get(fontId)?.destroy?.() } catch {}
      synthMapRef.current.delete(fontId)
    }

    const font = await createFontSynth(buffer, fontId, name)
    setFonts((prev) => {
      const newFonts = replaceId
        ? prev.some(f => f.id === replaceId)
          ? prev.map((f) => f.id === replaceId ? font : f)  // Replace existing
          : [...prev, font]  // Add if not found
        : [...prev, font]  // Add new
      return newFonts
    })
    return fontId
  }, [createFontSynth])

  const removeFont = useCallback((fontId: string) => {
    if (fontId === 'main') return // can't remove the main font
    try { synthMapRef.current.get(fontId)?.destroy?.() } catch {}
    synthMapRef.current.delete(fontId)
    setFonts((prev) => prev.filter((f) => f.id !== fontId))
  }, [])

  // ── Load default font on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (isLoadingDefault) return
    
    setIsLoadingDefault(true)
    setStatus('loading')
    setLoadProgress(0)
    
    fetch('/sf2/default.sf2')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        return res.arrayBuffer()
      })
      .then(buffer => {
        setLoadProgress(50)
        return loadFont(buffer, 'default.sf2', 'main')
      })
      .then(() => {
        setStatus('ready')
        setLoadProgress(100)
      })
      .catch(err => {
        console.error('Failed to load default font:', err)
        setErrorMsg(`Failed to load default font: ${err.message}`)
        setStatus('error')
      })
      .finally(() => {
        setIsLoadingDefault(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Zone operations ─────────────────────────────────────────────────────────
  const applyZone = useCallback((zone: Zone) => {
    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    synth.controllerChange(zone.channel, 0, zone.bank)
    synth.controllerChange(zone.channel, 32, 0)
    synth.programChange(zone.channel, zone.program)
    synth.controllerChange(zone.channel, 7, zone.volume)
  }, [])

  const noteOn = useCallback((zone: Zone, note: number, velocity: number) => {
    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    const ctx = audioCtxRef.current
    if (ctx?.state !== 'running') {
      ctx?.resume().then(() => synth.noteOn(zone.channel, note, velocity))
    } else {
      synth.noteOn(zone.channel, note, velocity)
    }
  }, [])

  const noteOff = useCallback((zone: Zone, note: number) => {
    synthMapRef.current.get(zone.fontId)?.noteOff(zone.channel, note)
  }, [])

  const sendCC = useCallback((zones: Zone[], cc: number, value: number) => {
    const seen = new Set<string>()
    zones.forEach((z) => {
      const key = `${z.fontId}:${z.channel}`
      if (seen.has(key)) return
      seen.add(key)
      synthMapRef.current.get(z.fontId)?.controllerChange(z.channel, cc, value)
    })
  }, [])

  const sendPitchBend = useCallback((zones: Zone[], value: number) => {
    const seen = new Set<string>()
    zones.forEach((z) => {
      const key = `${z.fontId}:${z.channel}`
      if (seen.has(key)) return
      seen.add(key)
      synthMapRef.current.get(z.fontId)?.pitchWheel(z.channel, value)
    })
  }, [])

  // ── Global ──────────────────────────────────────────────────────────────────
  const allNotesOff = useCallback(() => {
    synthMapRef.current.forEach((synth) => {
      for (let ch = 0; ch < 16; ch++) synth.controllerChange(ch, 123, 0)
    })
  }, [])

  return {
    status, loadProgress, errorMsg, fonts,
    loadFont, removeFont,
    applyZone, noteOn, noteOff, sendCC, sendPitchBend,
    allNotesOff,
    firstMelodicPreset,
  }
}
