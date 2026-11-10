/*
 * Mixer audio graph.
 *
 *   strip:  input → filter (crossfaded bypass) → EQ (low shelf · mid peak · high shelf)
 *           → pan → fader → mute ─┬─→ master
 *                                 └─→ post-fader sends → REVERB / DELAY / CHORUS buses
 *   buses:  input → effect (100 % wet) → return fader → master
 *   master: input → fader → limiter → destination  (+ L/R meters)
 *
 * Every continuous change is smoothed with setTargetAtTime (no zipper noise).
 */
import type { ChannelMix, MixerSettings } from '../mixer/model'
import { dbToGain, syncSeconds } from '../mixer/model'

const T = 0.02
const set = (p: AudioParam, v: number, ctx: BaseAudioContext) => p.setTargetAtTime(v, ctx.currentTime, T)

/** Peak level of an analyser in dBFS (−Infinity when silent). */
function peakDb(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf)
  let p = 0
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
  return p > 0 ? 20 * Math.log10(p) : -Infinity
}

function meterTap(ctx: BaseAudioContext): { node: AnalyserNode; read: () => number } {
  const node = ctx.createAnalyser()
  node.fftSize = 1024
  const buf = new Float32Array(node.fftSize)
  return { node, read: () => peakDb(node, buf) }
}

// ── buses ──────────────────────────────────────────────────────────────────

const irCache = new Map<string, AudioBuffer>()
function impulse(ctx: BaseAudioContext, size: number, decay: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${Math.round(size * 20)}:${Math.round(decay * 20)}`
  const hit = irCache.get(key)
  if (hit) return hit
  const sr = ctx.sampleRate
  const dur = 0.4 + Math.max(0, Math.min(1, size)) * 5.6 // 0.4 … 6 s
  const len = Math.max(64, Math.floor(sr * dur))
  const curve = 0.8 + (1 - Math.max(0, Math.min(1, decay))) * 4 // higher = faster fall-off
  const buf = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      lp += 0.35 * ((Math.random() * 2 - 1) - lp)
      d[i] = lp * Math.pow(1 - t, curve)
    }
    const fade = Math.min(128, len)
    for (let i = 0; i < fade; i++) d[i] *= i / fade
  }
  if (irCache.size > 24) irCache.clear()
  irCache.set(key, buf)
  return buf
}

export class FxBuses {
  readonly reverbIn: GainNode
  readonly delayIn: GainNode
  readonly chorusIn: GainNode
  private readonly ctx: AudioContext
  // reverb
  private readonly preDelay: DelayNode
  private readonly revTone: BiquadFilterNode
  private readonly convolver: ConvolverNode
  private readonly revReturn: GainNode
  private irKey = ''
  // delay
  private readonly dly: DelayNode
  private readonly dlyTone: BiquadFilterNode
  private readonly dlyFb: GainNode
  private readonly haas: DelayNode
  private readonly dlyReturn: GainNode
  // chorus
  private readonly choA: DelayNode
  private readonly choB: DelayNode
  private readonly lfo: OscillatorNode
  private readonly lfoA: GainNode
  private readonly lfoB: GainNode
  private readonly choReturn: GainNode
  private readonly meters: Record<'reverb' | 'delay' | 'chorus', ReturnType<typeof meterTap>>

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx
    this.meters = { reverb: meterTap(ctx), delay: meterTap(ctx), chorus: meterTap(ctx) }

    // REVERB: pre-delay → tone → convolver → return
    this.reverbIn = ctx.createGain()
    this.preDelay = ctx.createDelay(0.5)
    this.revTone = ctx.createBiquadFilter(); this.revTone.type = 'lowpass'
    this.convolver = ctx.createConvolver()
    this.revReturn = ctx.createGain()
    this.reverbIn.connect(this.preDelay).connect(this.revTone).connect(this.convolver).connect(this.revReturn)
    this.revReturn.connect(out)
    this.revReturn.connect(this.meters.reverb.node)

    // DELAY: feedback loop with tone in the loop; Haas offset for width
    this.delayIn = ctx.createGain()
    this.dly = ctx.createDelay(2.5)
    this.dlyTone = ctx.createBiquadFilter(); this.dlyTone.type = 'lowpass'
    this.dlyFb = ctx.createGain()
    this.haas = ctx.createDelay(0.05)
    const merge = ctx.createChannelMerger(2)
    this.dlyReturn = ctx.createGain()
    this.delayIn.connect(this.dly)
    this.dly.connect(this.dlyTone)
    this.dlyTone.connect(this.dlyFb).connect(this.dly)
    this.dlyTone.connect(merge, 0, 0)
    this.dlyTone.connect(this.haas).connect(merge, 0, 1)
    merge.connect(this.dlyReturn)
    this.dlyReturn.connect(out)
    this.dlyReturn.connect(this.meters.delay.node)

    // CHORUS: two modulated delays, LFO in opposite phase, hard L / R
    this.chorusIn = ctx.createGain()
    this.choA = ctx.createDelay(0.05)
    this.choB = ctx.createDelay(0.05)
    this.choA.delayTime.value = 0.014
    this.choB.delayTime.value = 0.018
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'
    this.lfoA = ctx.createGain(); this.lfoB = ctx.createGain()
    this.lfo.connect(this.lfoA).connect(this.choA.delayTime)
    this.lfo.connect(this.lfoB).connect(this.choB.delayTime)
    this.lfo.start()
    const cm = ctx.createChannelMerger(2)
    this.chorusIn.connect(this.choA).connect(cm, 0, 0)
    this.chorusIn.connect(this.choB).connect(cm, 0, 1)
    this.choReturn = ctx.createGain()
    cm.connect(this.choReturn)
    this.choReturn.connect(out)
    this.choReturn.connect(this.meters.chorus.node)
  }

  setSettings(m: MixerSettings, bpm: number) {
    const c = this.ctx
    // reverb
    set(this.preDelay.delayTime, Math.max(0, Math.min(0.5, m.reverb.predelay)), c)
    set(this.revTone.frequency, m.reverb.tone, c)
    const key = `${Math.round(m.reverb.size * 20)}:${Math.round(m.reverb.decay * 20)}`
    if (key !== this.irKey) { this.irKey = key; this.convolver.buffer = impulse(c, m.reverb.size, m.reverb.decay) }
    set(this.revReturn.gain, m.reverb.mute ? 0 : dbToGain(m.reverb.level), c)
    // delay
    const time = m.delay.sync ? syncSeconds(m.delay.sync, bpm) : m.delay.time
    set(this.dly.delayTime, Math.max(0.01, Math.min(2.5, time)), c)
    set(this.dlyTone.frequency, m.delay.tone, c)
    set(this.dlyFb.gain, Math.max(0, Math.min(0.92, m.delay.feedback)), c)
    set(this.haas.delayTime, 0.0005 + m.delay.width * 0.022, c)
    set(this.dlyReturn.gain, m.delay.mute ? 0 : dbToGain(m.delay.level), c)
    // chorus
    set(this.lfo.frequency, m.chorus.rate, c)
    set(this.lfoA.gain, m.chorus.depth * 0.006, c)
    set(this.lfoB.gain, -m.chorus.depth * 0.006, c)
    set(this.choReturn.gain, m.chorus.mute ? 0 : dbToGain(m.chorus.level), c)
  }

  /** Delay time actually in use (seconds), for display. */
  delayTime(m: MixerSettings, bpm: number) { return m.delay.sync ? syncSeconds(m.delay.sync, bpm) : m.delay.time }

  levels() {
    return { reverb: this.meters.reverb.read(), delay: this.meters.delay.read(), chorus: this.meters.chorus.read() }
  }
}

// ── channel strip ──────────────────────────────────────────────────────────

export class ChannelStrip {
  readonly input: GainNode
  /** Post-fader output (also what the analyser / scope taps). */
  readonly output: GainNode
  private readonly ctx: AudioContext
  private readonly filter: BiquadFilterNode
  private readonly filterPath: GainNode
  private readonly bypass: GainNode
  private readonly low: BiquadFilterNode
  private readonly mid: BiquadFilterNode
  private readonly high: BiquadFilterNode
  private readonly panner: StereoPannerNode
  private readonly fader: GainNode
  private readonly sendRev: GainNode
  private readonly sendDly: GainNode
  private readonly sendCho: GainNode
  private readonly meter: ReturnType<typeof meterTap>
  private filterType = ''
  private disposed = false

  constructor(ctx: AudioContext, out: AudioNode, buses: FxBuses) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.filter = ctx.createBiquadFilter()
    this.filterPath = ctx.createGain(); this.filterPath.gain.value = 0
    this.bypass = ctx.createGain()
    const eqIn = ctx.createGain()
    this.input.connect(this.filter).connect(this.filterPath).connect(eqIn)
    this.input.connect(this.bypass).connect(eqIn)

    this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 160
    this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.8
    this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 5000
    this.panner = ctx.createStereoPanner()
    this.fader = ctx.createGain()
    this.output = ctx.createGain()
    eqIn.connect(this.low).connect(this.mid).connect(this.high).connect(this.panner).connect(this.fader).connect(this.output)
    this.output.connect(out)

    this.sendRev = ctx.createGain(); this.sendRev.gain.value = 0
    this.sendDly = ctx.createGain(); this.sendDly.gain.value = 0
    this.sendCho = ctx.createGain(); this.sendCho.gain.value = 0
    this.output.connect(this.sendRev).connect(buses.reverbIn)
    this.output.connect(this.sendDly).connect(buses.delayIn)
    this.output.connect(this.sendCho).connect(buses.chorusIn)

    this.meter = meterTap(ctx)
    this.output.connect(this.meter.node)
  }

  /** `silenced` = muted, or another strip is soloed. */
  setSettings(m: ChannelMix, silenced: boolean) {
    if (this.disposed) return
    const c = this.ctx
    if (m.filterType !== this.filterType) { this.filter.type = m.filterType; this.filterType = m.filterType }
    set(this.filter.frequency, m.cutoff, c)
    set(this.filter.Q, m.resonance, c)
    set(this.filterPath.gain, m.filterOn ? 1 : 0, c)
    set(this.bypass.gain, m.filterOn ? 0 : 1, c)
    set(this.low.gain, m.eqLow, c)
    set(this.mid.gain, m.eqMid, c)
    set(this.high.gain, m.eqHigh, c)
    set(this.panner.pan, Math.max(-1, Math.min(1, m.pan)), c)
    set(this.fader.gain, silenced ? 0 : dbToGain(m.level), c)
    set(this.sendRev.gain, m.sendRev, c)
    set(this.sendDly.gain, m.sendDly, c)
    set(this.sendCho.gain, m.sendCho, c)
  }

  level() { return this.meter.read() }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    try { this.input.disconnect(); this.output.disconnect(); this.sendRev.disconnect(); this.sendDly.disconnect(); this.sendCho.disconnect() } catch { /* gone */ }
  }
}

// ── master ─────────────────────────────────────────────────────────────────

export class MasterBus {
  readonly input: GainNode
  private readonly ctx: AudioContext
  private readonly limiter: DynamicsCompressorNode
  private readonly mL: ReturnType<typeof meterTap>
  private readonly mR: ReturnType<typeof meterTap>

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.input.gain.value = 1.2 // the legacy "punch" gain at unity fader
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 6
    this.limiter.ratio.value = 12
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.25
    this.input.connect(this.limiter).connect(ctx.destination)
    const split = ctx.createChannelSplitter(2)
    this.limiter.connect(split)
    this.mL = meterTap(ctx); this.mR = meterTap(ctx)
    split.connect(this.mL.node, 0)
    split.connect(this.mR.node, 1)
  }

  setLevel(db: number) { set(this.input.gain, 1.2 * dbToGain(db), this.ctx) }

  levels() { return { l: this.mL.read(), r: this.mR.read(), reduction: this.limiter.reduction } }
}
