import type { CSSProperties, ReactNode } from 'react'
import type { ChannelMix } from '../mixer/model'
import { Knob } from './Knob'
import { KnobRow, PowerButton, Segmented, headText, lbl } from './controls'
import { fmtHz, fmtPan } from './format'

interface Props {
  mix: ChannelMix
  onChange: (m: ChannelMix) => void
  onOpenMixer: () => void
}

const FILTER_TYPES = [['lowpass', 'LP'], ['highpass', 'HP'], ['bandpass', 'BP']] as const
const fmtGain = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
const fmtSend = (v: number) => `${Math.round(v * 100)}%`

/**
 * The zone's mixer channel, shown under its instrument panel:
 * FILTER → EQ → PAN → SENDS (post-fader to the shared REVERB / DELAY / CHORUS buses).
 */
export function ChannelPanel({ mix, onChange, onOpenMixer }: Props) {
  const set = <K extends keyof ChannelMix>(k: K, v: ChannelMix[K]) => onChange({ ...mix, [k]: v })
  return (
    <section aria-label="Channel" style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: '12px 20px 8px', flexWrap: 'wrap' }}>
        <span style={headText}>CHANNEL</span>
        <span style={lbl}>IN → FILTER → EQ → PAN → FADER → SENDS</span>
        <span style={{ flex: 1 }} />
        <button onClick={onOpenMixer} style={linkBtn}>OPEN IN MIXER →</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 20px 18px', alignItems: 'stretch' }}>
        <Unit name="FILTER" grow={1.2} dim={!mix.filterOn} aside={<PowerButton name="Filter" on={mix.filterOn} onChange={(v) => set('filterOn', v)} />}>
          <Segmented label="Filter type" options={FILTER_TYPES} value={mix.filterType} onChange={(v) => set('filterType', v)} height={24} minWidth={32} />
          <KnobRow gap={4}>
            <Knob size={50} dimmed={!mix.filterOn} label="CUTOFF" value={mix.cutoff} min={20} max={18000} curve="log" defaultValue={18000} onChange={(v) => set('cutoff', v)} display={fmtHz} />
            <Knob size={50} dimmed={!mix.filterOn} label="RES" value={mix.resonance} min={0.5} max={18} step={0.1} defaultValue={0.7} onChange={(v) => set('resonance', v)} display={(v) => v.toFixed(1)} />
          </KnobRow>
        </Unit>
        <Unit name="EQ" grow={1.4} aside={<span style={{ ...lbl, color: 'var(--accent-1)' }}>3-BAND</span>}>
          <KnobRow gap={4}>
            <Knob size={50} bipolar label="LOW" value={mix.eqLow} min={-12} max={12} step={0.5} defaultValue={0} onChange={(v) => set('eqLow', v)} display={fmtGain} />
            <Knob size={50} bipolar label="MID" value={mix.eqMid} min={-12} max={12} step={0.5} defaultValue={0} onChange={(v) => set('eqMid', v)} display={fmtGain} />
            <Knob size={50} bipolar label="HIGH" value={mix.eqHigh} min={-12} max={12} step={0.5} defaultValue={0} onChange={(v) => set('eqHigh', v)} display={fmtGain} />
          </KnobRow>
        </Unit>
        <Unit name="PAN" grow={0.6}>
          <KnobRow>
            <Knob size={50} bipolar label="POS" value={mix.pan} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => set('pan', v)} display={fmtPan} />
          </KnobRow>
        </Unit>
        <Unit name="SENDS" grow={1.4} aside={<span style={{ ...lbl, color: 'var(--accent-1)' }}>POST-FADER</span>}>
          <KnobRow gap={4}>
            {([['sendRev', 'REV', 'BUS A'], ['sendDly', 'DLY', 'BUS B'], ['sendCho', 'CHO', 'BUS C']] as const).map(([k, l, bus]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Knob size={50} label={l} value={mix[k]} min={0} max={1} defaultValue={0} onChange={(v) => set(k, v)} display={fmtSend} />
                <span style={{ ...lbl, fontSize: 8, color: 'var(--accent-1)' }}>{bus}</span>
              </div>
            ))}
          </KnobRow>
        </Unit>
      </div>
    </section>
  )
}

function Unit({ name, grow, dim = false, aside, children }: { name: string; grow: number; dim?: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <div style={{
      flex: `${grow} 1 150px`, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
      background: dim ? 'var(--bypass)' : 'var(--bg)', border: '1.5px solid var(--ink)', marginRight: -1.5, marginBottom: -1.5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, height: 28 }}>
        <span style={{ ...headText, color: dim ? 'var(--label)' : 'var(--ink)' }}>{name}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

const linkBtn: CSSProperties = {
  background: 'none', border: 'none', borderBottom: '1.5px solid var(--accent-1)', padding: 0, cursor: 'pointer',
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--accent-1)',
}
