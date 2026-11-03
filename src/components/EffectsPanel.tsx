import type { CSSProperties, ReactNode } from 'react'
import type { EffectSettings } from '../types'
import { Knob } from './Knob'
import { KnobRow, PowerButton, Segmented, headText, lbl } from './controls'
import { fmtPct, fmtHz, fmtMs, fmtPan } from './format'

interface Props {
  effects: EffectSettings
  onChange: (fx: EffectSettings) => void
}

const FILTER_TYPES = [['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP']] as const

/**
 * Per-zone insert effects rack: FILTER → CHORUS → DELAY → REVERB → PAN.
 * A switched-off unit drops to the bypass tone and greys its knobs but stays
 * editable, so it can be dialled in before switching on.
 */
export function EffectsPanel({ effects, onChange }: Props) {
  const set = <K extends keyof EffectSettings>(key: K, value: EffectSettings[K]) =>
    onChange({ ...effects, [key]: value })

  const onCount = [effects.filterOn, effects.chorusOn, effects.delayOn, effects.reverbOn].filter(Boolean).length

  return (
    <section aria-label="Effects" style={rack}>
      <div style={rackHead}>
        <span style={headText}>EFFECTS</span>
        <span style={lbl}>IN → FILTER → CHORUS → DELAY → REVERB → PAN → OUT</span>
        <span style={{ flex: 1 }} />
        <span style={lbl}>{onCount} OF 4 ON</span>
      </div>
      <div style={units}>
        <Unit name="FILTER" on={effects.filterOn} onToggle={(v) => set('filterOn', v)} grow={1.2}>
          <Segmented label="Filter type" options={FILTER_TYPES} value={effects.filterType}
            onChange={(v) => set('filterType', v)} height={24} minWidth={32} />
          <KnobRow gap={4}>
            <Knob size={50} dimmed={!effects.filterOn} label="CUTOFF" value={effects.cutoff} min={20} max={18000} curve="log"
              defaultValue={18000} onChange={(v) => set('cutoff', v)} display={fmtHz} />
            <Knob size={50} dimmed={!effects.filterOn} label="RES" value={effects.resonance} min={0.5} max={18} step={0.1}
              defaultValue={0.7} onChange={(v) => set('resonance', v)} display={(v) => v.toFixed(1)} />
          </KnobRow>
        </Unit>

        <Unit name="CHORUS" on={effects.chorusOn} onToggle={(v) => set('chorusOn', v)} grow={1.4}>
          <KnobRow gap={4}>
            <Knob size={50} dimmed={!effects.chorusOn} label="RATE" value={effects.chorusRate} min={0.05} max={6} step={0.01}
              defaultValue={0.8} onChange={(v) => set('chorusRate', v)} display={(v) => `${v.toFixed(2)}Hz`} />
            <Knob size={50} dimmed={!effects.chorusOn} label="DEPTH" value={effects.chorusDepth} min={0} max={1}
              defaultValue={0.4} onChange={(v) => set('chorusDepth', v)} display={fmtPct} />
            <Knob size={50} dimmed={!effects.chorusOn} label="MIX" value={effects.chorusMix} min={0} max={1}
              defaultValue={0.3} onChange={(v) => set('chorusMix', v)} display={fmtPct} />
          </KnobRow>
        </Unit>

        <Unit name="DELAY" on={effects.delayOn} onToggle={(v) => set('delayOn', v)} grow={1.4}>
          <KnobRow gap={4}>
            <Knob size={50} dimmed={!effects.delayOn} label="TIME" value={effects.delayTime} min={0.02} max={1.5} step={0.01}
              defaultValue={0.28} onChange={(v) => set('delayTime', v)} display={fmtMs} />
            <Knob size={50} dimmed={!effects.delayOn} label="FDBK" value={effects.delayFeedback} min={0} max={0.9}
              defaultValue={0.35} onChange={(v) => set('delayFeedback', v)} display={fmtPct} />
            <Knob size={50} dimmed={!effects.delayOn} label="MIX" value={effects.delayMix} min={0} max={1}
              defaultValue={0.25} onChange={(v) => set('delayMix', v)} display={fmtPct} />
          </KnobRow>
        </Unit>

        <Unit name="REVERB" on={effects.reverbOn} onToggle={(v) => set('reverbOn', v)} grow={1}>
          <KnobRow gap={4}>
            <Knob size={50} dimmed={!effects.reverbOn} label="SIZE" value={effects.reverbSize} min={0} max={1}
              defaultValue={0.5} onChange={(v) => set('reverbSize', v)} display={fmtPct} />
            <Knob size={50} dimmed={!effects.reverbOn} label="MIX" value={effects.reverbMix} min={0} max={1}
              defaultValue={0.25} onChange={(v) => set('reverbMix', v)} display={fmtPct} />
          </KnobRow>
        </Unit>

        <Unit name="PAN" grow={0.6}>
          <KnobRow>
            <Knob size={50} bipolar label="POS" value={effects.pan} min={-1} max={1} step={0.01}
              defaultValue={0} onChange={(v) => set('pan', v)} display={fmtPan} />
          </KnobRow>
        </Unit>
      </div>
    </section>
  )
}

function Unit({
  name, on = true, onToggle, grow, children,
}: {
  name: string
  on?: boolean
  onToggle?: (v: boolean) => void
  grow: number
  children: ReactNode
}) {
  return (
    <div style={{
      flex: `${grow} 1 150px`, display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 14px', background: on ? 'var(--bg)' : 'var(--bypass)',
      border: '1.5px solid var(--ink)', marginRight: -1.5, marginBottom: -1.5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, height: 28 }}>
        <span style={{ ...headText, color: on ? 'var(--ink)' : 'var(--label)' }}>{name}</span>
        {onToggle && <PowerButton name={name} on={on} onChange={onToggle} />}
      </div>
      {children}
    </div>
  )
}

const rack: CSSProperties = {
  display: 'flex', flexDirection: 'column', background: 'var(--surface)',
}
const rackHead: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 18, padding: '12px 20px 8px', flexWrap: 'wrap',
}
const units: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', padding: '0 20px 18px', alignItems: 'stretch',
}
