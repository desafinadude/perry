import { useState, useRef, useCallback } from 'react'
import type { Preset, LoadedFont, Zone } from '../types'

type InitStatus = 'idle' | 'loading' | 'ready' | 'error'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySynth = any

const DRUM_CHANNEL = 9

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
  const [status, setStatus] = useState<InitStatus>('idle')
  const [loadProgress, setLoadProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [fonts, setFonts] = useState<LoadedFont[]>([])

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

  // ── Initial load (font.sf2) ─────────────────────────────────────────────────
  const init = useCallback(async () => {
    if (status === 'loading' || status === 'ready') return
    setStatus('loading')
    setLoadProgress(0)

    try {
      await ensureAudio()
      const response = await fetch('/font.sf2')
      if (!response.ok) throw new Error('Failed to fetch font.sf2')

      const total = parseInt(response.headers.get('content-length') ?? '0')
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (total) setLoadProgress(Math.round((received / total) * 88))
      }
      const buffer = new Uint8Array(received)
      let off = 0
      for (const c of chunks) { buffer.set(c, off); off += c.length }
      setLoadProgress(90)

      const font = await createFontSynth(buffer.buffer, 'main', 'font.sf2', setLoadProgress)
      setFonts([font])
      setStatus('ready')
    } catch (e) {
      console.error(e)
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [status, ensureAudio, createFontSynth])

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
    setFonts((prev) =>
      replaceId
        ? prev.map((f) => f.id === replaceId ? font : f)
        : [...prev, font],
    )
    return fontId
  }, [createFontSynth])

  const removeFont = useCallback((fontId: string) => {
    if (fontId === 'main') return // can't remove the main font
    try { synthMapRef.current.get(fontId)?.destroy?.() } catch {}
    synthMapRef.current.delete(fontId)
    setFonts((prev) => prev.filter((f) => f.id !== fontId))
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

  // ── Drum operations ─────────────────────────────────────────────────────────
  const applyDrums = useCallback((fontId: string, volume: number) => {
    const synth = synthMapRef.current.get(fontId)
    if (!synth) return
    synth.controllerChange(DRUM_CHANNEL, 7, volume)
  }, [])

  const drumNoteOn = useCallback((fontId: string, note: number, velocity: number) => {
    synthMapRef.current.get(fontId)?.noteOn(DRUM_CHANNEL, note, velocity)
  }, [])

  const drumNoteOff = useCallback((fontId: string, note: number) => {
    synthMapRef.current.get(fontId)?.noteOff(DRUM_CHANNEL, note)
  }, [])

  // ── Global ──────────────────────────────────────────────────────────────────
  const allNotesOff = useCallback(() => {
    synthMapRef.current.forEach((synth) => {
      for (let ch = 0; ch < 16; ch++) synth.controllerChange(ch, 123, 0)
    })
  }, [])

  return {
    status, loadProgress, errorMsg, fonts,
    init, loadFont, removeFont,
    applyZone, noteOn, noteOff, sendCC, sendPitchBend,
    applyDrums, drumNoteOn, drumNoteOff,
    allNotesOff,
    firstMelodicPreset,
  }
}
