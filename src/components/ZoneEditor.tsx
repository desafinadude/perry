import { useState } from 'react'
import type { Zone, Preset, LoadedFont, ZoneEngine } from '../types'
import { noteName, PIANO_MIN, PIANO_MAX, ZONE_COLORS, defaultEffects, defaultSynth, defaultSampler } from '../types'
import { EffectsPanel } from './EffectsPanel'
import { SynthPanel } from './SynthPanel'
import { SamplerPanel } from './SamplerPanel'

interface Props {
  zones: Zone[]
  fonts: LoadedFont[]
  presetsByFont: Record<string, Preset[]>
  onChange: (zone: Zone) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onLoadFont: (fontId: string) => void  // triggers file picker for that font slot
  learningMode: { zoneId: string; field: 'minNote' | 'maxNote' } | null
  onSetLearningMode: (mode: { zoneId: string; field: 'minNote' | 'maxNote' } | null) => void
  /** Loads an audio file into a sampler zone. */
  onLoadSample: (zone: Zone, file: File) => Promise<void>
  /** zoneId → sample availability, derived from the session sample cache. */
  sampleInfo: Record<string, { loaded: boolean; duration: number | null }>
}

export function ZoneEditor({
  zones, fonts, presetsByFont, onChange, onAdd, onRemove, onLoadFont,
  learningMode, onSetLearningMode, onLoadSample, sampleInfo,
}: Props) {
  // Which expandable panels are open, per zone id
  const [fxOpen, setFxOpen] = useState<Set<string>>(new Set())
  const [sndOpen, setSndOpen] = useState<Set<string>>(new Set())

  const toggleSet = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const toggleFx = (zone: Zone) => {
    const opening = !fxOpen.has(zone.id)
    setFxOpen((prev) => toggleSet(prev, zone.id))
    // materialise settings so the panel edits a real object
    if (opening && !zone.effects) onChange({ ...zone, effects: defaultEffects() })
  }

  const toggleSnd = (zone: Zone) => {
    setSndOpen((prev) => toggleSet(prev, zone.id))
  }

  const switchEngine = (zone: Zone, engine: ZoneEngine) => {
    const updated: Zone = { ...zone, engine }
    if (engine === 'synth' && !zone.synth) updated.synth = defaultSynth()
    if (engine === 'sampler' && !zone.sampler) updated.sampler = defaultSampler()
    onChange(updated)
    // open the engine's editor right away
    if (engine !== 'soundfont') setSndOpen((prev) => new Set(prev).add(zone.id))
    else setSndOpen((prev) => { const n = new Set(prev); n.delete(zone.id); return n })
  }
  return (
    <div>
      {zones.map((zone) => {
        const presets = presetsByFont[zone.fontId] ?? []
        const engine = zone.engine ?? 'soundfont'
        const isSF = engine === 'soundfont'
        return (
          <div key={zone.id} style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0,
            background: 'var(--bg)',
          }}>
            {/* Zone colour stripe */}
            <div style={{ width: 5, alignSelf: 'stretch', background: zone.color, flexShrink: 0 }} />

            {/* Name */}
            <input
              value={zone.name}
              onChange={(e) => onChange({ ...zone, name: e.target.value })}
              style={{ ...inp, width: 88, fontWeight: 600, color: zone.color, padding: '10px 10px', borderRight: '1px solid var(--border)' }}
            />

            {/* Colour swatches */}
            <div style={{ display: 'flex', gap: 4, padding: '0 12px', borderRight: '1px solid var(--border)', alignSelf: 'stretch', alignItems: 'center' }}>
              {ZONE_COLORS.map((c) => (
                <button key={c} onClick={() => onChange({ ...zone, color: c })} style={{
                  width: 12, height: 12, background: c, padding: 0, border: 'none',
                  outline: zone.color === c ? '2px solid var(--ink)' : '2px solid transparent',
                  outlineOffset: 1, cursor: 'pointer',
                }} />
              ))}
            </div>

            {/* Engine selector: SoundFont / Synth / Sampler */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRight: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <span style={lbl}>ENGINE</span>
              <div style={{ display: 'flex' }}>
                {([
                  ['soundfont', 'SF2'],
                  ['synth', 'SYNTH'],
                  ['sampler', 'SAMPLE'],
                ] as const).map(([value, label]) => {
                  const active = engine === value
                  return (
                    <button
                      key={value}
                      onClick={() => switchEngine(zone, value)}
                      title={
                        value === 'soundfont' ? 'SoundFont preset from the loaded .sf2'
                        : value === 'synth' ? 'Built-in subtractive synthesizer'
                        : 'Play a loaded audio sample across the keys'
                      }
                      style={{
                        background: active ? 'var(--accent-1)' : 'transparent',
                        color: active ? '#fff' : 'var(--muted)',
                        border: '1px solid ' + (active ? 'var(--accent-1)' : 'var(--border)'),
                        marginRight: -1, borderRadius: 0, cursor: 'pointer',
                        fontFamily: 'var(--font-mono)', fontSize: 9,
                        letterSpacing: '0.08em', padding: '4px 7px',
                        fontWeight: active ? 700 : 400,
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Font selector — soundfont engine only */}
            {isSF && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRight: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <span style={lbl}>FONT</span>
              <select
                value={zone.fontId}
                onChange={(e) => {
                  const newFontId = e.target.value
                  const newPresets = presetsByFont[newFontId] ?? []
                  const first = newPresets.find((p) => !p.isDrum) ?? newPresets[0]
                  onChange({ ...zone, fontId: newFontId, bank: first?.bank ?? 0, program: first?.program ?? 0 })
                }}
                style={sel}
              >
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>{f.name.replace(/\.[^.]+$/, '').toUpperCase()}</option>
                ))}
              </select>
              <button onClick={() => onLoadFont(zone.fontId)} style={iconBtn} title="Swap font for this zone">↑</button>
            </div>
            )}

            {/* Note range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRight: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <button
                onClick={() => onSetLearningMode({ zoneId: zone.id, field: 'minNote' })}
                style={{
                  ...learnBtn,
                  background: learningMode?.zoneId === zone.id && learningMode?.field === 'minNote' ? '#fbbf24' : 'transparent',
                  color: learningMode?.zoneId === zone.id && learningMode?.field === 'minNote' ? '#000' : 'var(--ink)',
                }}
                title="Click, then play a MIDI note or click piano key"
              >
                FROM {noteName(zone.minNote)}
              </button>
              <span style={{ color: 'var(--muted)' }}>—</span>
              <button
                onClick={() => onSetLearningMode({ zoneId: zone.id, field: 'maxNote' })}
                style={{
                  ...learnBtn,
                  background: learningMode?.zoneId === zone.id && learningMode?.field === 'maxNote' ? '#fbbf24' : 'transparent',
                  color: learningMode?.zoneId === zone.id && learningMode?.field === 'maxNote' ? '#000' : 'var(--ink)',
                }}
                title="Click, then play a MIDI note or click piano key"
              >
                TO {noteName(zone.maxNote)}
              </button>
            </div>

            {/* Preset — soundfont engine only */}
            {isSF && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRight: '1px solid var(--border)', alignSelf: 'stretch', flex: '1 1 160px', minWidth: 0 }}>
              <span style={lbl}>PRESET</span>
              <select
                value={`${zone.bank}:${zone.program}`}
                onChange={(e) => {
                  const [bank, program] = e.target.value.split(':').map(Number)
                  onChange({ ...zone, bank, program })
                }}
                style={{ ...sel, flex: 1, minWidth: 0 }}
              >
                {presets.length === 0
                  ? <option value={`${zone.bank}:${zone.program}`}>— load soundfont —</option>
                  : presets.map((p) => (
                    <option key={`${p.bank}:${p.program}`} value={`${p.bank}:${p.program}`}>
                      {p.isDrum ? '🥁 ' : ''}{p.bank > 0 ? `[B${p.bank}] ` : ''}{p.program + 1}. {p.name}
                    </option>
                  ))
                }
              </select>
            </div>
            )}

            {/* Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRight: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <span style={lbl}>VOL</span>
              <input type="range" min={0} max={127} value={zone.volume}
                onChange={(e) => onChange({ ...zone, volume: Number(e.target.value) })}
                style={{ width: 72 }} />
              <span style={{ color: 'var(--muted)', minWidth: 22, textAlign: 'right' }}>{zone.volume}</span>
            </div>

            {/* Channel — soundfont engine only */}
            {isSF && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRight: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <span style={lbl}>CH</span>
              <select value={zone.channel} onChange={(e) => onChange({ ...zone, channel: Number(e.target.value) })} style={sel}>
                {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select>
            </div>
            )}

            {/* Layer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 12px', alignSelf: 'stretch' }}>
              <span style={{ ...lbl, marginRight: 8 }}>LAYER</span>
              {(['input', 'both', 'playback'] as const).map((lv) => {
                const active = (zone.layer ?? 'both') === lv
                return (
                  <button key={lv} onClick={() => onChange({ ...zone, layer: lv })} style={{
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--bg)' : 'var(--muted)',
                    border: '1px solid var(--border)',
                    marginRight: -1,
                    borderRadius: 0,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    padding: '4px 8px',
                    fontWeight: active ? 700 : 400,
                  }} title={
                    lv === 'input' ? 'Live MIDI only – silent during sheet playback'
                    : lv === 'playback' ? 'Sheet playback only – silent for live MIDI'
                    : 'Both – responds to live MIDI and sheet playback'
                  }>
                    {lv === 'input' ? 'IN' : lv === 'playback' ? 'PLAY' : 'BOTH'}
                  </button>
                )
              })}
            </div>

            {/* Panel toggles: FX (all engines) + engine editor */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderLeft: '1px solid var(--border)', alignSelf: 'stretch' }}>
              <button
                onClick={() => toggleFx(zone)}
                style={panelToggleStyle(fxOpen.has(zone.id))}
                title="Insert effects for this zone's channel: filter, chorus, delay, reverb, pan"
              >FX</button>
              {!isSF && (
                <button
                  onClick={() => toggleSnd(zone)}
                  style={panelToggleStyle(sndOpen.has(zone.id))}
                  title={engine === 'synth' ? 'Edit the synth patch' : 'Edit the sample mapping'}
                >{engine === 'synth' ? 'SYNTH' : 'SMP'}</button>
              )}
            </div>

            {zones.length > 1 && (
              <button onClick={() => onRemove(zone.id)} style={{
                background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)',
                color: 'var(--muted)', cursor: 'pointer', padding: '0 12px', alignSelf: 'stretch', fontSize: 16,
              }}>×</button>
            )}
          </div>

          {/* ── expandable panels ── */}
          {fxOpen.has(zone.id) && zone.effects && (
            <EffectsPanel
              effects={zone.effects}
              onChange={(fx) => onChange({ ...zone, effects: fx })}
            />
          )}
          {engine === 'synth' && sndOpen.has(zone.id) && zone.synth && (
            <SynthPanel
              synth={zone.synth}
              onChange={(s) => onChange({ ...zone, synth: s })}
            />
          )}
          {engine === 'sampler' && sndOpen.has(zone.id) && zone.sampler && (
            <SamplerPanel
              settings={zone.sampler}
              onChange={(s) => onChange({ ...zone, sampler: s })}
              loaded={sampleInfo[zone.id]?.loaded ?? false}
              duration={sampleInfo[zone.id]?.duration ?? null}
              onLoad={(file) => onLoadSample(zone, file)}
            />
          )}
          </div>
        )
      })}

      <button onClick={onAdd} disabled={zones.length >= 8} style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
        color: zones.length >= 8 ? 'var(--muted)' : 'var(--accent-1)',
        cursor: zones.length >= 8 ? 'default' : 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em',
        padding: '10px 17px',
      }}>
        + ADD ZONE
      </button>
    </div>
  )
}

const sel: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 0, color: 'var(--ink)', fontSize: 11, padding: '3px 5px',
}
const inp: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--ink)', fontSize: 11, outline: 'none',
}
const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em',
  color: 'var(--muted)', userSelect: 'none', whiteSpace: 'nowrap',
}
const learnBtn: React.CSSProperties = {
  background: 'transparent', border: '1.5px solid var(--ink)', borderRadius: 0,
  color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
  fontSize: 10, letterSpacing: '0.12em', padding: '5px 10px', fontWeight: 600,
  transition: 'all 0.15s',
}
const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 0,
  color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: '2px 6px',
}
function panelToggleStyle(open: boolean): React.CSSProperties {
  return {
    background: open ? 'var(--accent-1)' : 'transparent',
    color: open ? '#fff' : 'var(--ink)',
    border: '1.5px solid ' + (open ? 'var(--accent-1)' : 'var(--ink)'),
    borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)',
    fontSize: 10, letterSpacing: '0.1em', padding: '4px 9px', fontWeight: 600,
  }
}
