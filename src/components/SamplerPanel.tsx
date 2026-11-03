import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { SamplerSettings } from '../types'
import { noteName } from '../types'
import { Slider, fmtMs } from './Slider'

interface Props {
  settings: SamplerSettings
  onChange: (s: SamplerSettings) => void
  /** True when a decoded buffer is available for this zone's file name. */
  loaded: boolean
  /** Duration of the loaded buffer in seconds, if any. */
  duration: number | null
  onLoad: (file: File) => Promise<void>
}

/**
 * Sampler editor: load a WAV/MP3/OGG, map it around a root note,
 * loop it (with trim points) or run one-shot for drums, shape with ADSR.
 */
export function SamplerPanel({ settings, onChange, loaded, duration, onLoad }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  // After a load, default the loop end to the full buffer once.
  useEffect(() => {
    if (duration && settings.loop && settings.loopEnd === 0) {
      onChange({ ...settings, loopEnd: Math.round(duration * 1000) / 1000 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, settings.loop])

  const set = <K extends keyof SamplerSettings>(key: K, value: SamplerSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await onLoad(file)
  }

  const loopMax = Math.max(duration ?? 0, 1)

  return (
    <div style={panel}>
      <Section title="SAMPLE">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button onClick={() => fileRef.current?.click()} style={loadBtn}>
          {settings.fileName ? 'REPLACE…' : 'LOAD FILE…'}
        </button>
        <div style={fileNameRow}>
          <span style={{
            ...fileName,
            color: loaded ? 'var(--ink)' : 'var(--accent-2)',
          }}>
            {settings.fileName
              ? loaded
                ? settings.fileName
                : `${settings.fileName} — NOT LOADED`
              : 'NO SAMPLE'}
          </span>
          {loaded && duration != null && (
            <span style={fileMeta}>{duration.toFixed(2)}s</span>
          )}
        </div>
      </Section>

      <Section title="PITCH">
        <label style={rowLabel}>ROOT NOTE</label>
        <select
          value={settings.rootNote}
          onChange={(e) => set('rootNote', Number(e.target.value))}
          style={select}
        >
          {Array.from({ length: 128 }, (_, n) => (
            <option key={n} value={n}>{n} · {noteName(n)}</option>
          ))}
        </select>
        <div style={hint}>Keys pitch around the root</div>
      </Section>

      <Section title="PLAYBACK">
        <div style={toggleRow}>
          <button
            onClick={() => set('loop', !settings.loop)}
            style={toggleStyle(settings.loop)}
            title="Loop the sample while a key is held"
          >LOOP</button>
          <button
            onClick={() => set('oneShot', !settings.oneShot)}
            style={toggleStyle(settings.oneShot)}
            title="Drum mode: noteOff is ignored, sample plays to the end"
          >ONE-SHOT</button>
        </div>
        <Slider
          label="LOOP START" value={settings.loopStart} min={0} max={loopMax} step={0.01}
          onChange={(v) => set('loopStart', v)} display={fmtMs}
          disabled={!settings.loop || !loaded}
        />
        <Slider
          label="LOOP END" value={settings.loopEnd} min={0} max={loopMax} step={0.01}
          onChange={(v) => set('loopEnd', v)} display={fmtMs}
          disabled={!settings.loop || !loaded}
        />
      </Section>

      <Section title="AMP ENV">
        <Slider
          label="A" value={settings.ampAttack} min={0.001} max={3} curve="log"
          onChange={(v) => set('ampAttack', v)} display={fmtMs}
        />
        <Slider
          label="D" value={settings.ampDecay} min={0.001} max={3} curve="log"
          onChange={(v) => set('ampDecay', v)} display={fmtMs}
        />
        <Slider
          label="S" value={settings.ampSustain} min={0} max={1}
          onChange={(v) => set('ampSustain', v)} display={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="R" value={settings.ampRelease} min={0.01} max={5} curve="log"
          onChange={(v) => set('ampRelease', v)} display={fmtMs}
        />
      </Section>
    </div>
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
  minWidth: 0,
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
  color: 'var(--ink)', fontSize: 10, padding: '2px 4px', width: 140,
}
const loadBtn: CSSProperties = {
  background: 'transparent', border: '1.5px solid var(--ink)', borderRadius: 0,
  color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 10,
  letterSpacing: '0.12em', padding: '5px 12px', cursor: 'pointer', textAlign: 'left',
}
const fileNameRow: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8, maxWidth: 220,
}
const fileName: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.05em',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const fileMeta: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)',
  fontVariantNumeric: 'tabular-nums', flexShrink: 0,
}
const rowLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
  color: 'var(--muted)',
}
const hint: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--muted)',
  letterSpacing: '0.05em',
}
const toggleRow: CSSProperties = {
  display: 'flex', alignItems: 'center',
}
function toggleStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--accent-1)' : 'transparent',
    color: active ? '#fff' : 'var(--muted)',
    border: '1px solid ' + (active ? 'var(--accent-1)' : 'var(--border)'),
    marginRight: -1, borderRadius: 0, cursor: 'pointer',
    fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
    padding: '4px 8px', fontWeight: active ? 700 : 400,
  }
}
