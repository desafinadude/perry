import type { CSSProperties } from 'react'
import type { SynthSettings, SynthOsc } from '../types'
import { Knob } from './Knob'
import { SynthScope } from './SynthScope'
import { Module, KnobRow, Segmented, WaveSelector, EnvelopeGraph, waveName, lbl } from './controls'
import { fmtPct, fmtHz, fmtMs, fmtCents } from './format'

interface Props {
  synth: SynthSettings
  onChange: (s: SynthSettings) => void
  /** Analyser on this zone's output, for the LIVE scope. */
  getAnalyser: () => AnalyserNode | null
}

const FILTER_TYPES = [['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP']] as const

/**
 * Built-in subtractive synth faceplate on a 3-column grid:
 *   SCOPE (waveform + spectrum, spans all 3)
 *   OSC 1 | OSC 2 | NOISE + LFO
 *   FILTER | AMP ENVELOPE (spans 2)
 */
export function SynthPanel({ synth, onChange, getAnalyser }: Props) {
  const set = <K extends keyof SynthSettings>(key: K, value: SynthSettings[K]) =>
    onChange({ ...synth, [key]: value })
  const setOsc = (which: 'osc1' | 'osc2', patch: Partial<SynthOsc>) =>
    onChange({ ...synth, [which]: { ...synth[which], ...patch } })

  return (
    <section aria-label="Synth" style={grid}>
      <SynthScope synth={synth} getAnalyser={getAnalyser} />
      <OscModule title="OSC 1" osc={synth.osc1} onChange={(p) => setOsc('osc1', p)} />
      <OscModule title="OSC 2" osc={synth.osc2} onChange={(p) => setOsc('osc2', p)} />

      <div style={{ ...cellTop, display: 'flex', gap: 4, borderRight: 'none' }}>
        <Module title="NOISE" style={{ paddingRight: 8 }}>
          <KnobRow>
            <Knob label="LEVEL" value={synth.noise} min={0} max={1} defaultValue={0}
              onChange={(v) => set('noise', v)} display={fmtPct} />
          </KnobRow>
        </Module>
        <Module title="LFO" aside={<span style={lbl}>→ PITCH</span>} style={{ flex: 1, paddingLeft: 8 }}>
          <KnobRow>
            <Knob label="RATE" value={synth.lfoRate} min={0.05} max={12} step={0.05} defaultValue={5.2}
              onChange={(v) => set('lfoRate', v)} display={(v) => `${v.toFixed(1)}Hz`} />
            <Knob label="DEPTH" value={synth.lfoDepth} min={0} max={100} step={1} defaultValue={0}
              onChange={(v) => set('lfoDepth', v)} display={(v) => `${Math.round(v)}¢`} />
          </KnobRow>
        </Module>
      </div>

      <Module
        title="FILTER"
        style={{ borderRight: '1px solid var(--border)' }}
        aside={
          <Segmented label="Filter type" options={FILTER_TYPES} value={synth.filterType}
            onChange={(v) => set('filterType', v)} height={24} minWidth={34} />
        }
      >
        <KnobRow>
          <Knob label="CUTOFF" size={92} value={synth.cutoff} min={20} max={18000} curve="log" defaultValue={3000}
            onChange={(v) => set('cutoff', v)} display={(v) => `${fmtHz(v)}Hz`} />
          <Knob label="RES" value={synth.resonance} min={0.5} max={18} step={0.1} defaultValue={1.2}
            onChange={(v) => set('resonance', v)} display={(v) => v.toFixed(1)} />
          <Knob label="ENV AMT" value={synth.filterEnv} min={0} max={4} step={0.05} defaultValue={2.2}
            onChange={(v) => set('filterEnv', v)} display={(v) => `${v.toFixed(1)}oct`} />
          <Knob label="DECAY" value={synth.filterDecay} min={0.01} max={2} curve="log" defaultValue={0.35}
            onChange={(v) => set('filterDecay', v)} display={fmtMs} />
        </KnobRow>
      </Module>

      <Module title="AMP ENVELOPE" aside={<span style={lbl}>ADSR</span>} style={{ gridColumn: 'span 2' }}>
        <KnobRow gap={14}>
          <EnvelopeGraph attack={synth.ampAttack} decay={synth.ampDecay} sustain={synth.ampSustain} release={synth.ampRelease} />
          <KnobRow>
            <Knob label="A" value={synth.ampAttack} min={0.001} max={3} curve="log" defaultValue={0.01}
              onChange={(v) => set('ampAttack', v)} display={fmtMs} />
            <Knob label="D" value={synth.ampDecay} min={0.001} max={3} curve="log" defaultValue={0.25}
              onChange={(v) => set('ampDecay', v)} display={fmtMs} />
            <Knob label="S" value={synth.ampSustain} min={0} max={1} defaultValue={0.7}
              onChange={(v) => set('ampSustain', v)} display={fmtPct} />
            <Knob label="R" value={synth.ampRelease} min={0.01} max={5} curve="log" defaultValue={0.35}
              onChange={(v) => set('ampRelease', v)} display={fmtMs} />
          </KnobRow>
        </KnobRow>
      </Module>
    </section>
  )
}

function OscModule({ title, osc, onChange }: { title: string; osc: SynthOsc; onChange: (p: Partial<SynthOsc>) => void }) {
  return (
    <Module title={title} aside={<span style={lbl}>{waveName(osc.wave)}</span>} style={cellTop}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <WaveSelector value={osc.wave} onChange={(wave) => onChange({ wave })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...lbl, width: 30 }}>OCT</span>
            <Segmented
              label={`${title} octave`}
              options={[-2, -1, 0, 1, 2].map((o) => [o, o > 0 ? `+${o}` : String(o)] as const)}
              value={osc.octave}
              onChange={(octave) => onChange({ octave })}
              height={26} minWidth={28}
            />
          </div>
        </div>
        <KnobRow>
          <Knob label="DETUNE" bipolar value={osc.detune} min={-100} max={100} step={1} defaultValue={0}
            onChange={(v) => onChange({ detune: v })} display={fmtCents} />
          <Knob label="LEVEL" value={osc.level} min={0} max={1} defaultValue={0.7}
            onChange={(v) => onChange({ level: v })} display={fmtPct} />
        </KnobRow>
      </div>
    </Module>
  )
}

const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  borderBottom: '2px solid var(--ink)',
}
const cellTop: CSSProperties = {
  borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
}
