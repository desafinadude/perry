/* Pure edit operations on charts (each returns a new chart). */
import type { Chart, ChartBar } from './model'

const clone = (c: Chart): Chart => structuredClone(c)

export function setChord(chart: Chart, bar: number, beat: number, text: string | null): Chart {
  const c = clone(chart)
  const b = c.bars[bar]
  if (!b) return chart
  b.chords = b.chords.filter((ch) => Math.abs(ch.beat - beat) > 1e-6)
  if (text) b.chords.push({ beat, text })
  b.chords.sort((a, z) => a.beat - z.beat)
  if (b.chords.length) delete b.repeat
  return c
}

export function setRepeatMark(chart: Chart, bar: number, mark: 'x' | null): Chart {
  const c = clone(chart)
  const b = c.bars[bar]
  if (!b) return chart
  if (mark) { b.repeat = mark; b.chords = [] } else delete b.repeat
  return c
}

export function patchBar(chart: Chart, bar: number, patch: Partial<ChartBar>): Chart {
  const c = clone(chart)
  const b = c.bars[bar]
  if (!b) return chart
  for (const [k, v] of Object.entries(patch) as [keyof ChartBar, unknown][]) {
    if (v === undefined || v === null || v === '') delete (b as unknown as Record<string, unknown>)[k]
    else (b as unknown as Record<string, unknown>)[k] = v
  }
  return c
}

export function insertBarAfter(chart: Chart, bar: number): Chart {
  const c = clone(chart)
  const prev = c.bars[bar]
  const nb: ChartBar = { chords: [] }
  // a final barline moves to the new last bar
  if (prev?.close === 'Z') { delete prev.close; nb.close = 'Z' }
  c.bars.splice(bar + 1, 0, nb)
  return c
}

export function duplicateBar(chart: Chart, bar: number): Chart {
  const c = clone(chart)
  const src = c.bars[bar]
  if (!src) return chart
  const copy: ChartBar = { chords: structuredClone(src.chords), ...(src.repeat ? { repeat: src.repeat } : {}) }
  if (src.close === 'Z') { delete src.close; copy.close = 'Z' }
  c.bars.splice(bar + 1, 0, copy)
  return c
}

export function deleteBar(chart: Chart, bar: number): Chart {
  if (chart.bars.length <= 1) return chart
  const c = clone(chart)
  const [gone] = c.bars.splice(bar, 1)
  if (gone?.close === 'Z' && c.bars.length) c.bars[c.bars.length - 1].close = 'Z'
  return c
}
