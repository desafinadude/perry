import { useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Chart, ChartBar } from '../../jam/model'
import { barBeats, barTimeSigs, timeSigLabel } from '../../jam/model'
import { transposeSymbol } from '../../jam/chords'
import { ChordSymbol } from './ChordSymbol'

interface Props {
  chart: Chart
  flats: boolean
  mode: 'play' | 'edit'
  /** Playing position. */
  current: { index: number; beat: number } | null
  loop: [number, number] | null
  onPlayFrom: (bar: number) => void
  onLoopSelect: (from: number, to: number) => void
  selected: { bar: number; beat: number } | null
  onSelectSlot: (bar: number, beat: number) => void
}

const ROW_H = 70

/** Lay bars out iReal-style: 4 per line, sections start a line, 2nd endings line up under the 1st. */
function layoutRows(bars: ChartBar[]): (number | null)[][] {
  const rows: (number | null)[][] = []
  let row: (number | null)[] = []
  const endingCol = new Map<number, number>()
  bars.forEach((b, i) => {
    const startsNew = row.length === 4 || (b.section && row.length > 0)
    if (startsNew) { rows.push(row); row = [] }
    if (b.ending !== undefined && b.ending >= 2 && endingCol.has(1) && row.length === 0) {
      const col = endingCol.get(1)!
      for (let k = 0; k < col; k++) row.push(null)
    }
    if (b.ending !== undefined) endingCol.set(b.ending, row.length)
    row.push(i)
  })
  if (row.length) rows.push(row)
  return rows
}

export function ChartGrid({ chart, flats, mode, current, loop, onPlayFrom, onLoopSelect, selected, onSelectSlot }: Props) {
  const rows = useMemo(() => layoutRows(chart.bars), [chart.bars])
  const sigs = useMemo(() => barTimeSigs(chart), [chart])
  const dragFrom = useRef<number | null>(null)
  const dragTo = useRef<number | null>(null)

  const inLoop = (i: number) => !!loop && i >= loop[0] && i <= loop[1]

  return (
    <div role="grid" aria-label={`Chord chart: ${chart.title}`} style={{ display: 'flex', flexDirection: 'column' }}
      onPointerLeave={() => { dragFrom.current = null }}>
      {rows.map((row, ri) => {
        const first = row.find((x) => x !== null)
        const section = first !== undefined && first !== null ? chart.bars[first].section : undefined
        return (
          <div key={ri} role="row" style={{ display: 'flex', alignItems: 'stretch', height: ROW_H }}>
            <div style={{ width: 44, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {section && (
                <span aria-label={`Section ${section}`} style={sectionMark}>{section === 'i' ? 'IN' : section}</span>
              )}
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
              {[0, 1, 2, 3].map((col) => {
                const idx = row[col]
                if (idx === undefined || idx === null) return <div key={col} />
                const b = chart.bars[idx]
                const isCur = mode === 'play' && current?.index === idx
                const loopOn = mode === 'play' && inLoop(idx)
                const ts = sigs[idx]
                const beats = barBeats(ts)
                const fg = isCur ? '#fff' : 'var(--ink)'
                const lastInRow = col === 3 || row[col + 1] === undefined
                return (
                  <div
                    key={col}
                    role="gridcell"
                    aria-label={`Bar ${idx + 1}`}
                    aria-current={isCur || undefined}
                    onPointerDown={(e) => {
                      if (mode !== 'play') return
                      e.preventDefault()
                      dragFrom.current = idx
                      dragTo.current = idx
                    }}
                    onPointerEnter={() => { if (dragFrom.current !== null) dragTo.current = idx }}
                    onPointerUp={() => {
                      if (mode !== 'play' || dragFrom.current === null) return
                      const a = dragFrom.current, z = dragTo.current ?? idx
                      dragFrom.current = null
                      if (a === z) onPlayFrom(idx)
                      else onLoopSelect(Math.min(a, z), Math.max(a, z))
                    }}
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0,
                      padding: '14px 10px 10px', cursor: mode === 'play' ? 'pointer' : 'default',
                      borderLeft: leftLine(b), borderRight: rightLine(b, lastInRow),
                      borderTop: b.ending !== undefined ? '1.5px solid var(--ink)' : 'none',
                      background: isCur ? 'var(--accent-1)' : loopOn ? 'rgba(26,107,181,.10)' : 'transparent',
                      color: fg,
                      boxShadow: loopOn && !isCur ? 'inset 0 -3px 0 var(--accent-1)' : 'none',
                    }}
                  >
                    {b.ending !== undefined && <span style={{ ...tiny, top: 3, left: 6, color: fg }}>{b.ending === 0 ? '' : `${b.ending}.`}</span>}
                    {b.timeSig && idx > 0 && sigs[idx - 1] !== b.timeSig && <span style={{ ...tiny, top: 3, right: 6, color: fg }}>{timeSigLabel(b.timeSig)}</span>}
                    {b.text && <span style={{ ...tiny, bottom: 2, right: 6, color: fg, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.text}</span>}
                    {(b.segno || b.coda) && <span style={{ ...tiny, top: 3, left: b.ending !== undefined ? 22 : 6, color: fg, fontSize: 12 }}>{b.segno ? '𝄋' : ''}{b.coda ? '𝄌' : ''}</span>}
                    {b.open === '{' && <Dots side="left" color={fg} />}
                    {b.close === '}' && <Dots side="right" color={fg} />}

                    {mode === 'play' ? (
                      <div style={{ display: 'flex', flex: 1, minWidth: 0, gap: 4 }}>
                        {b.repeat ? (
                          <ChordSymbol text="x" style={{ paddingLeft: 6 }} />
                        ) : b.chords.map((c, k) => (
                          <span key={k} style={{ flex: 1, minWidth: 0, paddingLeft: 6, overflow: 'hidden' }}>
                            <ChordSymbol text={c.text === 'n' ? 'n' : transposeSymbol(c.text, chart.transpose, flats)} size={b.chords.length > 2 ? 'md' : 'lg'} />
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.round(beats))}, minmax(0, 1fr))`, flex: 1, alignSelf: 'stretch', margin: '-14px -10px -10px' }}>
                        {Array.from({ length: Math.max(1, Math.round(beats)) }, (_, beat) => {
                          const ch = b.chords.find((c) => Math.floor(c.beat) === beat)
                          const sel = selected?.bar === idx && selected.beat === beat
                          const text = b.repeat && beat === 0 ? 'x' : ch ? (ch.text === 'n' ? 'n' : transposeSymbol(ch.text, chart.transpose, flats)) : ''
                          return (
                            <button
                              key={beat}
                              data-slot={`${idx}-${beat}`}
                              aria-label={`Bar ${idx + 1} beat ${beat + 1}${text ? `, ${text}` : ', empty'}`}
                              onClick={() => onSelectSlot(idx, beat)}
                              style={{
                                position: 'relative', border: 'none', borderRight: '1px dashed #D8D5CC',
                                background: sel ? '#E8F0F8' : 'transparent', outline: sel ? '2px solid var(--accent-1)' : 'none',
                                outlineOffset: -2, cursor: 'text', padding: '0 0 0 6px', display: 'flex', alignItems: 'center',
                                color: 'var(--ink)', minWidth: 0, overflow: 'hidden', borderRadius: 0,
                              }}
                            >
                              {text && <ChordSymbol text={text} size={beats > 3 ? 'md' : 'lg'} />}
                              <span style={{ position: 'absolute', bottom: 3, left: 6, fontSize: 8, color: '#8E8B82' }}>{beat + 1}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {isCur && current && (
                      <span aria-hidden="true" style={{ position: 'absolute', left: 10, right: 10, bottom: 6, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Math.round(beats))}, minmax(0, 1fr))`, gap: 4 }}>
                        {Array.from({ length: Math.max(1, Math.round(beats)) }, (_, k) => (
                          <span key={k} style={{ height: 3, background: k <= current.beat ? '#fff' : 'rgba(255,255,255,.35)' }} />
                        ))}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function leftLine(b: ChartBar): string {
  if (b.open === '{') return '5px solid var(--ink)'
  if (b.open === '[') return '4px double var(--ink)'
  return '1.5px solid var(--ink)'
}

function rightLine(b: ChartBar, lastInRow: boolean): string {
  if (b.close === 'Z') return '7px double var(--ink)'
  if (b.close === '}') return '5px solid var(--ink)'
  if (b.close === ']') return '4px double var(--ink)'
  return lastInRow ? '1.5px solid var(--ink)' : 'none'
}

function Dots({ side, color }: { side: 'left' | 'right'; color: string }) {
  return (
    <span aria-hidden="true" style={{ position: 'absolute', [side]: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ width: 4, height: 4, background: color }} />
      <span style={{ width: 4, height: 4, background: color }} />
    </span>
  )
}

const tiny: CSSProperties = {
  position: 'absolute', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
}
const sectionMark: CSSProperties = {
  minWidth: 30, height: 30, padding: '0 4px', boxSizing: 'border-box', background: 'var(--ink)', color: 'var(--bg)',
  fontFamily: 'var(--font-display)', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
