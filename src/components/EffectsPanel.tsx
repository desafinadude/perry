import type { CSSProperties, ReactNode } from 'react'
import type { EffectSettings } from '../types'
import { Slider, fmtPct, fmtHz, fmtMs } from './Slider'

interface Props {
  effects: EffectSettings
  onChange: (fx: EffectSettings) => void
}

/**
 * Per-zone insert effects strip: FILTER · CHORUS · DELAY · REVERB · PAN.
 * Horizontal bands of controls separated by hairline rules — each effect
 * section arms with an ON toggle (accent blue when active).
 */
export function EffectsPanel({ effects, onChange }: Props) {
  const set = <K extends keyof EffectSettings>(key: K, value: EffectSettings[K]) =>
    onChange({ ...effects, [key]: value })

  return (
    <div style={panel}>
      <Section
        title="FILTER"
        on={effects.filterOn}
        onToggle={(v) => set('filterOn', v)}
      >
        <select
          value={effects.filterType}
          onChange={(e) => set('filterType', e.target.value as EffectSettings['filterType'])}
          style={select}
        >
          <option value="lowpass">LOWPASS</option>
          <option value="highpass">HIGHPASS</option>
          <option value="bandpass">BANDPASS</option>
        </select>
        <Slider
          label="CUTOFF" value={effects.cutoff} min={20} max={18000} curve="log"
          onChange={(v) => set('cutoff', v)} display={(v) => `${fmtHz(v)}Hz`}
          disabled={!effects.filterOn}
        />
        <Slider
          label="RES" value={effects.resonance} min={0.5} max={18} step={0.1}
          onChange={(v) => set('resonance', v)} display={(v) => v.toFixed(1)}
          disabled={!effects.filterOn}
        />
      </Section>

      <Section
        title="CHORUS"
        on={effects.chorusOn}
        onToggle={(v) => set('chorusOn', v)}
      >
        <Slider
          label="RATE" value={effects.chorusRate} min={0.05} max={6} step={0.01}
          onChange={(v) => set('chorusRate', v)} display={(v) => `${v.toFixed(2)}Hz`}
          disabled={!effects.chorusOn}
        />
        <Slider
          label="DEPTH" value={effects.chorusDepth} min={0} max={1}
          onChange={(v) => set('chorusDepth', v)} display={fmtPct}
          disabled={!effects.chorusOn}
        />
        <Slider
          label="MIX" value={effects.chorusMix} min={0} max={1}
          onChange={(v) => set('chorusMix', v)} display={fmtPct}
          disabled={!effects.chorusOn}
        />
      </Section>

      <Section
        title="DELAY"
        on={effects.delayOn}
        onToggle={(v) => set('delayOn', v)}
      >
        <Slider
          label="TIME" value={effects.delayTime} min={0.02} max={1.5} step={0.01}
          onChange={(v) => set('delayTime', v)} display={fmtMs}
          disabled={!effects.delayOn}
        />
        <Slider
          label="FDBK" value={effects.delayFeedback} min={0} max={0.9}
          onChange={(v) => set('delayFeedback', v)} display={fmtPct}
          disabled={!effects.delayOn}
        />
        <Slider
          label="MIX" value={effects.delayMix} min={0} max={1}
          onChange={(v) => set('delayMix', v)} display={fmtPct}
          disabled={!effects.delayOn}
        />
      </Section>

      <Section
        title="REVERB"
        on={effects.reverbOn}
        onToggle={(v) => set('reverbOn', v)}
      >
        <Slider
          label="SIZE" value={effects.reverbSize} min={0} max={1}
          onChange={(v) => set('reverbSize', v)} display={fmtPct}
          disabled={!effects.reverbOn}
        />
        <Slider
          label="MIX" value={effects.reverbMix} min={0} max={1}
          onChange={(v) => set('reverbMix', v)} display={fmtPct}
          disabled={!effects.reverbOn}
        />
      </Section>

      <Section title="PAN" on onToggle={() => { /* always on */ }} hideToggle>
        <Slider
          label="POSITION" value={effects.pan} min={-1} max={1} step={0.01}
          onChange={(v) => set('pan', v)}
          display={(v) =>
            Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`
          }
          width={140}
        />
      </Section>
    </div>
  )
}

function Section({
  title, on, onToggle, children, hideToggle,
}: {
  title: string
  on: boolean
  onToggle: (v: boolean) => void
  children: ReactNode
  hideToggle?: boolean
}) {
  return (
    <div style={section}>
      <div style={sectionHead}>
        <span style={sectionTitle}>{title}</span>
        {!hideToggle && (
          <button
            onClick={() => onToggle(!on)}
            style={{
              ...toggleBtn,
              background: on ? 'var(--accent-1)' : 'transparent',
              color: on ? '#fff' : 'var(--muted)',
              borderColor: on ? 'var(--accent-1)' : 'var(--border)',
            }}
          >
            {on ? 'ON' : 'OFF'}
          </button>
        )}
      </div>
      <div style={sectionBody}>{children}</div>
    </div>
  )
}

const panel: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'stretch',
  background: 'var(--surface)',
  padding: '8px 4px',
}
const section: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  padding: '0 14px',
  borderRight: '1px solid var(--border)',
}
const sectionHead: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
}
const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.18em',
  color: 'var(--ink)', fontWeight: 600,
}
const sectionBody: CSSProperties = {
  display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-end',
}
const toggleBtn: CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 0,
  fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em',
  padding: '1px 5px', cursor: 'pointer', lineHeight: 1.4,
}
const select: CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 0,
  color: 'var(--ink)', fontSize: 10, padding: '2px 4px', width: 104,
}
