import { useState, useRef, useCallback, useEffect } from 'react'
import type { Preset, LoadedFont, Zone } from '../types'
import { DEFAULT_EFFECTS, defaultEffects, defaultSynth, defaultSampler } from '../types'
import { EffectsChain } from '../audio/effectsChain'
import { SubtractiveSynth } from '../audio/subtractiveSynth'
import { Sampler, cacheSample } from '../audio/sampler'

type InitStatus = 'idle' | 'loading' | 'ready' | 'error'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySynth = any

/**
 * Effects chains are keyed per soundfont channel (zones sharing a
 * font+channel share one chain — they are literally one audio stream),
 * and per zone for the synth/sampler engines (each has its own instance).
 */
function chainKeyFor(zone: Zone): string {
  if ((zone.engine ?? 'soundfont') === 'soundfont') return `sf:${zone.fontId}:${zone.channel}`
  return `zone:${zone.id}`
}

function engineOf(zone: Zone): NonNullable<Zone['engine']> {
  return zone.engine ?? 'soundfont'
}

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

  // ── FX / engine state ──
  const masterRef = useRef<GainNode | null>(null)
  const chainsRef = useRef<Map<string, EffectsChain>>(new Map())
  // chain key → the (synth, channel) tap currently feeding it
  const tapsRef = useRef<Map<string, { synth: AnySynth; ch: number }>>(new Map())
  const synthEnginesRef = useRef<Map<string, SubtractiveSynth>>(new Map())
  const samplerEnginesRef = useRef<Map<string, Sampler>>(new Map())

  // Dev-only inspection hook for the audio graph (chains, taps, engines).
  // Invaluable when debugging routing: window.__perryAudio.chains()
  if (import.meta.env.DEV) {
    const meterRef = { current: null as AnalyserNode | null }
    ;(window as unknown as Record<string, unknown>).__perryAudio = {
      ready: () => audioCtxRef.current?.state ?? 'none',
      chains: () => [...chainsRef.current.keys()],
      taps: () => [...tapsRef.current.entries()].map(([key, t]) => `${key}←ch${t.ch}`),
      engines: () => ({
        synth: [...synthEnginesRef.current.entries()].map(([id, e]) => ({ id, voices: e.activeVoices })),
        sampler: [...samplerEnginesRef.current.entries()].map(([id, e]) => ({ id, sample: e.getSample()?.fileName ?? null })),
      }),
      sfVoices: () => [...synthMapRef.current.values()].map((s) => s.voicesAmount ?? -1),
      /** Peak level of the master bus (0..1) — proves signal end-to-end. */
      level: () => {
        const ctx = audioCtxRef.current
        const master = masterRef.current
        if (!ctx || !master) return -1
        if (!meterRef.current) {
          const m = ctx.createAnalyser()
          m.fftSize = 2048
          master.connect(m)
          meterRef.current = m
        }
        const data = new Float32Array(meterRef.current.fftSize)
        meterRef.current.getFloatTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v))
        return Math.round(peak * 1000) / 1000
      },
    }
  }

  // ── Audio context / worklet bootstrap ──────────────────────────────────────
  const getCtx = useCallback((): AudioContext => {
    if (audioCtxRef.current) return audioCtxRef.current
    // Create AudioContext with low latency settings
    const ctx = new AudioContext({
      latencyHint: 'interactive', // Optimize for low latency over power consumption
      sampleRate: 44100, // Standard sample rate, good balance
    })
    audioCtxRef.current = ctx
    // Log actual latency for debugging
    console.log('AudioContext latency:', {
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
      sampleRate: ctx.sampleRate,
    })
    return ctx
  }, [])

  /**
   * Master bus: the legacy 1.2× "punch" gain, plus a safety limiter so
   * summed per-channel FX (reverb/delay sends) can never hard-clip.
   * All soundfont FX buses and all zone chains feed this node.
   */
  const getMaster = useCallback((ctx: AudioContext): GainNode => {
    if (masterRef.current) return masterRef.current
    const gain = ctx.createGain()
    gain.gain.value = 1.2
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    gain.connect(limiter)
    limiter.connect(ctx.destination)
    masterRef.current = gain
    return gain
  }, [])

  const ensureAudio = useCallback(async () => {
    const ctx = getCtx()
    if (ctx.state !== 'running') await ctx.resume()
    return ctx
  }, [getCtx])

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

    // Route only the effects-return bus (worklet output 0) to master.
    // Per-channel dry audio (outputs 1–16) is routed by syncAudio() through
    // each zone's effects chain — connecting all outputs here would double it.
    const master = getMaster(ctx)
    const worklet = (synth as unknown as { worklet: AudioWorkletNode }).worklet
    worklet.connect(master, 0)

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
  }, [ensureAudio, ensureWorklet, getMaster])

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
    // Program/bank/volume CCs only make sense for soundfont channels —
    // engines read their settings from syncAudio() instead.
    if (engineOf(zone) !== 'soundfont') return
    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    synth.controllerChange(zone.channel, 0, zone.bank)
    synth.controllerChange(zone.channel, 32, 0)
    synth.programChange(zone.channel, zone.program)
    synth.controllerChange(zone.channel, 7, zone.volume)
  }, [])

  const noteOn = useCallback(async (zone: Zone, note: number, velocity: number) => {
    const engine = engineOf(zone)
    const ctx = audioCtxRef.current
    if (ctx?.state !== 'running') {
      console.log('noteOn - AudioContext not running (state:', ctx?.state, '), resuming...')
      try { await ctx?.resume() } catch (e) { console.warn('AudioContext resume failed:', e) }
    }

    if (engine === 'synth') {
      const eng = synthEnginesRef.current.get(zone.id)
      if (eng) eng.noteOn(note, velocity)
      else console.warn('Synth engine not ready for zone:', zone.id, '(syncAudio not run yet)')
      return
    }
    if (engine === 'sampler') {
      const eng = samplerEnginesRef.current.get(zone.id)
      if (eng) eng.noteOn(note, velocity)
      else console.warn('Sampler engine not ready for zone:', zone.id, '(syncAudio not run yet)')
      return
    }

    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) {
      console.warn('No synth found for fontId:', zone.fontId)
      return
    }
    synth.noteOn(zone.channel, note, velocity)
  }, [])

  const noteOff = useCallback(async (zone: Zone, note: number) => {
    const engine = engineOf(zone)
    const ctx = audioCtxRef.current
    if (ctx?.state !== 'running') {
      try { await ctx?.resume() } catch (e) { console.warn('AudioContext resume failed:', e) }
    }

    if (engine === 'synth') {
      synthEnginesRef.current.get(zone.id)?.noteOff(note)
      return
    }
    if (engine === 'sampler') {
      samplerEnginesRef.current.get(zone.id)?.noteOff(note)
      return
    }

    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    synth.noteOff(zone.channel, note)
  }, [])

  const sendCC = useCallback((zones: Zone[], cc: number, value: number) => {
    // Sustain pedal also holds synth/sampler voices
    if (cc === 64) {
      const on = value >= 64
      synthEnginesRef.current.forEach((e) => e.setSustain(on))
      samplerEnginesRef.current.forEach((e) => e.setSustain(on))
    }
    const seen = new Set<string>()
    zones.forEach((z) => {
      if (engineOf(z) !== 'soundfont') return
      const key = `${z.fontId}:${z.channel}`
      if (seen.has(key)) return
      seen.add(key)
      synthMapRef.current.get(z.fontId)?.controllerChange(z.channel, cc, value)
    })
  }, [])

  const sendPitchBend = useCallback((zones: Zone[], value: number) => {
    const seen = new Set<string>()
    zones.forEach((z) => {
      if (engineOf(z) !== 'soundfont') return
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
    synthEnginesRef.current.forEach((e) => e.allNotesOff())
    samplerEnginesRef.current.forEach((e) => e.allNotesOff())
  }, [])

  // ── Audio routing sync ──────────────────────────────────────────────────────
  /**
   * Reconcile the audio graph with the current zone list:
   *  • creates/disposes per-channel effects chains
   *  • connects/disconnects soundfont channel taps (worklet outputs 1–16)
   *  • creates/disposes synth & sampler engine instances
   *  • pushes effect settings, patch settings and engine volume
   *
   * Must be called with the FULL zone list on every zones/fonts change.
   */
  const syncAudio = useCallback((zones: Zone[]) => {
    // Nothing to do on first mount (no zones, no chains, no ctx yet)
    if (zones.length === 0 && chainsRef.current.size === 0 && synthEnginesRef.current.size === 0 && samplerEnginesRef.current.size === 0) {
      return
    }
    const ctx = audioCtxRef.current ?? getCtx()
    const master = getMaster(ctx)

    // Which chains should exist. When several zones share a soundfont
    // channel they share one chain — prefer the zone that actually has
    // effect settings so opening FX on either row edits what's audible.
    const desired = new Map<string, Zone>()
    for (const z of zones) {
      const key = chainKeyFor(z)
      const current = desired.get(key)
      if (!current || (!current.effects && z.effects)) desired.set(key, z)
    }

    // 1. Remove chains that no zone needs anymore
    for (const [key, chain] of [...chainsRef.current]) {
      if (desired.has(key)) continue
      const tap = tapsRef.current.get(key)
      if (tap) {
        try { tap.synth.disconnectChannel(chain.input, tap.ch) } catch { /* synth destroyed */ }
        tapsRef.current.delete(key)
      }
      chain.dispose()
      chainsRef.current.delete(key)
    }

    // 2. Ensure chains exist, effects applied, soundfont taps connected
    for (const [key, zone] of desired) {
      let chain = chainsRef.current.get(key)
      if (!chain) {
        chain = new EffectsChain(ctx, master)
        chainsRef.current.set(key, chain)
      }
      chain.setSettings(zone.effects ?? DEFAULT_EFFECTS)

      const engine = engineOf(zone)
      const tap = tapsRef.current.get(key)

      if (engine === 'soundfont') {
        const synth = synthMapRef.current.get(zone.fontId)
        if (tap && tap.synth === synth && tap.ch === zone.channel) continue // already routed
        if (tap) {
          try { tap.synth.disconnectChannel(chain.input, tap.ch) } catch { /* destroyed */ }
          tapsRef.current.delete(key)
        }
        if (synth) {
          try {
            synth.connectChannel(chain.input, zone.channel)
            tapsRef.current.set(key, { synth, ch: zone.channel })
          } catch (e) {
            console.warn('Failed to connect FX tap for', key, e)
          }
        }
      } else if (tap) {
        // engine zone must not keep an old soundfont tap
        try { tap.synth.disconnectChannel(chain.input, tap.ch) } catch { /* destroyed */ }
        tapsRef.current.delete(key)
      }
    }

    // 3. Reconcile engine instances
    const zoneById = new Map(zones.map((z) => [z.id, z]))
    for (const [id, eng] of [...synthEnginesRef.current]) {
      const z = zoneById.get(id)
      if (!z || engineOf(z) !== 'synth') {
        eng.dispose()
        synthEnginesRef.current.delete(id)
      }
    }
    for (const [id, eng] of [...samplerEnginesRef.current]) {
      const z = zoneById.get(id)
      if (!z || engineOf(z) !== 'sampler') {
        eng.dispose()
        samplerEnginesRef.current.delete(id)
      }
    }

    for (const z of zones) {
      const engine = engineOf(z)
      const chain = chainsRef.current.get(chainKeyFor(z))
      if (engine === 'synth') {
        let eng = synthEnginesRef.current.get(z.id)
        if (!eng) {
          eng = new SubtractiveSynth(ctx, z.synth ?? defaultSynth())
          synthEnginesRef.current.set(z.id, eng)
        }
        eng.setSettings(z.synth ?? defaultSynth())
        eng.setVolume((z.volume ?? 100) / 127)
        if (chain) eng.output.connect(chain.input) // duplicate connects are no-ops
      } else if (engine === 'sampler') {
        let eng = samplerEnginesRef.current.get(z.id)
        if (!eng) {
          eng = new Sampler(ctx, z.sampler ?? defaultSampler())
          samplerEnginesRef.current.set(z.id, eng)
        }
        eng.setSettings(z.sampler ?? defaultSampler())
        eng.setVolume((z.volume ?? 100) / 127)
        if (chain) eng.output.connect(chain.input)
      }
    }
  }, [getCtx, getMaster])

  // ── Sample loading ─────────────────────────────────────────────────────────
  /** Decode an audio file for a sampler zone and cache it by file name. */
  const loadSampleForZone = useCallback(async (zoneId: string, file: File): Promise<string> => {
    const ctx = audioCtxRef.current ?? getCtx()
    if (ctx.state !== 'running') {
      try { await ctx.resume() } catch { /* gesture will resume later */ }
    }
    const data = await file.arrayBuffer()
    const buffer = await ctx.decodeAudioData(data)
    cacheSample(file.name, buffer)
    samplerEnginesRef.current.get(zoneId)?.setBuffer(buffer)
    return file.name
  }, [getCtx])

  // Ensure audio context is running (call before playback)
  const ensureAudioReady = useCallback(async () => {
    const ctx = audioCtxRef.current
    if (!ctx) {
      console.warn('No AudioContext exists yet')
      return
    }
    if (ctx.state === 'suspended') {
      console.log('Synth AudioContext suspended, resuming...')
      await ctx.resume()
      console.log('Synth AudioContext resumed, state:', ctx.state)
    } else {
      console.log('Synth AudioContext already running')
    }
  }, [])

  return {
    status, loadProgress, errorMsg, fonts,
    loadFont, removeFont,
    applyZone, noteOn, noteOff, sendCC, sendPitchBend,
    allNotesOff,
    ensureAudioReady,
    firstMelodicPreset,
    syncAudio, loadSampleForZone,
  }
}
