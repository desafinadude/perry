import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { dbToPos, fmtDb, posToDb } from '../../mixer/model'

const SEGMENTS = 28
const TICKS_DB = [6, 0, -6, -12, -24, -40]

/** dBFS → meter fill 0 … 1 (−60 dB = empty, +3 dB = full). */
export const meterFill = (db: number) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 63)) : 0)

function Segments({ fill, dark, width = 8 }: { fill: number; dark: boolean; width?: number }) {
  return (
    <div aria-hidden="true" style={{ width, display: 'flex', flexDirection: 'column-reverse', gap: 1, height: '100%', background: dark ? '#2C2B28' : '#E2DFD6' }}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const pos = (i + 0.5) / SEGMENTS
        const zone = pos > 0.88 ? 'r' : pos > 0.7 ? 'y' : 'g'
        const lit = pos <= fill
        const on = { g: '#2E9E4F', y: '#E0A526', r: '#D93B2B' }[zone]
        const off = dark ? { g: '#2F4635', y: '#4D432C', r: '#52302C' }[zone] : { g: '#CFE3D3', y: '#EFE2C3', r: '#F0CFCA' }[zone]
        return <div key={i} style={{ flex: '1 1 0', background: lit ? on : off }} />
      })}
    </div>
  )
}

/**
 * Vertical fader with the level meter running down the middle of its track;
 * the cap slides over the meter. Drag, arrow keys (Shift = fine), double-click
 * for 0 dB.
 */
export function Fader({
  label, db, onChange, meters, height = 230, width = 34, cap = 'var(--ink)', capLine = 'var(--bg)', dark = false,
}: {
  label: string
  db: number
  onChange: (db: number) => void
  /** One (mono) or two (L/R) meter readings in dBFS. */
  meters: number[]
  height?: number
  width?: number
  cap?: string
  capLine?: string
  dark?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; pos: number } | null>(null)
  const pos = dbToPos(db)

  const setPos = (p: number) => {
    const clamped = Math.max(0, Math.min(1, p))
    // snap to unity when close
    const d = posToDb(clamped)
    onChange(Math.abs(d) < 0.25 ? 0 : Math.round(d * 10) / 10)
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const r = ref.current!.getBoundingClientRect()
    const clickedPos = 1 - (e.clientY - r.top) / r.height
    // grabbing the cap keeps its offset; clicking the track jumps there
    const onCap = Math.abs(clickedPos - pos) * r.height < 10
    drag.current = { y: e.clientY, pos: onCap ? pos : clickedPos }
    if (!onCap) setPos(clickedPos)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return
    const h = ref.current.getBoundingClientRect().height
    const scale = e.shiftKey ? 0.15 : 1
    const next = drag.current.pos + ((drag.current.y - e.clientY) / h) * scale
    drag.current = { y: e.clientY, pos: next }
    setPos(next)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 1
    const finite = Number.isFinite(db) ? db : -60
    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(6, Math.round((finite + step) * 10) / 10)) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(finite - step < -60 ? -Infinity : Math.round((finite - step) * 10) / 10) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(0) }
    else if (e.key === 'End') { e.preventDefault(); onChange(-Infinity) }
  }

  const tickColor = dark ? '#8E8B82' : '#8E8B82'
  const meterW = meters.length > 1 ? 7 : 8
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`${label} fader`}
        aria-orientation="vertical"
        aria-valuemin={-60}
        aria-valuemax={6}
        aria-valuenow={Number.isFinite(db) ? db : -60}
        aria-valuetext={`${fmtDb(db)} dB`}
        className="perry-knob"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={onKey}
        onDoubleClick={() => onChange(0)}
        style={{ position: 'relative', width, height, cursor: 'ns-resize', touchAction: 'none' }}
      >
        {TICKS_DB.map((t) => {
          const top = `${(1 - dbToPos(t)) * 100}%`
          return (
            <span key={t} aria-hidden="true">
              <span style={{ position: 'absolute', left: 0, width: 6, top, height: 1, background: tickColor }} />
              <span style={{ position: 'absolute', right: 0, width: 6, top, height: 1, background: tickColor }} />
            </span>
          )
        })}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2 }}>
          {meters.map((m, i) => <Segments key={i} fill={meterFill(m)} dark={dark} width={meterW} />)}
        </div>
        <div aria-hidden="true" style={{
          position: 'absolute', left: 0, width, height: 14, top: `calc(${(1 - pos) * 100}% - 7px)`,
          background: cap, boxShadow: '0 2px 0 rgba(0,0,0,.25)', display: 'flex', alignItems: 'center',
        }}>
          <div style={{ width: '100%', height: 2, background: capLine }} />
        </div>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, color: dark ? 'var(--bg)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDb(db)} dB</span>
    </div>
  )
}
