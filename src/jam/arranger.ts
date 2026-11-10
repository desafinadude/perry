/*
 * The band: turns one played bar + a style into note events.
 * Bass walks or follows its pattern; the comp part voice-leads from the
 * previous voicing so chords move by the smallest steps.
 */
import type { PlayBar, PlayChord } from './unroll'
import type { StyleDef, BassDegree, Voicing } from './styles'
import { parseChord, type Chord } from './chords'

export type Track = 'drums' | 'bass' | 'comp'

export interface NoteEvent {
  track: Track
  midi: number
  /** 0..1 */
  vel: number
  /** Beats from bar start (swing already applied). */
  t: number
  /** Length in beats. */
  d: number
}

export interface ArrangerState {
  lastBass: number
  lastVoicing: number[]
}

export const newArrangerState = (): ArrangerState => ({ lastBass: 40, lastVoicing: [] })

const BASS_LO = 28  // E1
const BASS_HI = 50  // D3
const COMP_LO = 50  // D3
const COMP_HI = 76  // E5
const COMP_CENTER = 62

const chordCache = new Map<string, Chord | null>()
export function chordOf(text: string): Chord | null {
  if (text === 'n') return null
  if (!chordCache.has(text)) chordCache.set(text, parseChord(text).chord ?? null)
  return chordCache.get(text) ?? null
}

/** Apply swing to off-beat eighths. */
function swingT(t: number, swing: number): number {
  const whole = Math.floor(t)
  const frac = t - whole
  if (Math.abs(frac - 0.5) < 1e-6) return whole + swing
  return t
}

function chordAt(bar: PlayBar, t: number): PlayChord | undefined {
  return bar.chords.find((c) => t >= c.start - 1e-6 && t < c.start + c.len - 1e-6) ?? bar.chords[bar.chords.length - 1]
}

/** Chord used by a hit at t, anticipating a change within half a beat. */
function chordForHit(bar: PlayBar, next: PlayBar | null, t: number): PlayChord | undefined {
  const cur = chordAt(bar, t)
  if (!cur) return undefined
  const changeAt = cur.start + cur.len
  if (changeAt - t <= 0.5 && changeAt - t > 1e-6) {
    if (changeAt < bar.beats - 1e-6) return chordAt(bar, changeAt)
    if (next?.chords[0]) return next.chords[0]
  }
  return cur
}

function near(pc: number, target: number, lo: number, hi: number): number {
  let best = -1, bestD = Infinity
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 !== ((pc % 12) + 12) % 12) continue
    const d = Math.abs(m - target)
    if (d < bestD) { best = m; bestD = d }
  }
  return best < 0 ? lo + (((pc - lo) % 12) + 12) % 12 : best
}

const rnd = (a: number) => 1 + (Math.random() * 2 - 1) * a

// ── voicings ────────────────────────────────────────────────────────────────

function voicingPcs(c: Chord, kind: Voicing): number[] {
  const r = c.root
  const third = c.third ?? 7
  const fifth = c.fifth ?? 7
  const seventh = c.seventh
  const tens = c.tensions.filter((t) => t > 12).map((t) => t - 12)
  const altered = tens.filter((t) => t === 1 || t === 3 || t === 6 || t === 8)
  if (kind === 'triad') {
    const pcs = [0, third, fifth]
    if (seventh !== null) pcs.push(seventh)
    return pcs.map((x) => (r + x) % 12)
  }
  if (kind === 'shell') {
    const pcs = [third, seventh ?? fifth, tens[0] ?? fifth]
    return [...new Set(pcs)].map((x) => (r + x) % 12)
  }
  // rootless / spread: guide tones + two colours
  if (c.third === 3 && c.fifth === 6 && seventh === 9) return [0, 3, 6, 9].map((x) => (r + x) % 12) // dim7
  const colours: number[] = []
  if (altered.length) colours.push(...altered.slice(0, 2))
  else if (tens.length) colours.push(...tens.slice(0, 2))
  if (colours.length < 2) {
    const isDom = seventh === 10 && c.third === 4
    const isHalfDim = c.fifth === 6 && seventh === 10
    const extra = isHalfDim ? [6, 5] : isDom ? [2, 9] : seventh === 9 ? [2, 7] : [2, fifth]
    for (const e of extra) if (colours.length < 2 && !colours.includes(e)) colours.push(e)
  }
  const pcs = [third, seventh ?? (c.intervals.includes(9) ? 9 : fifth), ...colours]
  return [...new Set(pcs.map((x) => (r + x) % 12))]
}

/** Close-position voicings within range, picked by smallest movement. */
function voiceLead(pcs: number[], prev: number[], lo: number, hi: number, center: number): number[] {
  const sorted = [...pcs].sort((a, b) => a - b)
  const candidates: number[][] = []
  for (let rot = 0; rot < sorted.length; rot++) {
    const order = [...sorted.slice(rot), ...sorted.slice(0, rot)]
    for (let base = lo; base < lo + 12; base++) {
      if (base % 12 !== order[0]) continue
      const v = [base]
      for (let k = 1; k < order.length; k++) {
        let m = v[k - 1] + 1
        while (m % 12 !== order[k]) m++
        v.push(m)
      }
      if (v[v.length - 1] <= hi) candidates.push(v)
      // also the same shape an octave up
      const up = v.map((x) => x + 12)
      if (up[up.length - 1] <= hi) candidates.push(up)
    }
  }
  if (!candidates.length) return sorted.map((p) => near(p, center, lo, hi))
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  let best = candidates[0], bestCost = Infinity
  for (const v of candidates) {
    let cost = Math.abs(mean(v) - center) * 0.6
    if (prev.length) {
      // movement: each new note to its nearest previous note
      cost += v.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0)
    }
    if (cost < bestCost) { bestCost = cost; best = v }
  }
  return best
}

// ── bass ───────────────────────────────────────────────────────────────────

function bassRoot(c: Chord): number { return c.bass ?? c.root }

function degreePc(c: Chord, deg: BassDegree): number {
  switch (deg) {
    case 'fifth': return (c.root + (c.fifth ?? 7)) % 12
    case 'third': return (c.root + (c.third ?? 4)) % 12
    case 'seventh': return (c.root + (c.seventh ?? 10)) % 12
    default: return bassRoot(c)
  }
}

function walkBar(bar: PlayBar, next: PlayBar | null, st: ArrangerState, v: number, barNo: number): NoteEvent[] {
  const out: NoteEvent[] = []
  const beats = Math.floor(bar.beats)
  for (let b = 0; b < beats; b++) {
    const pc = chordAt(bar, b)
    const c = pc ? chordOf(pc.text) : null
    if (!c || !pc) continue
    const changeAt = pc.start + pc.len
    const nextText = changeAt < bar.beats - 1e-6 ? chordAt(bar, changeAt)?.text : next?.chords[0]?.text
    const nc = nextText ? chordOf(nextText) : null
    let note: number
    if (Math.abs(b - pc.start) < 1e-6) {
      note = near(bassRoot(c), st.lastBass, BASS_LO, BASS_HI)
    } else if (b + 1 >= changeAt - 1e-6 && nc) {
      const target = near(bassRoot(nc), st.lastBass, BASS_LO + 1, BASS_HI - 1)
      const style = (barNo + b) % 4
      if (style === 3) note = near(bassRoot(nc) + 7, target, BASS_LO, BASS_HI) // dominant approach
      else note = target + (target >= st.lastBass ? -1 : 1) // chromatic approach
      if (note === st.lastBass || note === target) note = target + (target >= st.lastBass ? -1 : 1)
    } else {
      // step through chord tones toward the next target
      const tones = [c.third ?? 4, c.fifth ?? 7, c.seventh ?? 12, 12].map((x) => (c.root + x) % 12)
      const target = nc ? near(bassRoot(nc), st.lastBass, BASS_LO, BASS_HI) : st.lastBass
      const dir = target === st.lastBass ? (st.lastBass > 40 ? -1 : 1) : Math.sign(target - st.lastBass)
      const aim = st.lastBass + dir * 4
      let best = st.lastBass, bestD = Infinity
      for (const t of tones) {
        const m = near(t, aim, BASS_LO, BASS_HI)
        const d = Math.abs(m - aim) + (m === st.lastBass ? 10 : 0)
        if (d < bestD) { bestD = d; best = m }
      }
      note = best
    }
    note = Math.max(BASS_LO, Math.min(BASS_HI, note))
    out.push({ track: 'bass', midi: note, vel: v * (b % 2 === 0 ? 1 : 0.9) * rnd(0.06), t: b, d: 0.92 })
    st.lastBass = note
  }
  return out
}

function patternBass(bar: PlayBar, next: PlayBar | null, st: ArrangerState, style: StyleDef, barNo: number): NoteEvent[] {
  if (style.bass.walking) return []
  const pat = style.bass.bars[barNo % style.bass.bars.length]
  const out: NoteEvent[] = []
  for (const h of pat) {
    if (h.t >= bar.beats - 1e-6) continue
    const pcText = chordAt(bar, h.t)
    const c = pcText ? chordOf(pcText.text) : null
    if (!c || !pcText) continue
    let note: number
    if (h.deg === 'approach') {
      const changeAt = pcText.start + pcText.len
      const nextText = changeAt < bar.beats - 1e-6 ? chordAt(bar, changeAt)?.text : next?.chords[0]?.text
      const nc = nextText ? chordOf(nextText) : c
      const target = near(bassRoot(nc ?? c), st.lastBass, BASS_LO + 1, BASS_HI - 1)
      note = target + (target >= st.lastBass ? -1 : 1)
    } else if (h.deg === 'octave') {
      note = near(bassRoot(c), st.lastBass + 12, BASS_LO, BASS_HI + 12)
    } else {
      const onChange = Math.abs(h.t - pcText.start) < 1e-6
      const pc = degreePc(c, h.deg)
      note = near(pc, onChange || h.deg !== 'root' ? st.lastBass : st.lastBass, BASS_LO, BASS_HI)
    }
    // a chord change inside a long note cuts it
    const end = Math.min(h.t + h.d, pcText.start + pcText.len)
    out.push({ track: 'bass', midi: note, vel: h.v * rnd(0.06), t: swingT(h.t, style.swing), d: Math.max(0.1, end - h.t) })
    if (h.deg !== 'octave') st.lastBass = note
  }
  return out
}

// ── public ─────────────────────────────────────────────────────────────────

export interface ArrangeOptions {
  /** Global bar counter (pattern cycling, variation). */
  barNo: number
  /** True on the first bar of a chorus after the first one. */
  chorusStart: boolean
}

export function arrangeBar(
  bar: PlayBar, next: PlayBar | null, style: StyleDef, st: ArrangerState, o: ArrangeOptions,
): NoteEvent[] {
  const ev: NoteEvent[] = []
  const nc = bar.chords.every((c) => c.text === 'n')

  // drums
  const dpat = style.drums.bars[o.barNo % style.drums.bars.length]
  for (const h of dpat) {
    if (h.t >= bar.beats - 1e-6) continue
    ev.push({ track: 'drums', midi: h.n, vel: h.v * rnd(0.08), t: swingT(h.t, style.swing), d: 0.25 })
  }
  if (o.chorusStart && style.drums.crashOnChorus) ev.push({ track: 'drums', midi: 49, vel: 0.6, t: 0, d: 1 })

  if (nc) return ev

  // bass
  if (style.bass.walking) ev.push(...walkBar(bar, next, st, style.bass.v, o.barNo))
  else ev.push(...patternBass(bar, next, st, style, o.barNo))

  // comp
  const cpat = style.comp.bars[o.barNo % style.comp.bars.length]
  const hits = cpat.filter((h) => h.t < bar.beats - 1e-6).map((h) => ({ ...h }))
  if (style.comp.fillChanges) {
    for (const c of bar.chords) {
      if (!hits.some((h) => Math.abs(h.t - c.start) <= 0.5)) hits.push({ t: c.start, d: c.len - 0.1, v: hits[0]?.v ?? 0.5 })
    }
  }
  hits.sort((a, b) => a.t - b.t)
  for (const h of hits) {
    const pc = chordForHit(bar, next, h.t)
    const c = pc ? chordOf(pc.text) : null
    if (!c || !pc) continue
    const kind = style.comp.voicing
    let notes = voiceLead(voicingPcs(c, kind), st.lastVoicing, COMP_LO, COMP_HI, COMP_CENTER)
    st.lastVoicing = notes
    if (kind === 'spread') notes = [near(c.root, 48, 40, 52), ...notes]
    if (kind === 'shell') { const low = Math.min(...notes); notes = [near(bassRoot(c), low - 7, 38, low - 1), ...notes] }
    // don't ring over the next chord
    const pcStart = pc.start > h.t + 1e-6 ? h.t : pc.start
    const until = pc === chordAt(bar, h.t) ? pcStart + pc.len : h.t + h.d
    const d = Math.max(0.1, Math.min(h.d, until - h.t))
    const t = swingT(h.t, style.swing)
    for (const m of notes) ev.push({ track: 'comp', midi: m, vel: h.v * rnd(0.07), t, d })
  }
  return ev
}

/** Notes of the comp voicing that would sound for a chord (for display). */
export function previewVoicing(text: string, style: StyleDef, prev: number[] = []): number[] {
  const c = chordOf(text)
  if (!c) return []
  return voiceLead(voicingPcs(c, style.comp.voicing), prev, COMP_LO, COMP_HI, COMP_CENTER)
}
