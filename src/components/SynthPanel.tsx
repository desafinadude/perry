import type { CSSProperties } from 'react'
import type { SynthSettings, SynthOsc, SynthWave } from '../types'
import { Slider, fmtPct, fmtHz, fmtMs, fmtCents } from './Slider'

interface Props {
  synth: SynthSettings
  onChange: (s: SynthSettings) => void
}

/**
 * Built-in subtractive synth editor: OSC 1 · OSC 2 · NOISE · FILTER · AMP · LFO.
 * Same horizontal-band layout as the FX panel so the two stack coherently.
 */
export function SynthPanel({ synth, onChange }: Props) {
  const set = <K extends keyof SynthSettings>(key: K, value: SynthSettings[K]) =>
    onChange({ ...synth, [key]: value })

  const setOsc = (which: 'osc1' | 'osc2', patch: Partial<SynthOsc>) =>
    onChange({ ...synth, [which]: { ...synth[which], ...patch } })

  return (
    <div style={panel}>
      <OscSection label="OSC 1" osc={synth.osc1} onChange={(p) => setOsc('osc1', p)} />
      <OscSection label="OSC 2" osc={synth.osc2} onChange={(p) => setOsc('osc2', p)} />

      <Section title="NOISE">
        <Slider
          label="LEVEL" value={synth.noise} min={0} max={1}
          onChange={(v) => set('noise', v)} display={fmtPct}
        />
      </Section>

      <Section title="FILTER">
        <select
          value={synth.filterType}
          onChange={(e) => set('filterType', e.target.value as SynthSettings['filterType'])}
          style={select}
        >
          <option value="lowpass">LOWPASS</option>
          <option value="highpass">HIGHPASS</option>
          <option value="bandpass">BANDPASS</option>
        </select>
        <Slider
          label="CUTOFF" value={synth.cutoff} min={20} max={18000} curve="log"
          onChange={(v) => set('cutoff', v)} display={(v) => `${fmtHz(v)}Hz`}
        />
        <Slider
          label="RES" value={synth.resonance} min={0.5} max={18} step={0.1}
          onChange={(v) => set('resonance', v)} display={(v) => v.toFixed(1)}
        />
        <Slider
          label="ENV AMT" value={synth.filterEnv} min={0} max={4} step={0.05}
          onChange={(v) => set('filterEnv', v)} display={(v) => `${v.toFixed(1)}oct`}
        />
        <Slider
          label="ENV DEC" value={synth.filterDecay} min={0.01} max={2} curve="log"
          onChange={(v) => set('filterDecay', v)} display={fmtMs}
        />
      </Section>

      <Section title="AMP ENV">
        <Slider
          label="A" value={synth.ampAttack} min={0.001} max={3} curve="log"
          onChange={(v) => set('ampAttack', v)} display={fmtMs}
        />
        <Slider
          label="D" value={synth.ampDecay} min={0.001} max={3} curve="log"
          onChange={(v) => set('ampDecay', v)} display={fmtMs}
        />
        <Slider
          label="S" value={synth.ampSustain} min={0} max={1}
          onChange={(v) => set('ampSustain', v)} display={fmtPct}
        />
        <Slider
          label="R" value={synth.ampRelease} min={0.01} max={5} curve="log"
          onChange={(v) => set('ampRelease', v)} display={fmtMs}
        />
      </Section>

      <Section title="LFO">
        <Slider
          label="RATE" value={synth.lfoRate} min={0.05} max={12} step={0.05}
          onChange={(v) => set('lfoRate', v)} display={(v) => `${v.toFixed(1)}Hz`}
        />
        <Slider
          label="DEPTH" value={synth.lfoDepth} min={0} max={100} step={1}
          onChange={(v) => set('lfoDepth', v)} display={fmtCents}
        />
      </Section>
    </div>
  )
}

function OscSection({
  label, osc, onChange,
}: {
  label: string
  osc: SynthOsc
  onChange: (p: Partial<SynthOsc>) => void
}) {
  return (
    <Section title={label}>
      <select
        value={osc.wave}
        onChange={(e) => onChange({ wave: e.target.value as SynthWave })}
        style={select}
      >
        <option value="sawtooth">SAW</option>
        <option value="square">SQUARE</option>
        <option value="triangle">TRIANGLE</option>
        <option value="sine">SINE</option>
      </select>
      <select
        value={osc.octave}
        onChange={(e) => onChange({ octave: Number(e.target.value) })}
        style={select}
      >
        {[-2, -1, 0, 1, 2].map((o) => (
          <option key={o} value={o}>{o >= 0 ? `+${o}` : o} OCT</option>
        ))}
      </select>
      <Slider
        label="DETUNE" value={osc.detune} min={-100} max={100} step={1}
        onChange={(v) => onChange({ detune: v })} display={fmtCents}
      />
      <Slider
        label="LEVEL" value={osc.level} min={0} max={1}
        onChange={(v) => onChange({ level: v })} display={fmtPct}
      />
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={section}>
      <div style={sectionTitle}>{title}</div>
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
const sectionTitle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.18em',
  color: 'var(--ink)', fontWeight: 600,
}
const sectionBody: CSSProperties = {
  display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-end',
}
const select: CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 0,
  color: 'var(--ink)', fontSize: 10, padding: '2px 4px', width: 104,
}
