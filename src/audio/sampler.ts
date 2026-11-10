import type { SamplerSettings } from '../types'

interface Voice {
  note: number
  src: AudioBufferSourceNode
  vca: GainNode
  peak: number
  startedAt: number
}

/**
 * Sample cache keyed by file name so saved configs can re-attach their
 * sample within the same session. Buffers are not persisted to disk —
 * after a page reload the user re-picks the file once.
 */
const sampleCache = new Map<string, AudioBuffer>()

export function cacheSample(fileName: string, buffer: AudioBuffer): void {
  // keep the cache bounded
  if (sampleCache.size > 32) {
    const first = sampleCache.keys().next().value
    if (first !== undefined) sampleCache.delete(first)
  }
  sampleCache.set(fileName, buffer)
}

export function getCachedSample(fileName: string): AudioBuffer | undefined {
  return sampleCache.get(fileName)
}

/**
 * Sampler engine: one decoded AudioBuffer pitched across the zone's
 * note range around a root note. Supports looping (with trim points)
 * and one-shot mode for drums, plus an ADSR VCA and velocity scaling.
 */
export class Sampler {
  readonly output: GainNode

  private readonly ctx: AudioContext
  private settings: SamplerSettings
  private buffer: AudioBuffer | null = null
  private readonly voices = new Map<number, Voice[]>()
  private readonly scheduled = new Set<{ src: AudioBufferSourceNode; vca: GainNode }>()
  private readonly sustained = new Set<number>()
  private sustainPedal = false
  private volume = 1
  private disposed = false

  constructor(ctx: AudioContext, settings: SamplerSettings) {
    this.ctx = ctx
    this.settings = settings
    this.output = ctx.createGain()
    this.output.gain.value = 1
    if (settings.fileName) {
      const cached = getCachedSample(settings.fileName)
      if (cached) this.buffer = cached
    }
  }

  setSettings(s: SamplerSettings): void {
    this.settings = s
    if (this.disposed) return
    // pick up a buffer if the file arrived in cache after construction
    if (!this.buffer && s.fileName) {
      const cached = getCachedSample(s.fileName)
      if (cached) this.buffer = cached
    }
    // live-update sounding voices: pitch (root note), loop region, sustain
    const now = this.ctx.currentTime
    for (const list of this.voices.values()) {
      for (const v of list) {
        v.src.playbackRate.setTargetAtTime(Math.pow(2, (v.note - s.rootNote) / 12), now, 0.01)
        const buf = v.src.buffer
        if (buf) {
          const start = Math.max(0, Math.min(s.loopStart, buf.duration - 0.01))
          const end = Math.max(start + 0.01, Math.min(s.loopEnd || buf.duration, buf.duration))
          v.src.loopStart = start
          v.src.loopEnd = end
        }
        v.src.loop = s.loop
        if (now >= v.startedAt + s.ampAttack + s.ampDecay) {
          v.vca.gain.cancelScheduledValues(now)
          v.vca.gain.setTargetAtTime(Math.max(0, Math.min(1, s.ampSustain)) * v.peak, now, 0.02)
        }
      }
    }
  }

  /** Pick up this zone's sample from the cache (after a restore). */
  reloadFromCache(): void {
    if (this.disposed || !this.settings.fileName) return
    const cached = getCachedSample(this.settings.fileName)
    if (cached) this.buffer = cached
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer
  }

  getSample(): { fileName: string; duration: number } | null {
    if (!this.buffer) return null
    return { fileName: this.settings.fileName, duration: this.buffer.duration }
  }

  setVolume(v: number): void {
    this.volume = v
    if (!this.disposed) {
      this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015)
    }
  }

  noteOn(note: number, velocity: number): void {
    if (this.disposed) return
    const buf = this.buffer
    if (!buf) return

    const ctx = this.ctx
    const s = this.settings
    const now = ctx.currentTime
    const vel = Math.max(0, Math.min(1, velocity / 127))
    const peak = Math.pow(vel, 1.4) * 0.9

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = Math.pow(2, (note - s.rootNote) / 12)

    if (s.loop) {
      src.loop = true
      const start = Math.max(0, Math.min(s.loopStart, buf.duration - 0.01))
      const end = Math.max(start + 0.01, Math.min(s.loopEnd || buf.duration, buf.duration))
      src.loopStart = start
      src.loopEnd = end
    } else {
      src.loop = false
    }

    const vca = ctx.createGain()
    const a = Math.max(0.001, s.ampAttack)
    const d = Math.max(0.001, s.ampDecay)
    const sus = Math.max(0, Math.min(1, s.ampSustain)) * peak
    vca.gain.setValueAtTime(0, now)
    vca.gain.linearRampToValueAtTime(peak, now + a)
    vca.gain.linearRampToValueAtTime(sus, now + a + d)

    src.connect(vca)
    vca.connect(this.output)
    src.start(now)

    const voice: Voice = { note, src, vca, peak, startedAt: now }
    const list = this.voices.get(note) ?? []
    // one-shot drums retrigger cleanly; sustained sources overlap
    if (s.oneShot) {
      for (const old of list) this.stopVoice(old, 0.02)
      this.voices.set(note, [voice])
    } else {
      list.push(voice)
      this.voices.set(note, list)
    }

    // loop can be switched off live, so clean up whenever the source ends
    src.onended = () => {
      this.removeVoice(voice)
      try { vca.disconnect() } catch { /* already disconnected */ }
    }
  }

  /**
   * Play at an exact audio-clock time for a fixed length (jam band). The
   * voice is independent of live keyboard voices and cleans itself up.
   * One-shot samples ignore the length and play to the end.
   */
  playNote(note: number, velocity: number, when: number, duration: number): void {
    if (this.disposed || !this.buffer) return
    const ctx = this.ctx
    const s = this.settings
    const buf = this.buffer
    const start = Math.max(when, ctx.currentTime)
    const peak = Math.pow(Math.max(0, Math.min(1, velocity / 127)), 1.4) * 0.9

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = Math.pow(2, (note - s.rootNote) / 12)
    if (s.loop) {
      src.loop = true
      const ls = Math.max(0, Math.min(s.loopStart, buf.duration - 0.01))
      src.loopStart = ls
      src.loopEnd = Math.max(ls + 0.01, Math.min(s.loopEnd || buf.duration, buf.duration))
    }
    const vca = ctx.createGain()
    const a = Math.max(0.001, s.ampAttack)
    const d = Math.max(0.001, s.ampDecay)
    const sus = Math.max(0, Math.min(1, s.ampSustain)) * peak
    const g = vca.gain
    g.setValueAtTime(0, start)
    g.linearRampToValueAtTime(peak, start + a)
    g.linearRampToValueAtTime(sus, start + a + d)
    src.connect(vca)
    vca.connect(this.output)
    src.start(start)
    if (!s.oneShot) {
      const end = start + Math.max(0.03, duration, a)
      const rel = Math.max(0.01, s.ampRelease)
      g.cancelScheduledValues(end)
      g.setTargetAtTime(0, end, rel / 4)
      src.stop(end + rel + 0.1)
    }
    const v = { src, vca }
    this.scheduled.add(v)
    src.onended = () => {
      this.scheduled.delete(v)
      try { src.disconnect(); vca.disconnect() } catch { /* gone */ }
    }
  }

  /** Fade out every scheduled (jam) voice. */
  stopScheduled(): void {
    const now = this.ctx.currentTime
    for (const v of [...this.scheduled]) {
      try {
        v.vca.gain.cancelScheduledValues(now)
        v.vca.gain.setValueAtTime(v.vca.gain.value, now)
        v.vca.gain.linearRampToValueAtTime(0, now + 0.05)
        v.src.stop(now + 0.1)
      } catch { /* already stopped */ }
    }
    this.scheduled.clear()
  }

  noteOff(note: number): void {
    if (this.disposed) return
    if (this.settings.oneShot) return // drum mode: let it ring
    if (this.sustainPedal) {
      this.sustained.add(note)
      return
    }
    this.releaseNote(note)
  }

  private releaseNote(note: number): void {
    const list = this.voices.get(note)
    if (!list) return
    const rel = Math.max(0.01, this.settings.ampRelease)
    for (const v of [...list]) this.stopVoice(v, rel)
    this.voices.delete(note)
  }

  private stopVoice(v: Voice, release: number): void {
    const now = this.ctx.currentTime
    try {
      const g = v.vca.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + release)
      v.src.stop(now + release + 0.05)
    } catch { /* already stopped */ }
    setTimeout(() => {
      try { v.src.disconnect(); v.vca.disconnect() } catch { /* gone */ }
    }, (release + 0.3) * 1000)
    this.removeVoice(v)
  }

  private removeVoice(v: Voice): void {
    const list = this.voices.get(v.note)
    if (!list) return
    const idx = list.indexOf(v)
    if (idx >= 0) list.splice(idx, 1)
    if (list.length === 0) this.voices.delete(v.note)
  }

  /** Sustain pedal (CC64): defers releases until the pedal comes up. */
  setSustain(on: boolean): void {
    if (on === this.sustainPedal) return
    this.sustainPedal = on
    if (!on) {
      for (const note of [...this.sustained]) this.releaseNote(note)
      this.sustained.clear()
    }
  }

  /** Soft stop: release every voice through the amp envelope. */
  allNotesOff(): void {
    if (this.disposed) return
    this.sustainPedal = false
    this.sustained.clear()
    const rel = Math.max(0.05, Math.min(0.2, this.settings.ampRelease))
    for (const list of [...this.voices.values()]) {
      for (const v of [...list]) this.stopVoice(v, rel)
    }
    this.voices.clear()
    this.stopScheduled()
  }


  /** Hard cut — panic path. */
  kill(): void {
    for (const list of [...this.voices.values()]) {
      for (const v of list) {
        try {
          v.vca.gain.cancelScheduledValues(this.ctx.currentTime)
          v.vca.gain.setValueAtTime(0, this.ctx.currentTime)
          v.src.stop(this.ctx.currentTime)
        } catch { /* already stopped */ }
        try { v.src.disconnect(); v.vca.disconnect() } catch { /* gone */ }
      }
    }
    this.voices.clear()
    this.stopScheduled()
    this.sustained.clear()
    this.sustainPedal = false
  }

  dispose(): void {
    if (this.disposed) return
    this.kill()
    this.disposed = true
    this.output.disconnect()
    this.buffer = null
  }
}
