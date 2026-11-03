import type { CSSProperties } from 'react'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** 'log' maps the 0..1 track exponentially onto [min, max] — for Hz / attack times. */
  curve?: 'lin' | 'log'
  onChange: (v: number) => void
  /** Formats the value for the readout. */
  display?: (v: number) => string
  width?: number
  disabled?: boolean
}

/**
 * Compact labelled slider used by the FX / synth / sampler panels.
 * Label + readout on top, thin track below — Swiss label discipline,
 * square thumb, no decoration (per design brief).
 */
export function Slider({
  label, value, min, max, step = 0.01, curve = 'lin',
  onChange, display, width = 104, disabled = false,
}: SliderProps) {
  const isLog = curve === 'log'
  const safeMin = Math.max(min, 1e-6)
  // Log curves use a 0..1 track mapped exponentially; linear passes through.
  const trackValue = isLog
    ? Math.log(Math.max(value, safeMin) / safeMin) / Math.log(max / safeMin)
    : value

  const handle = (raw: number) => {
    if (isLog) {
      const v = safeMin * Math.pow(max / safeMin, raw)
      onChange(Math.round(v * 1000) / 1000)
    } else {
      onChange(raw)
    }
  }

  const readout = display
    ? display(value)
    : String(Math.round(value * 100) / 100)

  return (
    <div style={{ width, opacity: disabled ? 0.4 : 1 }}>
      <div style={headRow}>
        <span style={labelStyle}>{label}</span>
        <span style={valueStyle}>{readout}</span>
      </div>
      <input
        type="range"
        min={isLog ? 0 : min}
        max={isLog ? 1 : max}
        step={isLog ? 0.002 : step}
        value={isLog ? (Number.isFinite(trackValue) ? Math.max(0, Math.min(1, trackValue)) : 0) : value}
        onChange={(e) => handle(Number(e.target.value))}
        disabled={disabled}
        style={{ width: '100%', display: 'block' }}
      />
    </div>
  )
}

const headRow: CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
  gap: 6, marginBottom: 3,
}
const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
  color: 'var(--muted)', whiteSpace: 'nowrap', userSelect: 'none',
}
const valueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}

// ── shared formatters ────────────────────────────────────────────────────────
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`
export const fmtHz = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`
export const fmtMs = (v: number) =>
  v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`
export const fmtCents = (v: number) => `${Math.round(v)}¢`
export const fmtDb = (v: number) => (v <= 0 ? '-∞' : v.toFixed(1))
