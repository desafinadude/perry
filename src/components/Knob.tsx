import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'

export interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  /** Snap step in value units (linear curve only). */
  step?: number
  /** 'log' maps the knob travel exponentially onto [min, max] — for Hz / times. */
  curve?: 'lin' | 'log'
  onChange: (v: number) => void
  /** Formats the readout under the knob. */
  display?: (v: number) => string
  /** Diameter in px. 92 = hero, 56 = standard, 50 = FX. */
  size?: number
  /** Value arc grows from 12 o'clock instead of from the minimum (detune, pan). */
  bipolar?: boolean
  /** Greyed look for a bypassed FX unit. The knob stays editable. */
  dimmed?: boolean
  /** Double-click resets to this value. */
  defaultValue?: number
  /** Narrow layout for mixer strips (no minimum width, small type). */
  compact?: boolean
}

const SWEEP = 270
const START = -135
const DRAG_PX = 200 // vertical px for the full range

/**
 * Vintage rotary knob: black Bakelite skirt, cream cap, ink pointer, tick
 * scale, blue value arc. Drag up/down (hold Shift for fine), arrow keys,
 * double-click to reset.
 */
export function Knob({
  label, value, min, max, step, curve = 'lin', onChange, display,
  size = 56, bipolar = false, dimmed = false, defaultValue, compact = false,
}: KnobProps) {
  const isLog = curve === 'log'
  const safeMin = Math.max(min, 1e-6)

  const toNorm = (v: number) => {
    const n = isLog
      ? Math.log(Math.max(v, safeMin) / safeMin) / Math.log(max / safeMin)
      : (v - min) / (max - min)
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
  }
  const fromNorm = (n: number) => {
    const c = Math.max(0, Math.min(1, n))
    let v = isLog ? safeMin * Math.pow(max / safeMin, c) : min + c * (max - min)
    if (!isLog && step) v = Math.round(v / step) * step
    else v = Math.round(v * 1000) / 1000
    return Math.max(min, Math.min(max, v))
  }

  const norm = toNorm(value)
  const drag = useRef<{ y: number; n: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    drag.current = { y: e.clientY, n: norm }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const scale = e.shiftKey ? 0.1 : 1
    const dn = ((drag.current.y - e.clientY) / DRAG_PX) * scale
    // re-anchor each move so toggling Shift mid-drag doesn't jump
    drag.current = { y: e.clientY, n: Math.max(0, Math.min(1, drag.current.n + dn)) }
    const next = fromNorm(drag.current.n)
    if (next !== value) onChange(next)
  }
  const onPointerUp = () => { drag.current = null }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const fine = e.shiftKey ? 0.002 : 0.01
    let n: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n = norm + fine
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n = norm - fine
    else if (e.key === 'PageUp') n = norm + 0.1
    else if (e.key === 'PageDown') n = norm - 0.1
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = 1
    if (n === null) return
    e.preventDefault()
    // guarantee at least one step of movement for stepped params
    let next = fromNorm(n)
    if (next === value && step && !isLog) next = Math.max(min, Math.min(max, value + Math.sign(n - norm) * step))
    onChange(next)
  }

  const reset = () => { if (defaultValue !== undefined) onChange(defaultValue) }

  const ang = START + SWEEP * norm
  const zero = bipolar ? START + SWEEP * toNorm(0) : START
  const from = Math.min(zero, ang)
  const to = Math.max(zero, ang)
  const readout = display ? display(value) : String(Math.round(value * 100) / 100)

  const skirt = dimmed ? '#8E8B82' : 'var(--ink)'
  const tick = dimmed ? '#A9A69C' : 'var(--ink)'
  const arc = dimmed ? '#B9B6AC' : 'var(--accent-1)'
  const ptr = dimmed ? '#9A978E' : 'var(--ink)'

  return (
    <div style={{ ...wrap, width: compact ? size + 6 : Math.max(size + 4, 60) }} title={compact ? `${label} ${readout}` : undefined}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={readout}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={reset}
        className="perry-knob"
        style={{ width: size, height: size, cursor: 'ns-resize', touchAction: 'none' }}
      >
        <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
          <path d={TICKS} stroke={tick} strokeWidth={2} fill="none" />
          <path d={arcPath(38, START, START + SWEEP)} stroke="var(--border)" strokeWidth={6} fill="none" />
          <path d={arcPath(38, from, to)} stroke={arc} strokeWidth={6} fill="none" />
          <circle cx={50} cy={50} r={31} fill={skirt} />
          <circle cx={50} cy={50} r={24} fill="var(--bg)" />
          <line x1={50} y1={50} x2={50} y2={22} stroke={ptr} strokeWidth={5} transform={`rotate(${ang} 50 50)`} />
        </svg>
      </div>
      <span style={compact ? { ...labelStyle, fontSize: 8, letterSpacing: '0.08em' } : labelStyle}>{label}</span>
      {!compact && <span style={{ ...valueStyle, color: dimmed ? '#6E6C64' : 'var(--ink)' }}>{readout}</span>}
    </div>
  )
}

function pt(r: number, deg: number): [number, number] {
  const t = ((deg - 90) * Math.PI) / 180
  return [50 + r * Math.cos(t), 50 + r * Math.sin(t)]
}

function arcPath(r: number, a: number, b: number): string {
  if (Math.abs(b - a) < 0.5) return ''
  const [x1, y1] = pt(r, a)
  const [x2, y2] = pt(r, b)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const TICKS = Array.from({ length: 11 }, (_, i) => {
  const d = START + 27 * i
  const [ax, ay] = pt(i % 5 === 0 ? 43 : 45, d)
  const [bx, by] = pt(49, d)
  return `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`
}).join('')

const wrap: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  userSelect: 'none',
}
const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  color: 'var(--label)', whiteSpace: 'nowrap', textTransform: 'uppercase',
}
const valueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}
