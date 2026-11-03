// Readout formatters shared by the knob panels.
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`
export const fmtHz = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`
export const fmtMs = (v: number) =>
  v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`
export const fmtSec = (v: number) => `${v.toFixed(2)}s`
export const fmtCents = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}¢`
export const fmtPan = (v: number) =>
  Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`
