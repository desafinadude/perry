/*
 * Look-ahead scheduler for the jam band.
 *
 * Bars are arranged one at a time as they come within LOOKAHEAD of the audio
 * clock; their notes are queued with exact AudioContext times and dispatched a
 * little ahead of time, so mute / solo / volume react within ~0.1 s and tempo
 * changes take effect from the next bar.
 */
import type { Chart } from './model'
import { chorusBars, loopBars, type PlayBar } from './unroll'
import { arrangeBar, newArrangerState, type NoteEvent, type Track } from './arranger'
import { styleById, type StyleDef } from './styles'
import type { BuiltinBand } from './builtin'

export interface TrackSettings {
  /** 'builtin' or a zone id. */
  zoneId: string
  volume: number
  mute: boolean
  solo: boolean
}

export interface PlayerSettings {
  styleId: string
  bpm: number
  /** BPM added per chorus. */
  ramp: number
  /** 0 = endless. */
  choruses: number
  countIn: boolean
  click: boolean
  /** Inclusive chart-bar range to loop, or null for the whole form. */
  loop: [number, number] | null
  tracks: Record<Track, TrackSettings>
}

export interface Output {
  ctx: AudioContext
  band: BuiltinBand
  /** Play on a zone; return false if the zone doesn't exist (falls back to built-in). */
  playZone: (zoneId: string, midi: number, velocity: number, when: number, dur: number) => boolean
  /** Silence notes scheduled on zones. */
  stopZones: () => void
}

interface TimelineBar {
  bar: PlayBar | null // null = count-in
  start: number
  spb: number
  bpm: number
}

interface Pending { time: number; ev: NoteEvent; dur: number }
interface Sounding { track: Track; midi: number; start: number; end: number }

export interface Position {
  playing: boolean
  countIn: boolean
  bar: PlayBar | null
  /** Beat within the bar (float). */
  beat: number
  bpm: number
  chorus: number
}

const LOOKAHEAD = 0.25
const DISPATCH_AHEAD = 0.12
const TICK_MS = 25

export class JamPlayer {
  private out: Output
  private chart: Chart | null = null
  private settings: PlayerSettings
  private style: StyleDef
  private timer: number | null = null
  private gen: Iterator<PlayBar> | null = null
  private buffered: PlayBar | null = null
  private nextStart = 0
  private barNo = 0
  private lastChorus = 0
  private pending: Pending[] = []
  private timeline: TimelineBar[] = []
  private sounding: Sounding[] = []
  private state = newArrangerState()
  private ending = false
  onEnd: (() => void) | null = null

  constructor(out: Output, settings: PlayerSettings) {
    this.out = out
    this.settings = settings
    this.style = styleById(settings.styleId)
  }

  get playing() { return this.timer !== null }

  setSettings(s: PlayerSettings) {
    const loopChanged = JSON.stringify(s.loop) !== JSON.stringify(this.settings.loop)
    this.settings = s
    this.style = styleById(s.styleId)
    if (loopChanged && this.playing && this.chart) {
      // restart the bar stream from the next bar boundary
      this.gen = this.makeGen(this.chart, s.loop ? s.loop[0] : 0)
      this.buffered = null
    }
  }

  setChart(chart: Chart) { this.chart = chart }

  async start(chart: Chart, fromBar = 0) {
    this.stop()
    this.chart = chart
    const ctx = this.out.ctx
    if (ctx.state !== 'running') { try { await ctx.resume() } catch { /* gesture needed */ } }
    this.gen = this.makeGen(chart, fromBar)
    this.buffered = null
    this.state = newArrangerState()
    this.barNo = 0
    this.lastChorus = 0
    this.pending = []
    this.timeline = []
    this.sounding = []
    this.ending = false
    this.nextStart = ctx.currentTime + 0.08

    if (this.settings.countIn) {
      const first = this.peek()
      const beats = Math.max(1, Math.round(first?.beats ?? 4))
      const spb = 60 / this.bpmFor(1)
      for (let b = 0; b < beats; b++) this.out.band.drums.click(this.nextStart + b * spb, b === 0)
      this.timeline.push({ bar: null, start: this.nextStart, spb, bpm: this.bpmFor(1) })
      this.nextStart += beats * spb
    }
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.pending = []
    this.sounding = []
    this.timeline = []
    this.out.band.stopAll()
    this.out.stopZones()
  }

  /** Where playback is now (for the UI). */
  position(): Position {
    const now = this.out.ctx.currentTime
    let cur: TimelineBar | null = null
    for (const tb of this.timeline) if (tb.start <= now) cur = tb
    if (!this.playing || !cur) return { playing: this.playing, countIn: false, bar: null, beat: 0, bpm: this.settings.bpm, chorus: 0 }
    return {
      playing: true,
      countIn: cur.bar === null,
      bar: cur.bar,
      beat: Math.max(0, (now - cur.start) / cur.spb),
      bpm: cur.bpm,
      chorus: cur.bar?.chorus ?? 1,
    }
  }

  /** Comp and bass notes sounding now (for the voicing keyboard). */
  soundingNow(): { comp: number[]; bass: number[] } {
    const now = this.out.ctx.currentTime
    const comp: number[] = [], bass: number[] = []
    for (const s of this.sounding) {
      if (s.start <= now && s.end > now) (s.track === 'comp' ? comp : s.track === 'bass' ? bass : []).push(s.midi)
    }
    return { comp, bass }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private bpmFor(chorus: number) {
    return Math.max(30, Math.min(360, this.settings.bpm + this.settings.ramp * Math.max(0, chorus - 1)))
  }

  private *makeGen(chart: Chart, fromBar: number): Generator<PlayBar> {
    const s = this.settings
    if (s.loop) {
      for (let c = 1; ; c++) yield* loopBars(chart, s.loop[0], s.loop[1], c)
    }
    let skipping = fromBar > 0
    // read choruses live so changing it mid-song applies from the next chorus
    for (let c = 1; this.settings.choruses === 0 || c <= this.settings.choruses; c++) {
      const final = this.settings.choruses !== 0 && c === this.settings.choruses
      for (const b of chorusBars(chart, c, final)) {
        if (skipping) { if (b.index < fromBar) continue; skipping = false }
        yield b
      }
      if (chart.bars.length === 0) return
    }
  }

  private peek(): PlayBar | null {
    if (!this.buffered && this.gen) {
      const r = this.gen.next()
      this.buffered = r.done ? null : r.value
    }
    return this.buffered
  }

  private take(): PlayBar | null {
    const b = this.peek()
    this.buffered = null
    return b
  }

  private tick() {
    const ctx = this.out.ctx
    const now = ctx.currentTime

    // arrange bars entering the look-ahead window
    while (!this.ending && this.nextStart < now + LOOKAHEAD) {
      const bar = this.take()
      if (!bar) { this.ending = true; break }
      const next = this.peek()
      const bpm = this.bpmFor(bar.chorus)
      const spb = 60 / bpm
      const chorusStart = bar.chorus !== this.lastChorus && this.lastChorus !== 0
      this.lastChorus = bar.chorus
      const events = arrangeBar(bar, next, this.style, this.state, { barNo: this.barNo++, chorusStart })
      for (const ev of events) {
        // tiny human timing on bass/comp
        const jitter = ev.track === 'drums' ? 0 : (Math.random() - 0.5) * 0.008
        this.pending.push({ time: this.nextStart + ev.t * spb + jitter, ev, dur: ev.d * spb })
      }
      if (this.settings.click) {
        for (let b = 0; b < Math.round(bar.beats); b++) {
          this.pending.push({ time: this.nextStart + b * spb, ev: { track: 'drums', midi: -1, vel: b === 0 ? 1 : 0.5, t: b, d: 0 }, dur: 0 })
        }
      }
      this.timeline.push({ bar, start: this.nextStart, spb, bpm })
      this.nextStart += bar.beats * spb
    }

    // dispatch what's due
    const due = this.pending.filter((p) => p.time < now + DISPATCH_AHEAD)
    if (due.length) {
      this.pending = this.pending.filter((p) => p.time >= now + DISPATCH_AHEAD)
      for (const p of due) this.dispatch(p)
    }

    // housekeeping
    this.timeline = this.timeline.filter((t, i, a) => i === a.length - 1 || a[i + 1].start > now - 2)
    this.sounding = this.sounding.filter((s) => s.end > now - 0.1)

    if (this.ending && this.pending.length === 0 && now > this.nextStart + 0.2) {
      this.stop()
      this.onEnd?.()
    }
  }

  private dispatch(p: Pending) {
    const { ev } = p
    const time = Math.max(p.time, this.out.ctx.currentTime)
    if (ev.midi < 0) { this.out.band.drums.click(time, ev.vel > 0.9); return }
    const tracks = this.settings.tracks
    const t = tracks[ev.track]
    const anySolo = (Object.keys(tracks) as Track[]).some((k) => tracks[k].solo)
    if (t.mute || (anySolo && !t.solo)) return
    const vel = Math.max(0, Math.min(1, ev.vel * t.volume))
    if (vel <= 0.01) return
    const vel127 = Math.max(1, Math.round(vel * 127))
    let played = false
    if (t.zoneId !== 'builtin') {
      // GM drum kits are very velocity-sensitive; lift soft hits so a
      // SoundFont kit sits at about the same level as the built-in one.
      const zoneVel = ev.track === 'drums' ? Math.max(1, Math.round(127 * Math.pow(vel, 0.55))) : vel127
      played = this.out.playZone(t.zoneId, ev.midi, zoneVel, time, p.dur)
    }
    if (!played) {
      const band = this.out.band
      if (ev.track === 'drums') band.drums.play(ev.midi, vel, time)
      else if (ev.track === 'bass') band.bass.playNote(ev.midi, vel127, time, p.dur)
      else band.keys.playNote(ev.midi, vel127, time, p.dur)
    }
    if (ev.track !== 'drums') this.sounding.push({ track: ev.track, midi: ev.midi, start: time, end: time + p.dur })
  }
}
