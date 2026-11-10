/* Chord-chart model used by the JAM tab. Mirrors what iReal Pro can express. */

export interface ChartChord {
  /** Beat (0-based, in quarter notes from the start of the bar). */
  beat: number
  /** iReal chord text, e.g. "C-7/Bb", or "n" for N.C. */
  text: string
  /** Optional small alternate chord shown above (iReal "(…)"). */
  alt?: string
}

export interface ChartBar {
  chords: ChartChord[]
  /** 'x' = repeat previous bar, 'r' = this and next bar repeat the previous two. */
  repeat?: 'x' | 'r'
  /** Left barline when not a plain single line. */
  open?: '[' | '{'
  /** Right barline when not a plain single line. */
  close?: ']' | '}' | 'Z'
  /** Rehearsal mark: A B C D, i (intro), V (verse). */
  section?: string
  /** Ending number (1, 2, 3; 0 = unnumbered). */
  ending?: number
  /** Time signature change at this bar, iReal digits: '44', '34', '68', '12' (=12/8). */
  timeSig?: string
  segno?: boolean
  /** Coda sign ("to coda" on first appearance, the coda itself on the second). */
  coda?: boolean
  fermata?: boolean
  /** Staff text, e.g. "D.C. al Coda", "Fine", "3x". */
  text?: string
}

export interface Chart {
  id: string
  title: string
  composer: string
  /** iReal style label, e.g. "Medium Swing". */
  style: string
  /** iReal key: "C", "Eb", "A-" … */
  key: string
  /** Default time signature, iReal digits. */
  timeSig: string
  /** Tempo from the source chart, if any. */
  bpm: number | null
  /** Choruses from the source chart, if any. */
  repeats: number | null
  bars: ChartBar[]
  /** Library group. */
  playlist: string
  /** Display/playback transposition in semitones. */
  transpose: number
  /** Jam style id chosen by the user (overrides the mapping from `style`). */
  jamStyle?: string
  builtIn?: boolean
}

let seq = 0
export const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Quarter-note beats in a bar for an iReal time-signature string. */
export function barBeats(ts: string): number {
  const [n, d] = splitTimeSig(ts)
  return (n * 4) / d
}

export function splitTimeSig(ts: string): [number, number] {
  if (ts === '12') return [12, 8]
  const n = Number(ts[0]), d = Number(ts.slice(1))
  return [n || 4, d || 4]
}

export function timeSigLabel(ts: string): string {
  const [n, d] = splitTimeSig(ts)
  return `${n}/${d}`
}

/** Time signature in force at each bar. */
export function barTimeSigs(chart: Chart): string[] {
  let ts = chart.timeSig
  return chart.bars.map((b) => (ts = b.timeSig ?? ts))
}

export function emptyChart(playlist = 'My charts'): Chart {
  return {
    id: uid(), title: 'Untitled', composer: '', style: 'Medium Swing', key: 'C',
    timeSig: '44', bpm: null, repeats: null, playlist, transpose: 0,
    bars: Array.from({ length: 8 }, (_, i) => ({ chords: i === 0 ? [{ beat: 0, text: 'C^7' }] : [] , ...(i === 0 ? { open: '[' as const, section: 'A' } : {}), ...(i === 7 ? { close: 'Z' as const } : {}) })),
  }
}

/**
 * Spread a bar's chords over its beats the way iReal does when it only
 * knows their order: 1 → whole bar, 2 → halves, 3 in 4/4 → 2+1+1, 4 → 1 each.
 */
export function assignBeats(texts: { text: string; alt?: string }[], beats: number): ChartChord[] {
  const n = texts.length
  if (n === 0) return []
  let starts: number[]
  if (n === 1) starts = [0]
  else if (n === 3 && beats === 4) starts = [0, 2, 3]
  else if (n === 2 && beats === 3) starts = [0, 2]
  else starts = texts.map((_, i) => Math.round(((i * beats) / n) * 2) / 2)
  return texts.map((t, i) => ({ beat: starts[i], text: t.text, ...(t.alt ? { alt: t.alt } : {}) }))
}
