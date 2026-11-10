import type { CSSProperties, ReactNode } from 'react'
import type { SynthWave } from '../types'

/* Shared faceplate parts for the synth / sampler / FX panels. */

/*
 * Type scale (Bebas Neue display + IBM Plex Mono labels), shared by every tab:
 *   h1   40px — section titles: ZONES, LIBRARY, BAND, MIXER, AUDIO, RECORDER, dialogs
 *   hero 56px — the selected thing's name: zone name, song title
 *   h2   26px — card / track / strip names
 *   h3   20px — list rows
 *   lbl  10px mono caps — subtitles and labels
 */
const display = (size: number, lineHeight: number): CSSProperties => ({
  fontFamily: 'var(--font-display)', fontSize: size, lineHeight, letterSpacing: '0.02em', fontWeight: 400,
})
export const h1 = display(40, 0.85)
export const hero = display(56, 0.88)
export const h2 = display(26, 0.95)
export const h3 = display(20, 1)

export const lbl: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
  color: 'var(--label)', textTransform: 'uppercase', whiteSpace: 'nowrap', userSelect: 'none',
}

export const headText: CSSProperties = {
  fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15,
  letterSpacing: '0.16em', color: 'var(--ink)', textTransform: 'uppercase',
}

export const outlineBtn: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em',
  textTransform: 'uppercase', background: 'transparent', color: 'var(--ink)',
  border: '1.5px solid var(--ink)', borderRadius: 0, padding: '0 14px',
  height: 36, cursor: 'pointer',
}

/** One faceplate section: fixed-height title row over a 2px ink rule. */
export function Module({
  title, aside, children, style,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={{ ...moduleStyle, ...style }}>
      <div style={moduleHead}>
        <span style={headText}>{title}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

const moduleStyle: CSSProperties = {
  padding: '14px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
}
const moduleHead: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
  height: 28, borderBottom: '2px solid var(--ink)', paddingBottom: 6,
}

/** Row of knobs / controls sharing a bottom baseline, left-aligned. */
export function KnobRow({ children, gap = 6 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', alignItems: 'flex-end', gap, flexWrap: 'wrap' }}>{children}</div>
}

/**
 * Segmented selector. `tone`: 'blue' for modes/engines, 'ink' for sub-options.
 */
export function Segmented<T extends string | number>({
  options, value, onChange, tone = 'ink', height = 30, label, minWidth = 36,
}: {
  options: readonly (readonly [T, string])[] | readonly { value: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  tone?: 'blue' | 'ink'
  height?: number
  label: string
  minWidth?: number
}) {
  const items = (options as readonly unknown[]).map((o) =>
    Array.isArray(o) ? { value: o[0] as T, label: o[1] as string, title: undefined } : (o as { value: T; label: string; title?: string }),
  )
  const onBg = tone === 'blue' ? 'var(--accent-1)' : 'var(--ink)'
  const onFg = tone === 'blue' ? '#fff' : 'var(--bg)'
  return (
    <div role="group" aria-label={label} style={{ display: 'flex' }}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={String(it.value)}
            aria-pressed={active}
            title={it.title}
            onClick={() => onChange(it.value)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
              height, minWidth, padding: '0 10px', marginRight: -1.5, borderRadius: 0,
              cursor: 'pointer', position: 'relative', zIndex: active ? 1 : 0,
              background: active ? onBg : 'transparent',
              color: active ? onFg : 'var(--ink)',
              border: `1.5px solid ${active ? onBg : 'var(--ink)'}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

const WAVES: { value: SynthWave; label: string; path: string }[] = [
  { value: 'sine', label: 'Sine', path: 'M1 7 C4 -1 9 -1 13 7 C17 15 22 15 25 7' },
  { value: 'square', label: 'Square', path: 'M1 12 V2 H13 V12 H25 V2' },
  { value: 'sawtooth', label: 'Saw', path: 'M1 12 L13 2 V12 L25 2 V12' },
  { value: 'triangle', label: 'Triangle', path: 'M1 12 L7 2 L13 12 L19 2 L25 12' },
]

export const waveName = (w: SynthWave) => WAVES.find((x) => x.value === w)?.label.toUpperCase() ?? w

export function WaveSelector({ value, onChange }: { value: SynthWave; onChange: (w: SynthWave) => void }) {
  return (
    <div role="group" aria-label="Waveform" style={{ display: 'flex' }}>
      {WAVES.map((w) => {
        const active = w.value === value
        return (
          <button
            key={w.value}
            aria-label={w.label}
            aria-pressed={active}
            title={w.label}
            onClick={() => onChange(w.value)}
            style={{
              width: 44, height: 36, marginRight: -1.5, borderRadius: 0, cursor: 'pointer',
              border: '1.5px solid var(--ink)', position: 'relative', zIndex: active ? 1 : 0,
              background: active ? 'var(--accent-1)' : 'transparent',
              borderColor: active ? 'var(--accent-1)' : 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            <svg width={26} height={14} viewBox="0 0 26 14" aria-hidden="true">
              <path d={w.path} stroke={active ? '#fff' : 'var(--ink)'} strokeWidth={1.8} fill="none" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

/** FX unit power switch with LED dot. */
export function PowerButton({ on, onChange, name }: { on: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <button
      aria-pressed={on}
      aria-label={`${name} ${on ? 'on' : 'off'}`}
      onClick={() => onChange(!on)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px',
        border: `1.5px solid ${on ? 'var(--accent-1)' : '#8E8B82'}`,
        background: on ? 'var(--accent-1)' : 'transparent',
        color: on ? '#fff' : 'var(--label)', borderRadius: 0, cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#fff' : '#A9A69C' }} />
      {on ? 'ON' : 'OFF'}
    </button>
  )
}

/** Small ADSR curve. Times in seconds, sustain 0..1. */
export function EnvelopeGraph({
  attack, decay, sustain, release, width = 150, height = 76,
}: {
  attack: number; decay: number; sustain: number; release: number
  width?: number; height?: number
}) {
  // log-ish time scaling so 5 ms and 3 s both stay readable
  const tx = (t: number) => 6 + (34 * Math.log10(1 + t * 20)) / Math.log10(61)
  const ax = 2 + tx(attack)
  const dx = ax + tx(decay)
  const rx = 150 - tx(release) - 2
  const sy = 70 - 62 * sustain
  const d = `M2 70 L${ax.toFixed(1)} 8 L${dx.toFixed(1)} ${sy.toFixed(1)} L${Math.max(dx, rx).toFixed(1)} ${sy.toFixed(1)} L148 70`
  return (
    <svg
      width={width} height={height} viewBox="0 0 150 76" role="img"
      aria-label={`Envelope: attack ${attack}s, decay ${decay}s, sustain ${Math.round(sustain * 100)}%, release ${release}s`}
      style={{ flexShrink: 0, background: '#fff', border: '1.5px solid var(--ink)' }}
    >
      <path d="M0 19 H150 M0 38 H150 M0 57 H150 M37 0 V76 M75 0 V76 M112 0 V76" stroke="#E5E2D9" strokeWidth={1} />
      <path d={`${d} Z`} fill="var(--accent-1)" fillOpacity={0.12} />
      <path d={d} stroke="var(--ink)" strokeWidth={2} fill="none" />
    </svg>
  )
}
