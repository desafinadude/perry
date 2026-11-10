/*
 * Built-in instruments so the band always works, even with no zones or no
 * SoundFont: a small synthesized drum kit (GM note numbers), a metronome
 * click, and simple bass / keys patches on the subtractive synth.
 */
import { SubtractiveSynth } from '../audio/subtractiveSynth'
import type { SynthSettings } from '../types'

let noiseBuf: AudioBuffer | null = null
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf
  const len = Math.floor(ctx.sampleRate * 1.5)
  const b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  noiseBuf = b
  return b
}

export class DrumKit {
  readonly output: GainNode
  /** Metronome clicks get their own output (their own mixer strip). */
  readonly clickOut: GainNode
  private readonly ctx: AudioContext
  private readonly live = new Set<AudioScheduledSourceNode>()

  constructor(ctx: AudioContext, destination: AudioNode, clickDestination: AudioNode = destination) {
    this.ctx = ctx
    this.output = ctx.createGain()
    this.output.gain.value = 0.9
    this.output.connect(destination)
    this.clickOut = ctx.createGain()
    this.clickOut.connect(clickDestination)
  }

  setVolume(v: number) { this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02) }

  /** Play a GM drum note at time t (velocity 0..1). */
  play(note: number, vel: number, t: number) {
    const v = Math.max(0.02, Math.min(1, vel))
    switch (note) {
      case 35: case 36: return this.kick(t, v)
      case 37: return this.stick(t, v)
      case 38: case 40: return this.snare(t, v)
      case 42: return this.hat(t, v, 0.05)
      case 44: return this.hat(t, v * 0.7, 0.035)
      case 46: return this.hat(t, v, 0.35)
      case 49: case 57: return this.cymbal(t, v, 1.6, 5000)
      case 51: case 59: return this.cymbal(t, v * 0.6, 0.7, 7000)
      case 53: return this.cymbal(t, v * 0.7, 0.5, 9000)
      default: return this.stick(t, v * 0.6)
    }
  }

  /** Metronome click: higher on the downbeat. */
  click(t: number, accent: boolean) {
    const o = this.ctx.createOscillator()
    o.frequency.value = accent ? 1760 : 1320
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    o.connect(g).connect(this.clickOut)
    this.start(o, t, t + 0.06)
  }

  stopAll() {
    const now = this.ctx.currentTime
    this.live.forEach((n) => { try { n.stop(now) } catch { /* done */ } })
    this.live.clear()
  }

  private start(n: AudioScheduledSourceNode, t: number, end: number) {
    this.live.add(n)
    n.onended = () => { this.live.delete(n); try { n.disconnect() } catch { /* gone */ } }
    n.start(t)
    n.stop(end)
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay)
    g.connect(this.output)
    return g
  }

  private kick(t: number, v: number) {
    const o = this.ctx.createOscillator()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    o.connect(this.env(t, 0.95 * v, 0.35))
    this.start(o, t, t + 0.4)
  }

  private snare(t: number, v: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = noise(this.ctx)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8
    n.connect(bp).connect(this.env(t, 0.55 * v, 0.18))
    this.start(n, t, t + 0.2)
    const o = this.ctx.createOscillator()
    o.frequency.setValueAtTime(220, t)
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08)
    o.connect(this.env(t, 0.35 * v, 0.09))
    this.start(o, t, t + 0.1)
  }

  private stick(t: number, v: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = noise(this.ctx)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 6
    n.connect(bp).connect(this.env(t, 0.9 * v, 0.045))
    this.start(n, t, t + 0.06)
  }

  private hat(t: number, v: number, decay: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = noise(this.ctx)
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 7500
    n.connect(hp).connect(this.env(t, 0.32 * v, decay))
    this.start(n, t, t + decay + 0.02)
  }

  private cymbal(t: number, v: number, decay: number, freq: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = noise(this.ctx)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2
    const g = this.env(t, 0.28 * v, decay)
    n.connect(bp).connect(g)
    // a little metallic ping for the ride
    const o = this.ctx.createOscillator()
    o.type = 'square'; o.frequency.value = freq / 2.4
    const og = this.ctx.createGain(); og.gain.value = 0.04
    o.connect(og).connect(g)
    this.start(n, t, t + decay + 0.05)
    this.start(o, t, t + decay + 0.05)
  }
}

const BASS_PATCH: SynthSettings = {
  osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.7 },
  osc2: { wave: 'sine', octave: -1, detune: 0, level: 0.8 },
  noise: 0, filterType: 'lowpass', cutoff: 520, resonance: 2, filterEnv: 1.6, filterDecay: 0.18,
  ampAttack: 0.004, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.08, lfoRate: 5, lfoDepth: 0,
}

const KEYS_PATCH: SynthSettings = {
  osc1: { wave: 'triangle', octave: 0, detune: 0, level: 0.8 },
  osc2: { wave: 'sine', octave: 1, detune: 4, level: 0.25 },
  noise: 0, filterType: 'lowpass', cutoff: 2600, resonance: 0.8, filterEnv: 1.2, filterDecay: 0.3,
  ampAttack: 0.005, ampDecay: 0.9, ampSustain: 0.35, ampRelease: 0.25, lfoRate: 4.5, lfoDepth: 3,
}

/** Bass + keys synths wired to a destination, for tracks set to BUILT-IN. */
export class BuiltinBand {
  readonly drums: DrumKit
  readonly bass: SubtractiveSynth
  readonly keys: SubtractiveSynth
  private readonly bassGain: GainNode
  private readonly keysGain: GainNode

  /** Each part goes to its own destination (a mixer strip). */
  constructor(ctx: AudioContext, out: { drums: AudioNode; bass: AudioNode; keys: AudioNode; click: AudioNode }) {
    this.drums = new DrumKit(ctx, out.drums, out.click)
    this.bass = new SubtractiveSynth(ctx, BASS_PATCH)
    this.keys = new SubtractiveSynth(ctx, KEYS_PATCH)
    this.bassGain = ctx.createGain(); this.bassGain.gain.value = 0.9
    this.keysGain = ctx.createGain(); this.keysGain.gain.value = 0.45
    this.bass.output.connect(this.bassGain).connect(out.bass)
    this.keys.output.connect(this.keysGain).connect(out.keys)
  }

  stopAll() {
    this.drums.stopAll()
    this.bass.stopScheduled()
    this.keys.stopScheduled()
  }
}
