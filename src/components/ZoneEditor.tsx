import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Zone, Preset, LoadedFont, ZoneEngine } from '../types'
import { noteName, presetKey, ZONE_COLORS, defaultSynth, defaultSampler } from '../types'
import { getCachedSample } from '../audio/sampler'
import { ChannelPanel } from './ChannelPanel'
import { mixOf } from '../mixer/model'
import { SynthPanel } from './SynthPanel'
import { SamplerPanel } from './SamplerPanel'
import { Knob } from './Knob'
import { Module, Segmented, h1, h2, hero, lbl, outlineBtn } from './controls'

export type LearnField = 'minNote' | 'maxNote' | 'rootNote'
export type LearningMode = { zoneId: string; field: LearnField } | null

interface Props {
  zones: Zone[]
  fonts: LoadedFont[]
  presetsByFont: Record<string, Preset[]>
  onChange: (zone: Zone) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onLoadFont: (fontId: string) => void  // triggers file picker for that font slot
  learningMode: LearningMode
  onSetLearningMode: (mode: LearningMode) => void
  /** Loads an audio file into a sampler zone. */
  onLoadSample: (zone: Zone, file: File) => Promise<void>
  /** zoneId → sample availability, derived from the session sample cache. */
  sampleInfo: Record<string, { loaded: boolean; duration: number | null }>
  /** Rendered at the bottom of the zone rail (config save / presets). */
  railFooter?: ReactNode
  /** Analyser on a zone's output (for the synth scope). */
  getZoneAnalyser: (zone: Zone) => AnalyserNode | null
  /** Switch to the MIXER tab. */
  onOpenMixer: () => void
}

const ENGINES = [
  { value: 'soundfont', label: 'SF2', title: 'SoundFont preset from the loaded .sf2' },
  { value: 'synth', label: 'SYNTH', title: 'Built-in subtractive synthesizer' },
  { value: 'sampler', label: 'SAMPLE', title: 'Play a loaded audio sample across the keys' },
] as const

const LAYERS = [
  { value: 'input', label: 'IN', title: 'Live MIDI only – silent during sheet playback' },
  { value: 'both', label: 'BOTH', title: 'Both – responds to live MIDI and sheet playback' },
  { value: 'playback', label: 'PLAY', title: 'Sheet playback only – silent for live MIDI' },
] as const

/**
 * Zones view, split vertically: a narrow rail listing the zones on the left,
 * the selected zone's full instrument faceplate (engine + FX rack) on the right.
 */
export function ZoneEditor(props: Props) {
  const { zones, onAdd, railFooter } = props
  const [selectedId, setSelectedId] = useState<string | null>(zones[0]?.id ?? null)

  // keep a valid selection as zones come and go (new zone → select it)
  const [prevCount, setPrevCount] = useState(zones.length)
  useEffect(() => {
    if (zones.length > prevCount) setSelectedId(zones[zones.length - 1].id)
    else if (!zones.some((z) => z.id === selectedId)) setSelectedId(zones[0]?.id ?? null)
    setPrevCount(zones.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones])

  const selected = zones.find((z) => z.id === selectedId) ?? zones[0]

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* ── LEFT RAIL ── */}
      <aside aria-label="Zones" style={rail}>
        <div style={railHead}>
          <span style={h1}>ZONES</span>
          <span style={lbl}>{zones.length} / 8</span>
        </div>
        <div style={{ overflowY: 'auto', flex: '0 1 auto' }}>
          {zones.map((z) => (
            <ZoneCard key={z.id} zone={z} selected={z.id === selected?.id} onSelect={() => setSelectedId(z.id)} presets={props.presetsByFont[z.fontId] ?? []} />
          ))}
          <button onClick={onAdd} disabled={zones.length >= 8} style={{
            ...addBtn,
            color: zones.length >= 8 ? 'var(--label)' : 'var(--accent-1)',
            cursor: zones.length >= 8 ? 'default' : 'pointer',
          }}>
            + ADD ZONE
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {railFooter}
      </aside>

      {/* ── RIGHT: selected zone ── */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
        {selected
          ? <ZoneDetail {...props} zone={selected} index={zones.indexOf(selected)} />
          : <div style={{ ...lbl, padding: 40 }}>NO ZONES — LOAD A SOUNDFONT OR ADD A ZONE</div>}
      </main>
    </div>
  )
}

function ZoneCard({ zone, selected, onSelect, presets }: { zone: Zone; selected: boolean; onSelect: () => void; presets: Preset[] }) {
  const engine = zone.engine ?? 'soundfont'
  const source = engine === 'synth' ? 'SYNTH PATCH'
    : engine === 'sampler' ? (zone.sampler?.fileName?.toUpperCase() || 'NO SAMPLE')
    : presets.length === 0 ? 'FONT NOT LOADED'
    : (presets.find((p) => presetKey(p) === presetKey(zone))?.name.toUpperCase() ?? `PROGRAM ${zone.program + 1}`)
  const tag = engine === 'soundfont' ? 'SF2' : engine === 'synth' ? 'SYNTH' : 'SAMPLE'
  return (
    <button onClick={onSelect} aria-current={selected} style={{ ...card, background: selected ? 'var(--bg)' : 'transparent' }}>
      <span style={{ width: 6, background: zone.color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ ...h2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {zone.name.toUpperCase()}
          </span>
          <span style={{
            fontSize: 10, letterSpacing: '0.12em', padding: '3px 6px', flexShrink: 0,
            border: `1px solid ${selected ? 'var(--accent-1)' : 'var(--ink)'}`,
            background: selected ? 'var(--accent-1)' : 'transparent',
            color: selected ? '#fff' : 'var(--ink)',
          }}>{tag}</span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--label)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source}</span>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 600, flexShrink: 0 }}>{noteName(zone.minNote)} – {noteName(zone.maxNote)}</span>
        </span>
      </span>
      <span style={{ width: 4, background: selected ? 'var(--ink)' : 'transparent', flexShrink: 0 }} />
    </button>
  )
}

function ZoneDetail({
  zone, index, zones, fonts, presetsByFont, onChange, onRemove, onLoadFont,
  learningMode, onSetLearningMode, onLoadSample, sampleInfo, getZoneAnalyser, onOpenMixer,
}: Props & { zone: Zone; index: number }) {
  // stable getter so the scope's animation loop isn't restarted on every knob turn
  const zoneRef = useRef(zone)
  zoneRef.current = zone
  const getAnalyser = useCallback(() => getZoneAnalyser(zoneRef.current), [getZoneAnalyser])
  const engine = zone.engine ?? 'soundfont'
  const presets = presetsByFont[zone.fontId] ?? []
  const learning = (f: LearnField) => learningMode?.zoneId === zone.id && learningMode.field === f
  const toggleLearn = (f: LearnField) => onSetLearningMode(learning(f) ? null : { zoneId: zone.id, field: f })

  const switchEngine = (next: ZoneEngine) => {
    const updated: Zone = { ...zone, engine: next }
    if (next === 'synth' && !zone.synth) updated.synth = defaultSynth()
    if (next === 'sampler' && !zone.sampler) updated.sampler = defaultSampler()
    onChange(updated)
  }

  const buffer = zone.sampler?.fileName ? getCachedSample(zone.sampler.fileName) : undefined

  return (
    <>
      {/* ── Zone band ── */}
      <div style={band}>
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '14px 24px 0', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <div role="group" aria-label="Zone colour" style={{ display: 'flex', gap: 4 }}>
              {ZONE_COLORS.map((c) => (
                <button key={c} aria-label={`Colour ${c}`} aria-pressed={zone.color === c} onClick={() => onChange({ ...zone, color: c })} style={{
                  width: 14, height: 14, background: c, padding: 0, border: 'none', cursor: 'pointer',
                  outline: zone.color === c ? '1.5px solid var(--ink)' : 'none', outlineOffset: 1,
                }} />
              ))}
            </div>
            <span style={lbl}>ZONE {String(index + 1).padStart(2, '0')}{engine === 'soundfont' ? ` · CH ${zone.channel + 1}` : ''}</span>
          </div>
          <input
            aria-label="Zone name"
            value={zone.name}
            onChange={(e) => onChange({ ...zone, name: e.target.value })}
            style={nameInput}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 24px', flexWrap: 'wrap' }}>
          <Field label="ENGINE">
            <Segmented label="Engine" tone="blue" options={ENGINES} value={engine} onChange={switchEngine} height={40} />
          </Field>
          <Field label="RANGE">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => toggleLearn('minNote')} title="Click, then play a key (or click one on the keyboard above)" style={learnBtn(learning('minNote'))}>
                {learning('minNote') ? 'PLAY…' : `FROM ${noteName(zone.minNote)}`}
              </button>
              <span style={{ color: 'var(--label)' }}>–</span>
              <button onClick={() => toggleLearn('maxNote')} title="Click, then play a key (or click one on the keyboard above)" style={learnBtn(learning('maxNote'))}>
                {learning('maxNote') ? 'PLAY…' : `TO ${noteName(zone.maxNote)}`}
              </button>
            </div>
          </Field>
          <Field label="LAYER">
            <Segmented label="Layer" options={LAYERS} value={zone.layer ?? 'both'} onChange={(layer) => onChange({ ...zone, layer })} height={40} />
          </Field>
          <Knob label="VOL" size={52} value={zone.volume} min={0} max={127} step={1} defaultValue={100}
            onChange={(v) => onChange({ ...zone, volume: v })} display={(v) => String(Math.round(v))} />
          {zones.length > 1 && (
            <button aria-label="Remove zone" title="Remove zone" onClick={() => onRemove(zone.id)} style={removeBtn}>
              <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1 L13 13 M13 1 L1 13" stroke="var(--ink)" strokeWidth={1.8} /></svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Engine faceplate ── */}
      {engine === 'synth' && zone.synth && (
        <SynthPanel synth={zone.synth} onChange={(s) => onChange({ ...zone, synth: s })} getAnalyser={getAnalyser} />
      )}
      {engine === 'sampler' && zone.sampler && (
        <SamplerPanel
          settings={zone.sampler}
          onChange={(s) => onChange({ ...zone, sampler: s })}
          loaded={sampleInfo[zone.id]?.loaded ?? false}
          duration={sampleInfo[zone.id]?.duration ?? null}
          buffer={buffer}
          onLoad={(file) => onLoadSample(zone, file)}
          minNote={zone.minNote}
          maxNote={zone.maxNote}
          color={zone.color}
          learningRoot={learning('rootNote')}
          onLearnRoot={() => toggleLearn('rootNote')}
        />
      )}
      {engine === 'soundfont' && !fonts.some((f) => f.id === zone.fontId) && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px', borderBottom: '1px solid var(--border)', background: '#FBEAE7', flexWrap: 'wrap' }}>
          <span style={{ ...lbl, color: '#B3281B', whiteSpace: 'normal', flex: 1 }}>
            THIS ZONE'S SOUNDFONT{zone.fontName ? ` “${zone.fontName.toUpperCase()}”` : ''} ISN'T LOADED — SO IT'S SILENT. LOAD THE FILE ONCE AND PERRY KEEPS IT FROM NOW ON.
          </span>
          <button onClick={() => onLoadFont(zone.fontId)} style={{ ...outlineBtn, height: 34, fontSize: 10, background: 'var(--ink)', color: 'var(--bg)' }}>LOAD {zone.fontName ? zone.fontName.toUpperCase() : 'FONT'}…</button>
        </div>
      )}
      {engine === 'soundfont' && (
        <section aria-label="SoundFont" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderBottom: '2px solid var(--ink)' }}>
          <Module title="PRESET" style={{ gridColumn: 'span 2', borderRight: '1px solid var(--border)' }}>
            <select
              aria-label="Preset"
              value={presetKey(zone)}
              onChange={(e) => {
                const p = presets.find((x) => presetKey(x) === e.target.value)
                if (p) onChange({ ...zone, bank: p.bank, program: p.program, drums: p.isDrum })
              }}
              style={{ ...bigSelect, width: '100%' }}
            >
              {presets.length === 0
                ? <option value={presetKey(zone)}>— load a soundfont —</option>
                : presets.map((p) => (
                  <option key={presetKey(p)} value={presetKey(p)}>
                    {p.isDrum ? '[DRUMS] ' : ''}{p.bank > 0 ? `[B${p.bank}] ` : ''}{p.program + 1}. {p.name}
                  </option>
                ))}
            </select>
          </Module>
          <Module title="FONT · CHANNEL">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                aria-label="SoundFont"
                value={zone.fontId}
                onChange={(e) => {
                  const fontId = e.target.value
                  const ps = presetsByFont[fontId] ?? []
                  const first = ps.find((p) => !p.isDrum) ?? ps[0]
                  onChange({ ...zone, fontId, bank: first?.bank ?? 0, program: first?.program ?? 0, drums: first?.isDrum ?? false })
                }}
                style={{ ...bigSelect, flex: 1, minWidth: 0 }}
              >
                {fonts.length === 0 && <option value={zone.fontId}>—</option>}
                {fonts.map((f) => <option key={f.id} value={f.id}>{f.name.replace(/\.[^.]+$/, '').toUpperCase()}</option>)}
              </select>
              <button onClick={() => onLoadFont(zone.fontId)} title="Swap the font in this slot" style={{ ...outlineBtn, height: 40, padding: '0 10px', fontSize: 10 }}>SWAP…</button>
              <select aria-label="MIDI channel" value={zone.channel} onChange={(e) => onChange({ ...zone, channel: Number(e.target.value) })} style={{ ...bigSelect, width: 76 }}>
                {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>CH {i + 1}</option>)}
              </select>
            </div>
          </Module>
        </section>
      )}

      {/* ── FX rack ── */}
      <ChannelPanel mix={mixOf(zone)} onChange={(mix) => onChange({ ...zone, mix, effects: undefined })} onOpenMixer={onOpenMixer} />
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={lbl}>{label}</span>
      {children}
    </div>
  )
}

function learnBtn(active: boolean): CSSProperties {
  return {
    ...outlineBtn, height: 40, fontSize: 10, padding: '0 10px', fontWeight: 600, minWidth: 82,
    background: active ? '#fbbf24' : 'transparent', borderColor: active ? '#fbbf24' : 'var(--ink)',
  }
}

const rail: CSSProperties = {
  width: 300, flexShrink: 0, background: 'var(--surface)', borderRight: '2px solid var(--ink)',
  display: 'flex', flexDirection: 'column', minHeight: 0,
}
const railHead: CSSProperties = {
  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
  padding: '14px 18px 10px', borderBottom: '2px solid var(--ink)', flexShrink: 0,
}
const card: CSSProperties = {
  display: 'flex', alignItems: 'stretch', textAlign: 'left', width: '100%', padding: 0,
  border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
  fontFamily: 'var(--font-mono)', color: 'var(--ink)', borderRadius: 0,
}
const addBtn: CSSProperties = {
  display: 'block', width: 'calc(100% - 36px)', margin: '14px 18px', height: 40,
  border: '1.5px dashed var(--label)', background: 'transparent', borderRadius: 0,
  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em',
}
const band: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', borderBottom: '2px solid var(--ink)',
}
const nameInput: CSSProperties = {
  ...hero,
  textTransform: 'uppercase', background: 'transparent', border: 'none', outline: 'none',
  color: 'var(--ink)', padding: 0, marginBottom: 12, width: '100%', minWidth: 0,
}
const removeBtn: CSSProperties = {
  width: 44, height: 44, background: 'transparent', border: '1.5px solid var(--border)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0,
}
const bigSelect: CSSProperties = {
  height: 40, background: '#fff', border: '1.5px solid var(--ink)', borderRadius: 0,
  color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '0 8px',
}
