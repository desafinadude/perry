/*
 * Turn a chart's notation into the sequence of bars actually played:
 * repeats with 1st/2nd endings, x / r measure repeats, empty bars that hold
 * the previous chord, and D.C. / D.S. al Coda / al Fine.
 *
 * Choruses follow iReal Pro's habit: every chorus plays the form up to the
 * D.C./D.S. instruction; the last chorus takes the "to Coda" jump (or stops
 * at Fine), so the coda is heard once, at the very end.
 */
import type { Chart, ChartBar } from './model'
import { barBeats, barTimeSigs } from './model'
import { keyPrefersFlats, transposeKey, transposeSymbol } from './chords'

export interface PlayChord {
  /** Resolved iReal text ('n' = N.C.). */
  text: string
  start: number
  len: number
}

export interface PlayBar {
  /** Index of the bar in the chart's notation. */
  index: number
  beats: number
  timeSig: string
  chords: PlayChord[]
  chorus: number
}

/** Static resolution of measure repeats; empty bars come back as []. */
export function resolveChords(chart: Chart): { text: string; beat: number }[][] {
  const out: { text: string; beat: number }[][] = []
  const bars = chart.bars
  bars.forEach((b, i) => {
    if (b.repeat === 'x') out.push(out[i - 1] ?? [])
    else if (b.repeat === 'r') out.push(out[i - 2] ?? out[i - 1] ?? [])
    else if (b.chords.length === 0 && i > 0 && bars[i - 1].repeat === 'r') out.push(out[i - 2] ?? [])
    else out.push(b.chords.map((c) => ({ text: c.text, beat: c.beat })))
  })
  return out
}

const isJump = (b: ChartBar) => !!b.text && /D\.?\s?[CS]\.?/i.test(b.text)
const isFine = (b: ChartBar) => !!b.text && /\bFine\b/i.test(b.text) && !isJump(b)

function repeatTimes(bars: ChartBar[], from: number): number {
  // "3x" written on the repeat, or as many passes as there are endings (N1 N2 N3)
  let endings = 0
  let text = 0
  let j = from
  // up to the first "}"
  for (; j < bars.length; j++) {
    const b = bars[j]
    if (b.ending !== undefined) endings = Math.max(endings, b.ending)
    if (b.close === '}') {
      const m = b.text?.match(/(\d+)\s*x/i) ?? bars[from].text?.match(/(\d+)\s*x/i)
      if (m) text = Number(m[1])
      break
    }
  }
  // then any further endings (N2 … N3 …) that follow it
  if (endings > 0) {
    for (j++; j < bars.length; j++) {
      const b = bars[j]
      if (b.open && b.ending === undefined) break
      if (b.ending !== undefined) endings = Math.max(endings, b.ending)
      if (b.close === ']' || b.close === 'Z') break
    }
  }
  return Math.max(2, text, endings)
}

/** Bar indices for one pass through the form. */
export function formOrder(chart: Chart, final: boolean, startAt = 0): number[] {
  const bars = chart.bars
  const n = bars.length
  const codaIdx = bars.map((b, i) => (b.coda ? i : -1)).filter((i) => i >= 0)
  const toCoda = codaIdx.length >= 2 ? codaIdx[0] : -1
  const codaTarget = codaIdx.length >= 2 ? codaIdx[codaIdx.length - 1] : -1
  const hasFine = bars.some(isFine)

  const order: number[] = []
  let i = startAt
  let repStart = -1
  let pass = 1
  let times = 2
  let guard = 0
  // where an unmatched "}" repeats back to: the start, or just after the last repeat
  let afterRepeat = startAt

  const endingBlockEnd = (from: number) => {
    for (let j = from; j < n; j++) if (bars[j].close === '}') return j
    return -1
  }

  while (i < n && guard++ < 5000) {
    const b = bars[i]
    if (b.open === '{' && i !== repStart) { repStart = i; pass = 1; times = repeatTimes(bars, i) }

    if (b.ending !== undefined && b.ending > 0 && repStart >= 0 && b.ending !== pass) {
      const end = endingBlockEnd(i)
      if (end >= 0) { i = end + 1; continue }
    }

    order.push(i)

    if (final && i === toCoda && codaTarget > i) { i = codaTarget; continue }
    if (final && hasFine && isFine(b)) break
    if (isJump(b)) break

    if (b.close === '}') {
      if (repStart < 0) { repStart = afterRepeat; pass = 1; times = repeatTimes(bars, repStart) } // unmatched "}"
      if (pass < times) { pass++; i = repStart; continue }
      // repeat finished: a later unmatched "}" goes back to here
      repStart = -1; pass = 1; afterRepeat = i + 1
    }
    i++
  }
  return order
}

export interface UnrollOptions {
  /** Number of choruses (0 = endless, generated lazily by the player). */
  choruses: number
  /** Loop a range of chart bars instead of the form (inclusive). */
  loop?: [number, number] | null
}

/** Build one chorus worth of PlayBars (transposed, empty bars held). */
export function chorusBars(chart: Chart, chorus: number, final: boolean): PlayBar[] {
  const segno = chart.bars.findIndex((b) => b.segno)
  const usesDS = chart.bars.some((b) => !!b.text && /D\.?\s?S\./i.test(b.text))
  const start = chorus > 1 && usesDS && segno >= 0 ? segno : 0
  return toPlayBars(chart, formOrder(chart, final, start), chorus)
}

export function loopBars(chart: Chart, from: number, to: number, chorus: number): PlayBar[] {
  const order: number[] = []
  for (let i = Math.max(0, from); i <= Math.min(chart.bars.length - 1, to); i++) order.push(i)
  return toPlayBars(chart, order, chorus)
}

function toPlayBars(chart: Chart, order: number[], chorus: number): PlayBar[] {
  const resolved = resolveChords(chart)
  const sigs = barTimeSigs(chart)
  const flats = keyPrefersFlats(transposeKey(chart.key, chart.transpose))
  let carry = 'n'
  // seed the carry with the chord sounding before the first bar we play
  for (let j = (order[0] ?? 0) - 1; j >= 0; j--) {
    const r = resolved[j]
    if (r.length) { carry = r[r.length - 1].text; break }
  }
  return order.map((idx) => {
    const ts = sigs[idx]
    const beats = barBeats(ts)
    const src = resolved[idx].length ? resolved[idx] : [{ text: carry, beat: 0 }]
    const sorted = [...src].sort((a, b) => a.beat - b.beat)
    if (sorted[0].beat > 0) sorted.unshift({ text: carry, beat: 0 })
    const chords = sorted.map((c, k) => ({
      text: c.text === 'n' ? 'n' : transposeSymbol(c.text, chart.transpose, flats),
      start: c.beat,
      len: (k + 1 < sorted.length ? sorted[k + 1].beat : beats) - c.beat,
    })).filter((c) => c.len > 0)
    carry = sorted[sorted.length - 1].text
    return { index: idx, beats, timeSig: ts, chords, chorus }
  })
}
