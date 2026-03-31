import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Piano } from './components/Piano'
import { ZoneEditor } from './components/ZoneEditor'
import { Recorder, RecorderHandle } from './components/Recorder'
import { useSynth } from './hooks/useSynth'
import { useMidi } from './hooks/useMidi'
import type { Zone, Preset, SavedConfig } from './types'
import { ZONE_COLORS, PIANO_MIN, PIANO_MAX, getSavedConfigs, saveConfig, deleteConfig } from './types'

let zoneIdCounter = 1
function makeZone(fontId: string, idx: number, overrides: Partial<Zone> = {}): Zone {
  return {
    id: String(zoneIdCounter++),
    name: `Zone ${idx + 1}`,
    minNote: PIANO_MIN, maxNote: PIANO_MAX,
    channel: idx % 16,
    program: 0, bank: 0,
    volume: 100,
    color: ZONE_COLORS[idx % ZONE_COLORS.length],
    fontId,
    ...overrides,
  }
}

export default function App() {
  const [zones, setZones] = useState<Zone[]>([])
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set())
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>(getSavedConfigs)
  const [saveInput, setSaveInput] = useState('')
  const [showSaved, setShowSaved] = useState(false)
  
  const recorderRef = useRef<RecorderHandle>(null)

  const {
    status, loadProgress, errorMsg, fonts,
    init, loadFont, removeFont,
    applyZone, noteOn, noteOff, sendCC, sendPitchBend,
    allNotesOff, firstMelodicPreset,
  } = useSynth()

  // Once a font loads, create default zone if none exist
  useEffect(() => {
    if (fonts.length > 0 && zones.length === 0) {
      const first = firstMelodicPreset(fonts[0].presets)
      setZones([makeZone(fonts[0].id, 0, {
        bank: first?.bank ?? 0,
        program: first?.program ?? 0,
      })])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts])

  // presets keyed by fontId, for ZoneEditor
  const presetsByFont = useMemo<Record<string, Preset[]>>(() => {
    const out: Record<string, Preset[]> = {}
    fonts.forEach((f) => { out[f.id] = f.presets })
    return out
  }, [fonts])

  // Snap zone to first valid preset when its font's presets change
  useEffect(() => {
    if (fonts.length === 0) return
    setZones((prev) => prev.map((z) => {
      const ps = presetsByFont[z.fontId] ?? []
      if (ps.length === 0) return z
      const valid = ps.some((p) => p.bank === z.bank && p.program === z.program)
      if (valid) return z
      const first = ps.find((p) => !p.isDrum) ?? ps[0]
      return { ...z, bank: first.bank, program: first.program }
    }))
  }, [presetsByFont, fonts])

  // Sync zones to synth on change
  const prevZonesRef = useRef<Zone[]>([])
  useEffect(() => {
    if (status !== 'ready') return
    zones.forEach((zone, i) => {
      const prev = prevZonesRef.current[i]
      if (!prev || prev.program !== zone.program || prev.bank !== zone.bank
        || prev.volume !== zone.volume || prev.channel !== zone.channel
        || prev.fontId !== zone.fontId) {
        applyZone(zone)
      }
    })
    prevZonesRef.current = zones
  }, [zones, status, applyZone])

  // Apply all zones on first ready
  const initializedRef = useRef(false)
  useEffect(() => {
    if (status === 'ready' && !initializedRef.current) {
      initializedRef.current = true
      zones.forEach(applyZone)
    }
  }, [status, zones, applyZone])

  // MIDI handlers
  const handleNoteOn = useCallback((note: number, velocity: number) => {
    const matching = zones.filter((z) => note >= z.minNote && note <= z.maxNote)
    matching.forEach((z) => noteOn(z, note, velocity))
    if (matching.length > 0) setActiveNotes((prev) => new Set([...prev, note]))
    // Record if recorder is active
    recorderRef.current?.recordNoteOn(note, velocity)
  }, [zones, noteOn])

  const handleNoteOff = useCallback((note: number) => {
    zones.filter((z) => note >= z.minNote && note <= z.maxNote).forEach((z) => noteOff(z, note))
    setActiveNotes((prev) => { const s = new Set(prev); s.delete(note); return s })
    // Record if recorder is active
    recorderRef.current?.recordNoteOff(note)
  }, [zones, noteOff])

  const handleCC = useCallback((cc: number, value: number) => {
    sendCC(zones, cc, value)
  }, [zones, sendCC])

  const handlePitchBend = useCallback((value: number) => {
    sendPitchBend(zones, value)
  }, [zones, sendPitchBend])

  const { inputs, selectedId, selectInput, supported } = useMidi({
    onNoteOn: handleNoteOn, onNoteOff: handleNoteOff,
    onCC: handleCC, onPitchBend: handlePitchBend,
  })

  // Zone management
  const handleZoneChange = useCallback((updated: Zone) =>
    setZones((prev) => prev.map((z) => z.id === updated.id ? updated : z)), [])

  const handleAddZone = useCallback(() => {
    setZones((prev) => {
      if (prev.length >= 8) return prev
      const split = Math.floor((PIANO_MIN + PIANO_MAX) / 2)
      const fontId = fonts[0]?.id ?? 'main'
      const ps = presetsByFont[fontId] ?? []
      const first = ps.find((p) => !p.isDrum) ?? ps[0]
      return [...prev, makeZone(fontId, prev.length, {
        minNote: split + 1, maxNote: PIANO_MAX,
        bank: first?.bank ?? 0, program: first?.program ?? 0,
      })]
    })
  }, [fonts, presetsByFont])

  const handleRemoveZone = useCallback((id: string) => {
    allNotesOff(); setActiveNotes(new Set())
    setZones((prev) => prev.filter((z) => z.id !== id))
  }, [allNotesOff])

  // Font loading: load an additional font or replace one by fontId
  const fontFileInputRef = useRef<HTMLInputElement>(null)
  const pendingFontIdRef = useRef<string | null>(null)

  const handleLoadFontForZone = useCallback((currentFontId: string) => {
    pendingFontIdRef.current = currentFontId
    fontFileInputRef.current?.click()
  }, [])

  const handleAddFont = useCallback(() => {
    pendingFontIdRef.current = null // null = add new
    fontFileInputRef.current?.click()
  }, [])

  const handleFontFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const buffer = await file.arrayBuffer()
    const replaceId = pendingFontIdRef.current ?? undefined

    allNotesOff()
    const newId = await loadFont(buffer, file.name, replaceId)

    // If we replaced a font, keep zones pointing to it (same id); if new, do nothing
    if (!replaceId) {
      // New font loaded — don't auto-assign zones, let user pick
      void newId
    }
  }, [allNotesOff, loadFont])

  // Save / load configs
  const handleSave = useCallback(() => {
    const name = saveInput.trim() || `Config ${savedConfigs.length + 1}`
    setSavedConfigs(saveConfig(name, zones))
    setSaveInput('')
  }, [saveInput, savedConfigs.length, zones])

  const handleLoad = useCallback((cfg: SavedConfig) => {
    allNotesOff(); setActiveNotes(new Set())
    setZones(cfg.zones.map((z) => ({ ...z, id: String(zoneIdCounter++) })))
    setShowSaved(false)
  }, [allNotesOff])

  const handleDelete = useCallback((id: string) => setSavedConfigs(deleteConfig(id)), [])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Hidden font file input */}
      <input ref={fontFileInputRef} type="file" accept=".sf2,.sf3"
        onChange={handleFontFileChange} style={{ display: 'none' }} />

      {/* ━━━ HEADER ━━━ */}
      <header style={{
        background: 'var(--ink)', borderBottom: '2px solid var(--ink)',
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
      }}>
        <div style={{ width: 6, background: 'var(--accent-1)', flexShrink: 0 }} />

        <div style={{ padding: '10px 24px 10px 18px', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 0.9, letterSpacing: '0.05em', color: 'var(--bg)' }}>
            PERRY
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.2em', color: '#888', marginTop: 4 }}>
            MIDI ZONE PLAYER
          </div>
        </div>

        {/* SF status */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 20px', borderRight: '1px solid #2a2a2a', minWidth: 200 }}>
          {status === 'idle' && (
            <button onClick={init} style={primaryBtn}>INITIALIZE SYNTH</button>
          )}
          {status === 'loading' && (
            <div>
              <div style={{ width: 140, height: 2, background: '#333', marginBottom: 6 }}>
                <div style={{ width: `${loadProgress}%`, height: '100%', background: 'var(--accent-1)', transition: 'width 0.2s ease-out' }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#888', letterSpacing: '0.1em' }}>{loadProgress}%</span>
            </div>
          )}
          {status === 'ready' && fonts.length === 0 && (
            <div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#888', letterSpacing: '0.1em' }}>
                READY · NO FONTS LOADED
              </span>
            </div>
          )}
          {status === 'ready' && fonts.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div style={{ width: 6, height: 6, background: 'var(--accent-1)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--bg)' }}>
                  {fonts.length} FONT{fonts.length !== 1 ? 'S' : ''}
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#666', letterSpacing: '0.1em' }}>
                {fonts.map((f) => f.presets.length).reduce((a, b) => a + b, 0)} PRESETS LOADED
              </span>
            </div>
          )}
          {status === 'error' && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-2)' }}>ERROR: {errorMsg.slice(0, 28)}</span>
          )}
        </div>

        {/* Add font / manage fonts */}
        {status === 'ready' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderRight: '1px solid #2a2a2a' }}>
            <button onClick={handleAddFont} style={ghostBtnDark}>+ LOAD FONT</button>
            {fonts.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1a1a1a', padding: '4px 8px', border: '1px solid #2a2a2a' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--bg)' }}>
                  {f.name.replace(/\.[^.]+$/, '').slice(0, 14).toUpperCase()}
                </span>
                <button onClick={() => removeFont(f.id)} style={{ 
                  background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', 
                  padding: '0 2px', fontSize: 14, lineHeight: 1,
                  transition: 'color 0.15s',
                }}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* MIDI selector */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 20px', borderLeft: '1px solid #2a2a2a' }}>
          {!supported ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-2)', letterSpacing: '0.1em' }}>NO WEB MIDI</span>
          ) : inputs.length === 0 ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#555', letterSpacing: '0.1em' }}>NO MIDI INPUT</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#555', letterSpacing: '0.15em' }}>MIDI INPUT</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, background: 'var(--accent-1)' }} />
                <select value={selectedId ?? ''} onChange={(e) => selectInput(e.target.value)}
                  style={{ background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 0, color: 'var(--bg)', fontSize: 11, padding: '3px 6px', cursor: 'pointer' }}>
                  {inputs.map((inp) => <option key={inp.id} value={inp.id}>{inp.name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ━━━ PIANO ━━━ */}
      <Piano zones={zones} activeNotes={activeNotes} height={60} />

      {/* ━━━ ZONES ━━━ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', borderBottom: '2px solid var(--ink)',
          background: 'var(--surface)', minHeight: 42, padding: '0 0 0 11px',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, letterSpacing: '0.1em', paddingRight: 16, borderRight: '1px solid var(--border)' }}>
            ZONES
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', padding: '0 16px', borderRight: '1px solid var(--border)' }}>
            {zones.length}/8
          </span>

          {/* Save config */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderRight: '1px solid var(--border)', alignSelf: 'stretch', gap: 6 }}>
            <input value={saveInput} onChange={(e) => setSaveInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="config name"
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--ink)', fontSize: 11, padding: '2px 4px', outline: 'none', width: 110 }} />
            <button onClick={handleSave} style={ghostBtn}>SAVE</button>
          </div>

          {savedConfigs.length > 0 && (
            <div style={{ position: 'relative', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
              <button onClick={() => setShowSaved((v) => !v)} style={{
                ...ghostBtn, margin: '0 16px',
                background: showSaved ? 'var(--accent-1)' : 'transparent',
                color: showSaved ? '#fff' : 'var(--ink)',
                border: showSaved ? '1.5px solid var(--accent-1)' : '1.5px solid var(--ink)',
              }}>
                PRESETS {showSaved ? '▲' : '▼'}
              </button>
              {showSaved && (
                <div style={{
                  position: 'absolute', top: '100%', left: 16, zIndex: 100,
                  background: 'var(--bg)', border: '1.5px solid var(--ink)',
                  minWidth: 220, boxShadow: '4px 4px 0 var(--ink)',
                }}>
                  {savedConfigs.map((cfg) => (
                    <div key={cfg.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <button onClick={() => handleLoad(cfg)} style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '9px 12px', letterSpacing: '0.05em',
                      }}>
                        {cfg.name}
                        <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 10 }}>{cfg.zones.length}Z</span>
                      </button>
                      <button onClick={() => handleDelete(cfg.id)} style={{
                        background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)',
                        color: 'var(--muted)', cursor: 'pointer', padding: '0 12px', alignSelf: 'stretch', fontSize: 14,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeNotes.size > 0 && (
            <span style={{ marginLeft: 'auto', marginRight: 16, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent-1)', letterSpacing: '0.15em' }}>
              ● {activeNotes.size > 1 ? `${activeNotes.size} NOTES` : '1 NOTE'}
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ZoneEditor
            zones={zones}
            fonts={fonts}
            presetsByFont={presetsByFont}
            onChange={handleZoneChange}
            onAdd={handleAddZone}
            onRemove={handleRemoveZone}
            onLoadFont={handleLoadFontForZone}
          />
        </div>
      </div>

      {/* ━━━ RECORDER ━━━ */}
      <div style={{ height: 240, flexShrink: 0, borderTop: '2px solid var(--ink)', overflow: 'hidden' }}>
        <Recorder ref={recorderRef} />
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--accent-1)', border: '1.5px solid var(--accent-1)', borderRadius: 0,
  color: '#fff', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11,
  letterSpacing: '0.15em', padding: '8px 14px',
}
const ghostBtnDark: React.CSSProperties = {
  background: 'transparent', border: '1.5px solid #2a2a2a', borderRadius: 0,
  color: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
  fontSize: 11, letterSpacing: '0.12em', padding: '6px 12px',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1.5px solid var(--ink)', borderRadius: 0,
  color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
  fontSize: 11, letterSpacing: '0.12em', padding: '5px 10px',
}
