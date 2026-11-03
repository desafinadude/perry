import type { SynthSettings } from '../types'

const MAX_VOICES = 24

interface Voice {
  note: number
  osc1: OscillatorNode
  osc2: OscillatorNode
  noise: AudioBufferSourceNode
  g1: GainNode
  g2: GainNode
  ng: GainNode
  mix: GainNode
  filter: BiquadFilterNode
  vca: GainNode
  freq: number
  peak: number
  startedAt: number
}

// Shared white-noise buffer (one per AudioContext).
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2)
    buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

const mtof = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

/**
 * Built-in subtractive synthesizer: two oscillators + noise →
 * filter with envelope → ADSR VCA. One instance per zone.
 *
 * Every parameter is live: turning a knob reshapes voices that are
 * already sounding (smoothed to avoid zipper noise), not only the next
 * note. Attack/decay shape the next strike; release applies on key-up.
 */
export class SubtractiveSynth {
  readonly output: GainNode

  private readonly ctx: AudioContext
  private settings: SynthSettings
  private readonly voices = new Map<number, Voice>()
  private readonly sustained = new Set<number>()
  private sustainPedal = false
  private volume = 1
  private disposed = false

  // shared vibrato LFO — connected per-voice to osc.detune
  private readonly lfo: OscillatorNode
  private readonly lfoDepth: GainNode

  constructor(ctx: AudioContext, settings: SynthSettings) {
    this.ctx = ctx
    this.settings = settings
    this.output = ctx.createGain()
    this.output.gain.value = 1

    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = settings.lfoRate
    this.lfoDepth = ctx.createGain()
    this.lfoDepth.gain.value = settings.lfoDepth
    this.lfo.connect(this.lfoDepth)
    this.lfo.start()
  }

  setSettings(s: SynthSettings): void {
    this.settings = s
    if (this.disposed) return
    const now = this.ctx.currentTime
    this.lfo.frequency.setTargetAtTime(s.lfoRate, now, 0.02)
    this.lfoDepth.gain.setTargetAtTime(s.lfoDepth, now, 0.02)
    const t = 0.02
    const cutoff = Math.max(20, Math.min(18000, s.cutoff))
    for (const v of this.voices.values()) {
      if (v.osc1.type !== s.osc1.wave) v.osc1.type = s.osc1.wave
      if (v.osc2.type !== s.osc2.wave) v.osc2.type = s.osc2.wave
      v.osc1.frequency.setTargetAtTime(v.freq * Math.pow(2, s.osc1.octave), now, t)
      v.osc2.frequency.setTargetAtTime(v.freq * Math.pow(2, s.osc2.octave), now, t)
      v.osc1.detune.setTargetAtTime(s.osc1.detune, now, t)
      v.osc2.detune.setTargetAtTime(s.osc2.detune, now, t)
      v.g1.gain.setTargetAtTime(s.osc1.level, now, t)
      v.g2.gain.setTargetAtTime(s.osc2.level, now, t)
      v.ng.gain.setTargetAtTime(s.noise, now, t)
      if (v.filter.type !== s.filterType) v.filter.type = s.filterType
      v.filter.Q.setTargetAtTime(s.resonance, now, t)
      // drop any running filter-envelope sweep and glide to the new cutoff
      v.filter.frequency.cancelScheduledValues(now)
      v.filter.frequency.setTargetAtTime(cutoff, now, t)
      // sustain level follows once the voice is past attack + decay
      if (now >= v.startedAt + s.ampAttack + s.ampDecay) {
        const sus = Math.max(0, Math.min(1, s.ampSustain)) * v.peak
        v.vca.gain.cancelScheduledValues(now)
        v.vca.gain.setTargetAtTime(sus, now, t)
      }
    }
  }

  setVolume(v: number): void {
    this.volume = v
    if (!this.disposed) {
      this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015)
    }
  }

  noteOn(note: number, velocity: number): void {
    if (this.disposed) return
    this.sustained.delete(note)
    this.noteOffInternal(note, true) // retrigger: silence previous voice fast

    const ctx = this.ctx
    const s = this.settings
    const now = ctx.currentTime
    const freq = mtof(note)
    const vel = Math.max(0, Math.min(1, velocity / 127))
    const peak = Math.pow(vel, 1.4) * 0.9

    const osc1 = ctx.createOscillator()
    osc1.type = s.osc1.wave
    osc1.frequency.value = freq * Math.pow(2, s.osc1.octave)
    osc1.detune.value = s.osc1.detune

    const osc2 = ctx.createOscillator()
    osc2.type = s.osc2.wave
    osc2.frequency.value = freq * Math.pow(2, s.osc2.octave)
    osc2.detune.value = s.osc2.detune

    this.lfoDepth.connect(osc1.detune)
    this.lfoDepth.connect(osc2.detune)

    const mix = ctx.createGain()
    mix.gain.value = 0.5
    const g1 = ctx.createGain()
    g1.gain.value = s.osc1.level
    const g2 = ctx.createGain()
    g2.gain.value = s.osc2.level
    osc1.connect(g1)
    osc2.connect(g2)
    g1.connect(mix)
    g2.connect(mix)

    // noise always runs (at its level, possibly 0) so the knob is live
    const noise = ctx.createBufferSource()
    noise.buffer = getNoiseBuffer(ctx)
    noise.loop = true
    const ng = ctx.createGain()
    ng.gain.value = s.noise
    noise.connect(ng)
    ng.connect(mix)
    noise.start(now, Math.random() * 1.5)

    const filter = ctx.createBiquadFilter()
    filter.type = s.filterType
    filter.Q.value = s.resonance
    const cutoff = Math.max(20, Math.min(18000, s.cutoff))
    const peakCutoff = Math.max(40, Math.min(18000, cutoff * Math.pow(2, s.filterEnv)))
    if (s.filterEnv > 0 && s.filterDecay > 0) {
      filter.frequency.setValueAtTime(peakCutoff, now)
      filter.frequency.exponentialRampToValueAtTime(cutoff, now + s.filterDecay)
    } else {
      filter.frequency.setValueAtTime(cutoff, now)
    }

    const vca = ctx.createGain()
    // ADSR
    const a = Math.max(0.001, s.ampAttack)
    const d = Math.max(0.001, s.ampDecay)
    const sus = Math.max(0, Math.min(1, s.ampSustain)) * peak
    vca.gain.setValueAtTime(0, now)
    vca.gain.linearRampToValueAtTime(peak, now + a)
    vca.gain.linearRampToValueAtTime(sus, now + a + d)

    mix.connect(filter)
    filter.connect(vca)
    vca.connect(this.output)

    osc1.start(now)
    osc2.start(now)

    const voice: Voice = { note, osc1, osc2, noise, g1, g2, ng, mix, filter, vca, freq, peak, startedAt: now }
    this.voices.set(note, voice)

    // voice stealing — oldest gets a fast fade-out
    if (this.voices.size > MAX_VOICES) {
      let oldest: Voice | null = null
      for (const v of this.voices.values()) {
        if (!oldest || v.startedAt < oldest.startedAt) oldest = v
      }
      if (oldest && oldest.note !== note) this.noteOffInternal(oldest.note, false, 0.05)
    }
  }

  noteOff(note: number): void {
    if (this.disposed) return
    if (this.sustainPedal) {
      this.sustained.add(note)
      return
    }
    this.noteOffInternal(note, false)
  }

  private noteOffInternal(note: number, _retrigger: boolean, fastRelease?: number): void {
    const v = this.voices.get(note)
    if (!v) return
    this.voices.delete(note)
    this.sustained.delete(note)

    const now = this.ctx.currentTime
    const rel = fastRelease ?? Math.max(0.01, this.settings.ampRelease)
    const g = v.vca.gain
    try {
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + rel)
    } catch { /* param already finished */ }

    const stopAt = now + rel + 0.05
    const cleanup = () => this.destroyVoice(v)
    try {
      v.osc1.stop(stopAt)
      v.osc2.stop(stopAt)
      v.noise.stop(stopAt)
    } catch { /* already stopped */ }
    v.osc1.onended = cleanup
    // onended can be missed if nodes were stopped in the same quantum —
    // schedule a fallback cleanup via the osc1 ended event OR a timeout
    setTimeout(cleanup, (rel + 0.3) * 1000)
  }

  private destroyVoice(v: Voice): void {
    try {
      this.lfoDepth.disconnect(v.osc1.detune)
      this.lfoDepth.disconnect(v.osc2.detune)
    } catch { /* already disconnected */ }
    try {
      v.mix.disconnect()
      v.filter.disconnect()
      v.vca.disconnect()
      v.osc1.disconnect()
      v.osc2.disconnect()
      v.noise.disconnect()
      v.g1.disconnect()
      v.g2.disconnect()
      v.ng.disconnect()
    } catch { /* already disconnected */ }
  }

  setSustain(on: boolean): void {
    if (on === this.sustainPedal) return
    this.sustainPedal = on
    if (!on) {
      for (const note of [...this.sustained]) this.noteOffInternal(note, false)
      this.sustained.clear()
    }
  }

  /** Soft stop: release every voice through the amp envelope. */
  allNotesOff(): void {
    if (this.disposed) return
    this.sustainPedal = false
    this.sustained.clear()
    for (const note of [...this.voices.keys()]) this.noteOffInternal(note, false, 0.08)
  }

  /** Hard cut — used for panic paths (zone removal, config switch). */
  kill(): void {
    for (const v of [...this.voices.values()]) {
      const now = this.ctx.currentTime
      try {
        v.vca.gain.cancelScheduledValues(now)
        v.vca.gain.setValueAtTime(0, now)
        v.osc1.stop(now)
        v.osc2.stop(now)
        v.noise.stop(now)
      } catch { /* already stopped */ }
      this.destroyVoice(v)
    }
    this.voices.clear()
    this.sustained.clear()
    this.sustainPedal = false
  }

  get activeVoices(): number {
    return this.voices.size
  }

  dispose(): void {
    if (this.disposed) return
    this.kill()
    this.disposed = true
    try { this.lfo.stop() } catch { /* already stopped */ }
    this.lfo.disconnect()
    this.lfoDepth.disconnect()
    this.output.disconnect()
  }
}
