import { useState, useRef, useCallback, useEffect } from 'react'
import type { Preset, LoadedFont, Zone } from '../types'
import { defaultSynth, defaultSampler } from '../types'
import { ChannelStrip, FxBuses, MasterBus } from '../audio/mixer'
import { JAM_STRIPS, mixOf, normaliseMixer, type JamStrip, type MixerSettings } from '../mixer/model'
import { SubtractiveSynth } from '../audio/subtractiveSynth'
import { Sampler, cacheSample } from '../audio/sampler'
import { deleteFont, listFonts, listSamples, saveFont, saveSample } from '../audio/assetStore'

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
  /** Bumps when saved fonts/samples finish restoring, so the UI re-reads them. */
  const [assetsTick, setAssetsTick] = useState(0)
  const [restoring, setRestoring] = useState(true)

  const audioCtxRef = useRef<AudioContext | null>(null)
  // Map fontId → WorkletSynthesizer instance
  const synthMapRef = useRef<Map<string, AnySynth>>(new Map())
  const workletLoadedRef = useRef(false)

  // ── FX / engine state ──
  const masterRef = useRef<GainNode | null>(null)
  const masterBusRef = useRef<MasterBus | null>(null)
  const busesRef = useRef<FxBuses | null>(null)
  /** Channel strips per zone stream (soundfont channel or engine zone). */
  const chainsRef = useRef<Map<string, ChannelStrip>>(new Map())
  /** Strips for the JAM band's built-in sounds and the click. */
  const jamStripsRef = useRef<Map<JamStrip, ChannelStrip>>(new Map())
  const mixerRef = useRef<MixerSettings>(normaliseMixer(null))
  const mixBpmRef = useRef(120)
  const lastZonesRef = useRef<Zone[]>([])
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
      /** Mixer: peak dBFS per strip, per FX return, and master. */
      mixLevels: () => ({
        strips: Object.fromEntries([...chainsRef.current].map(([k, c]) => [k, Math.round(c.level())])),
        jam: Object.fromEntries([...jamStripsRef.current].map(([k, c]) => [k, Math.round(c.level())])),
        buses: busesRef.current?.levels(),
        master: masterBusRef.current?.levels(),
      }),
      /** Which soundfont channels are in drum mode, per font. */
      drumChannels: () => [...synthMapRef.current.values()].map((s) => (s.channelProperties ?? []).map((c: AnySynth, i: number) => (c?.isDrum ? i + 1 : 0)).filter(Boolean)),
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
   * Master bus (fader → safety limiter → speakers) plus the three shared FX
   * buses whose returns feed it. Every strip, the soundfont FX return and the
   * JAM band end up here. Returns the master input node.
   */
  const getMaster = useCallback((ctx: AudioContext): GainNode => {
    if (masterRef.current) return masterRef.current
    const mb = new MasterBus(ctx)
    masterBusRef.current = mb
    busesRef.current = new FxBuses(ctx, mb.input)
    busesRef.current.setSettings(mixerRef.current, mixBpmRef.current)
    mb.setLevel(mixerRef.current.master.level)
    masterRef.current = mb.input
    return mb.input
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
    persist = true,       // keep a copy in IndexedDB so it survives a refresh
  ): Promise<string> => {
    const fontId = replaceId ?? ('font_' + Date.now())
    // copy before the worklet takes the buffer
    if (persist && fontId !== 'main') void saveFont({ id: fontId, name, data: buffer.slice(0), addedAt: Date.now() })

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
    // any working font makes the synth usable, even if default.sf2 failed
    setStatus('ready')
    setErrorMsg('')
    return fontId
  }, [createFontSynth])

  const removeFont = useCallback((fontId: string) => {
    if (fontId === 'main') return // can't remove the main font
    void deleteFont(fontId)
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
        // dev servers answer a missing file with index.html — don't feed that to the synth
        if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('default.sf2 not found')
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

    // Restore SoundFonts and samples loaded in earlier sessions, under their
    // original ids so saved zones and configs find them again. Runs alongside
    // the default font so a slow or missing default.sf2 can't hold it up.
    ;(async () => {
      for (const f of await listFonts()) {
        try { await loadFont(f.data, f.name, f.id, false) } catch (e) { console.warn('Could not restore font', f.name, e) }
      }
      const samples = await listSamples()
      if (samples.length) {
        const ctx = audioCtxRef.current ?? getCtx()
        for (const x of samples) {
          try { cacheSample(x.name, await ctx.decodeAudioData(x.data.slice(0))) } catch { /* undecodable */ }
        }
        samplerEnginesRef.current.forEach((e) => e.reloadFromCache())
      }
      setRestoring(false)
      setAssetsTick((t) => t + 1)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Zone operations ─────────────────────────────────────────────────────────
  const applyZone = useCallback((zone: Zone) => {
    // Program/bank/volume CCs only make sense for soundfont channels —
    // engines read their settings from syncAudio() instead.
    if (engineOf(zone) !== 'soundfont') return
    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    // Drum kits are flagged, not banked (they share bank/program numbers
    // with melodic presets), so the channel itself must be put in drum mode.
    synth.setDrums(zone.channel, !!zone.drums)
    synth.controllerChange(zone.channel, 0, zone.bank)
    synth.controllerChange(zone.channel, 32, 0)
    synth.programChange(zone.channel, zone.program)
    synth.controllerChange(zone.channel, 7, zone.volume)
    // reverb / chorus come from the mixer's shared buses, not the synth's own
    synth.controllerChange(zone.channel, 91, 0)
    synth.controllerChange(zone.channel, 93, 0)
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

  /**
   * Play a note on a zone at an exact audio-clock time for a fixed length.
   * Used by the jam band's look-ahead scheduler: soundfont zones use the
   * worklet's timed events, synth/sampler zones create timed voices.
   */
  const scheduleNote = useCallback((zone: Zone, note: number, velocity: number, when: number, duration: number) => {
    const engine = engineOf(zone)
    if (engine === 'synth') { synthEnginesRef.current.get(zone.id)?.playNote(note, velocity, when, duration); return }
    if (engine === 'sampler') { samplerEnginesRef.current.get(zone.id)?.playNote(note, velocity, when, duration); return }
    const synth = synthMapRef.current.get(zone.fontId)
    if (!synth) return
    synth.noteOn(zone.channel, note, velocity, { time: when })
    synth.noteOff(zone.channel, note, { time: when + duration })
  }, [])

  /** Silence anything the jam band scheduled on these zones. */
  const stopScheduled = useCallback((zones: Zone[]) => {
    synthEnginesRef.current.forEach((e) => e.stopScheduled())
    samplerEnginesRef.current.forEach((e) => e.stopScheduled())
    const seen = new Set<string>()
    zones.forEach((z) => {
      if (engineOf(z) !== 'soundfont') return
      const key = `${z.fontId}:${z.channel}`
      if (seen.has(key)) return
      seen.add(key)
      const synth = synthMapRef.current.get(z.fontId)
      synth?.controllerChange(z.channel, 123, 0)
    })
  }, [])

  /** The shared AudioContext and master bus (created on demand). */
  const getAudio = useCallback(() => {
    const ctx = audioCtxRef.current ?? getCtx()
    return { ctx, master: getMaster(ctx) }
  }, [getCtx, getMaster])

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
      if (!current || (!(current.mix || current.effects) && (z.mix || z.effects))) desired.set(key, z)
    }
    lastZonesRef.current = zones
    const silenced = soloState(zones)

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
        chain = new ChannelStrip(ctx, master, busesRef.current!)
        chainsRef.current.set(key, chain)
      }
      const mix = mixOf(zone)
      chain.setSettings(mix, mix.mute || silenced(mix))

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

  /** Returns a predicate: is this strip silenced by someone else's solo? */
  function soloState(zones: Zone[]) {
    const m = mixerRef.current
    const anySolo = zones.some((z) => mixOf(z).solo) || JAM_STRIPS.some((k) => m.jam[k].solo)
    return (mix: { solo: boolean }) => anySolo && !mix.solo
  }

  /**
   * Apply mixer-wide settings: FX buses, master fader, JAM strips, and solo
   * across every strip. `bpm` drives tempo-synced delay.
   */
  const syncMixer = useCallback((settings: MixerSettings, bpm: number) => {
    mixerRef.current = settings
    mixBpmRef.current = bpm
    if (!masterRef.current) return // graph not built yet; applied on creation
    busesRef.current?.setSettings(settings, bpm)
    masterBusRef.current?.setLevel(settings.master.level)
    const silenced = soloState(lastZonesRef.current)
    jamStripsRef.current.forEach((strip, k) => strip.setSettings(settings.jam[k], settings.jam[k].mute || silenced(settings.jam[k])))
    // solo changes affect the zone strips too
    const seen = new Set<string>()
    for (const z of lastZonesRef.current) {
      const key = chainKeyFor(z)
      if (seen.has(key)) continue
      seen.add(key)
      const mix = mixOf(z)
      chainsRef.current.get(key)?.setSettings(mix, mix.mute || silenced(mix))
    }
  }, [])

  /** Inputs of the JAM band's strips (built-in drums / bass / keys / click). */
  const getJamOutputs = useCallback(() => {
    const ctx = audioCtxRef.current ?? getCtx()
    const master = getMaster(ctx)
    const silenced = soloState(lastZonesRef.current)
    for (const k of JAM_STRIPS) {
      if (!jamStripsRef.current.has(k)) {
        const strip = new ChannelStrip(ctx, master, busesRef.current!)
        const mix = mixerRef.current.jam[k]
        strip.setSettings(mix, mix.mute || silenced(mix))
        jamStripsRef.current.set(k, strip)
      }
    }
    const j = jamStripsRef.current
    return { ctx, drums: j.get('drums')!.input, bass: j.get('bass')!.input, keys: j.get('keys')!.input, click: j.get('click')!.input }
  }, [getCtx, getMaster])

  /** Peak levels in dBFS for the mixer's meters (−Infinity = silence). */
  const readMeters = useCallback(() => {
    const strips: Record<string, number> = {}
    chainsRef.current.forEach((c, k) => { strips[k] = c.level() })
    const jam: Partial<Record<JamStrip, number>> = {}
    jamStripsRef.current.forEach((c, k) => { jam[k] = c.level() })
    return {
      strips, jam,
      buses: busesRef.current?.levels() ?? { reverb: -Infinity, delay: -Infinity, chorus: -Infinity },
      master: masterBusRef.current?.levels() ?? { l: -Infinity, r: -Infinity, reduction: 0 },
    }
  }, [])

  // ── Sample loading ─────────────────────────────────────────────────────────
  /** Decode an audio file for a sampler zone and cache it by file name. */
  const loadSampleForZone = useCallback(async (zoneId: string, file: File): Promise<string> => {
    const ctx = audioCtxRef.current ?? getCtx()
    if (ctx.state !== 'running') {
      try { await ctx.resume() } catch { /* gesture will resume later */ }
    }
    const data = await file.arrayBuffer()
    void saveSample({ name: file.name, data: data.slice(0), addedAt: Date.now() })
    const buffer = await ctx.decodeAudioData(data)
    cacheSample(file.name, buffer)
    samplerEnginesRef.current.get(zoneId)?.setBuffer(buffer)
    return file.name
  }, [getCtx])

  // ── Analysers (scope / spectrum) ─────────────────────────────────────────────
  const analysersRef = useRef<WeakMap<ChannelStrip, AnalyserNode>>(new WeakMap())
  /**
   * Analyser tapped off a zone's FX-chain output (post effects, pre master).
   * Created lazily and cached per chain; returns null before audio exists.
   */
  const getZoneAnalyser = useCallback((zone: Zone): AnalyserNode | null => {
    const ctx = audioCtxRef.current
    const chain = chainsRef.current.get(chainKeyFor(zone))
    if (!ctx || !chain) return null
    let a = analysersRef.current.get(chain)
    if (!a) {
      a = ctx.createAnalyser()
      a.fftSize = 4096
      a.smoothingTimeConstant = 0.75
      chain.output.connect(a)
      analysersRef.current.set(chain, a)
    }
    return a
  }, [])

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
    status, loadProgress, errorMsg, fonts, restoring, assetsTick,
    loadFont, removeFont,
    applyZone, noteOn, noteOff, sendCC, sendPitchBend,
    allNotesOff,
    ensureAudioReady,
    firstMelodicPreset,
    syncAudio, loadSampleForZone, getZoneAnalyser,
    scheduleNote, stopScheduled, getAudio,
    syncMixer, getJamOutputs, readMeters, chainKeyFor,
  }
}
