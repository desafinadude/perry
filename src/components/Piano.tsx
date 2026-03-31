import { useRef, useEffect, useState, useMemo } from 'react'
import type { Zone } from '../types'
import { isBlackKey, noteName, PIANO_MIN, PIANO_MAX } from '../types'

const NUM_WHITE = Array.from({ length: PIANO_MAX - PIANO_MIN + 1 }, (_, i) => PIANO_MIN + i)
  .filter((n) => !isBlackKey(n)).length // 52

const BLACK_W_RATIO = 0.58
const BLACK_H_RATIO = 0.62

interface KeyLayout {
  midi: number
  isBlack: boolean
  left: number   // px
  width: number  // px
}

function buildLayout(containerWidth: number): KeyLayout[] {
  const ww = containerWidth / NUM_WHITE
  const bw = ww * BLACK_W_RATIO
  const whites: KeyLayout[] = []
  const blacks: KeyLayout[] = []
  let wi = 0
  for (let midi = PIANO_MIN; midi <= PIANO_MAX; midi++) {
    if (!isBlackKey(midi)) {
      whites.push({ midi, isBlack: false, left: wi * ww, width: ww })
      wi++
    } else {
      blacks.push({ midi, isBlack: true, left: (wi - 1) * ww + ww - bw / 2, width: bw })
    }
  }
  return [...whites, ...blacks]
}

function zoneColor(midi: number, zones: Zone[]): string | null {
  for (const z of zones) if (midi >= z.minNote && midi <= z.maxNote) return z.color
  return null
}

interface Props { zones: Zone[]; activeNotes: Set<number> }

export function Piano({ zones, activeNotes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const keys = useMemo(() => (width > 0 ? buildLayout(width) : []), [width])
  const wh = Math.max(90, Math.min(130, width / 9))       // white key height, responsive
  const bh = wh * BLACK_H_RATIO

  return (
    <div style={{ background: var_surface, borderBottom: `2px solid var(--ink)` }}>
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: wh, overflow: 'hidden' }}>
        {keys.map(({ midi, isBlack, left, width: kw }) => {
          const color = zoneColor(midi, zones)
          const active = activeNotes.has(midi)
          const isC = midi % 12 === 0

          if (!isBlack) {
            return (
              <div key={midi} title={noteName(midi)} style={{
                position: 'absolute', left, top: 0,
                width: kw - 1, height: wh,
                background: active ? '#ddd' : '#fff',
                borderRight: '1px solid var(--border)',
                borderBottom: `2px solid ${color ?? 'var(--border)'}`,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'flex-end',
                paddingBottom: 6,
                zIndex: 1,
                transition: 'background 80ms ease-out',
              }}>
                {isC && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: color ?? 'var(--muted)',
                    letterSpacing: 0, userSelect: 'none',
                    fontWeight: color ? 600 : 400,
                  }}>
                    {noteName(midi)}
                  </span>
                )}
              </div>
            )
          } else {
            return (
              <div key={midi} title={noteName(midi)} style={{
                position: 'absolute', left, top: 0,
                width: kw, height: bh,
                background: active ? (color ?? '#444') : 'var(--ink)',
                borderBottom: color ? `4px solid ${color}` : undefined,
                zIndex: 2,
                transition: 'background 80ms ease-out',
              }} />
            )
          }
        })}
      </div>
    </div>
  )
}

// inline helper to avoid "var(--surface)" string repetition at build time
const var_surface = 'var(--surface)'
