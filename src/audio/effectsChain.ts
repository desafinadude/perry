import type { EffectSettings } from '../types'

/**
 * Per-zone / per-channel insert-effects chain.
 *
 * Signal flow:
 *   input ─┬─ filter ─┐
 *          └─ bypass ─┴─┬─ chorus (dry + LFO-modulated delay wet) ─┐
 *                       ├─ delay   (dry + feedback delay wet)    ─┤
 *                       ├─ reverb  (dry + convolver wet)         ─┤
 *                       └────────────────────────────────────────┴─ pan → output
 *
 * Every stage is crossfaded with gain nodes so toggles never click, and
 * continuous parameters are smoothed with setTargetAtTime to avoid zipper
 * noise while dragging sliders. The convolver is physically disconnected
 * while the reverb is off — convolution is the only expensive stage here
 * and up to 8 chains can be alive at once.
 */
export class EffectsChain {
  readonly input: GainNode
  readonly output: GainNode

  private readonly ctx: AudioContext

  // filter
  private readonly filter: BiquadFilterNode
  private readonly filterPath: GainNode
  private readonly bypassPath: GainNode

  // chorus
  private readonly chorusDry: GainNode
  private readonly chorusWet: GainNode
  private readonly chorusDelay: DelayNode
  private readonly chorusLfo: OscillatorNode
  private readonly chorusLfoDepth: GainNode

  // delay
  private readonly delayDry: GainNode
  private readonly delayWet: GainNode
  private readonly delayNode: DelayNode
  private readonly delayFeedback: GainNode

  // reverb
  private readonly reverbDry: GainNode
  private readonly reverbWet: GainNode
  private readonly reverbSend: GainNode
  private readonly convolver: ConvolverNode
  private reverbConnected = false
  private reverbBucket = -1

  // pan
  private readonly panner: StereoPannerNode

  private lastSettings: EffectSettings | null = null
  private disposed = false

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()

    // ── filter with bypass crossfade ──
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 18000
    this.filter.Q.value = 0.7
    this.filterPath = ctx.createGain()
    this.filterPath.gain.value = 0
    this.bypassPath = ctx.createGain()
    this.bypassPath.gain.value = 1

    const chorusIn = ctx.createGain()
    const delayIn = ctx.createGain()
    const reverbIn = ctx.createGain()
    const panIn = ctx.createGain()

    this.input.connect(this.filter)
    this.filter.connect(this.filterPath)
    this.input.connect(this.bypassPath)
    this.filterPath.connect(chorusIn)
    this.bypassPath.connect(chorusIn)

    // ── chorus: dry + LFO-modulated delay ──
    this.chorusDry = ctx.createGain()
    this.chorusDry.gain.value = 1
    this.chorusWet = ctx.createGain()
    this.chorusWet.gain.value = 0
    this.chorusDelay = ctx.createDelay(0.2)
    this.chorusDelay.delayTime.value = 0.015
    this.chorusLfo = ctx.createOscillator()
    this.chorusLfo.type = 'sine'
    this.chorusLfo.frequency.value = 0.8
    this.chorusLfoDepth = ctx.createGain()
    this.chorusLfoDepth.gain.value = 0.003
    this.chorusLfo.connect(this.chorusLfoDepth)
    this.chorusLfoDepth.connect(this.chorusDelay.delayTime)
    this.chorusLfo.start()
    chorusIn.connect(this.chorusDry)
    chorusIn.connect(this.chorusDelay)
    this.chorusDelay.connect(this.chorusWet)
    this.chorusDry.connect(delayIn)
    this.chorusWet.connect(delayIn)

    // ── delay: dry + feedback echo ──
    this.delayDry = ctx.createGain()
    this.delayDry.gain.value = 1
    this.delayWet = ctx.createGain()
    this.delayWet.gain.value = 0
    this.delayNode = ctx.createDelay(2)
    this.delayNode.delayTime.value = 0.28
    this.delayFeedback = ctx.createGain()
    this.delayFeedback.gain.value = 0.35
    delayIn.connect(this.delayDry)
    delayIn.connect(this.delayNode)
    this.delayNode.connect(this.delayWet)
    this.delayNode.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayNode)
    this.delayDry.connect(reverbIn)
    this.delayWet.connect(reverbIn)

    // ── reverb: dry + convolver send (convolver attached only while active) ──
    this.reverbDry = ctx.createGain()
    this.reverbDry.gain.value = 1
    this.reverbWet = ctx.createGain()
    this.reverbWet.gain.value = 0
    this.reverbSend = ctx.createGain()
    this.convolver = ctx.createConvolver()
    this.convolver.normalize = true
    reverbIn.connect(this.reverbDry)
    reverbIn.connect(this.reverbSend)
    this.reverbDry.connect(panIn)
    this.reverbWet.connect(panIn)

    // ── pan → output ──
    this.panner = ctx.createStereoPanner()
    panIn.connect(this.panner)
    this.panner.connect(this.output)
    this.output.connect(destination)
  }

  /** Apply (or re-apply) effect settings. Safe to call on every keystroke. */
  setSettings(s: EffectSettings): void {
    if (this.disposed) return
    const now = this.ctx.currentTime
    const t = 0.02 // smoothing time constant
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, t)

    // filter — type changes are not automatable, so only push when changed
    if (!this.lastSettings || this.lastSettings.filterType !== s.filterType) {
      this.filter.type = s.filterType
    }
    set(this.filter.frequency, s.cutoff)
    set(this.filter.Q, s.resonance)
    set(this.filterPath.gain, s.filterOn ? 1 : 0)
    set(this.bypassPath.gain, s.filterOn ? 0 : 1)

    // chorus
    set(this.chorusLfo.frequency, s.chorusRate)
    set(this.chorusLfoDepth.gain, s.chorusDepth * 0.008)
    const chorusMix = s.chorusOn ? s.chorusMix : 0
    set(this.chorusDry.gain, 1 - chorusMix)
    set(this.chorusWet.gain, chorusMix)

    // delay
    set(this.delayNode.delayTime, s.delayTime)
    set(this.delayFeedback.gain, s.delayFeedback)
    const delayMix = s.delayOn ? s.delayMix : 0
    set(this.delayDry.gain, 1 - delayMix)
    set(this.delayWet.gain, delayMix)

    // reverb — attach/detach the convolver so idle chains cost nothing
    const reverbActive = s.reverbOn && s.reverbMix > 0
    this.setReverbConnected(reverbActive)
    const reverbMix = reverbActive ? s.reverbMix : 0
    set(this.reverbDry.gain, 1 - reverbMix)
    set(this.reverbWet.gain, reverbMix)
    if (reverbActive) {
      const bucket = Math.round(s.reverbSize * 10)
      if (bucket !== this.reverbBucket) {
        this.reverbBucket = bucket
        this.convolver.buffer = getImpulseResponse(this.ctx, bucket / 10)
      }
    }

    // pan
    set(this.panner.pan, Math.max(-1, Math.min(1, s.pan)))

    this.lastSettings = { ...s }
  }

  private setReverbConnected(active: boolean): void {
    if (active === this.reverbConnected) return
    if (active) {
      this.reverbSend.connect(this.convolver)
      this.convolver.connect(this.reverbWet)
    } else {
      // gain is ramped to 0 by the caller before/after this, so no click
      this.reverbSend.disconnect(this.convolver)
      this.convolver.disconnect(this.reverbWet)
    }
    this.reverbConnected = active
  }

  /** Detach from the master bus and release the whole node island. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try { this.chorusLfo.stop() } catch { /* already stopped */ }
    this.output.disconnect()
    this.input.disconnect()
    this.chorusDry.disconnect()
    this.chorusWet.disconnect()
    this.delayDry.disconnect()
    this.delayWet.disconnect()
    this.reverbDry.disconnect()
    this.reverbWet.disconnect()
    this.reverbSend.disconnect()
    this.convolver.disconnect()
    this.filterPath.disconnect()
    this.bypassPath.disconnect()
    this.panner.disconnect()
  }
}

// ── Impulse response generation ─────────────────────────────────────────────
// Noise burst with exponential decay, darkened by a one-pole lowpass.
// Cached per (sample rate, size bucket) so slider drags don't regenerate.
const irCache = new Map<string, AudioBuffer>()

function getImpulseResponse(ctx: AudioContext, size: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${Math.round(size * 10)}`
  const cached = irCache.get(key)
  if (cached) return cached

  const sr = ctx.sampleRate
  const dur = 0.3 + Math.max(0, Math.min(1, size)) * 3.2 // 0.3s .. 3.5s
  const len = Math.max(64, Math.floor(sr * dur))
  const buf = ctx.createBuffer(2, len, sr)
  const decay = 2.4 // tail curve exponent

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const noise = Math.random() * 2 - 1
      lp += 0.3 * (noise - lp) // darken the tail
      data[i] = lp * Math.pow(1 - t, decay)
    }
    // short fade-in avoids a hard edge at the head
    const fade = Math.min(128, len)
    for (let i = 0; i < fade; i++) data[i] *= i / fade
  }

  if (irCache.size > 24) irCache.clear() // keep the cache small
  irCache.set(key, buf)
  return buf
}
