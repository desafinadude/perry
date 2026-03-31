import { useState, useEffect, useRef, useCallback } from 'react'
import type { DrumTrack, LoadedFont, SavedBeat } from '../types'
import { DEFAULT_DRUM_TRACKS, DRUM_PRESETS, noteName, noteNameToMidi, getSavedBeats, saveBeat, deleteBeat } from '../types'

interface Props {
  fonts: LoadedFont[]
  onNoteOn:  (fontId: string, note: number, velocity: number) => void
  onNoteOff: (fontId: string, note: number) => void
  onApply:   (fontId: string, volume: number) => void
}

const STEPS_PER_BAR = 16
const GROUP = 4  // visual grouping

export function DrumMachine({ fonts, onNoteOn, onNoteOff, onApply }: Props) {
  const [tracks, setTracks]       = useState<DrumTrack[]>(DEFAULT_DRUM_TRACKS)
  const [playing, setPlaying]     = useState(false)
  const [bpm, setBpm]             = useState(100)
  const [currentStep, setStep]    = useState(-1)
  const [volume, setVolume]       = useState(100)
  const [fontId, setFontId]       = useState<string>(fonts[0]?.id ?? '')
  const [collapsed, setCollapsed] = useState(false)
  const [swing, setSwing]         = useState(0) // 0-100: swing amount
  const [bars, setBars]           = useState(4) // number of bars
  const [savedBeats, setSavedBeats] = useState<SavedBeat[]>(getSavedBeats())
  const [beatName, setBeatName]   = useState('')
  const [showSaved, setShowSaved] = useState(false)

  const totalSteps = bars * STEPS_PER_BAR

  // Sync fontId when fonts list first arrives or changes
  useEffect(() => {
    if (!fontId && fonts.length > 0) setFontId(fonts[0].id)
  }, [fonts, fontId])

  // Apply drum channel settings when font or volume changes
  useEffect(() => {
    if (fontId) onApply(fontId, volume)
  }, [fontId, volume, onApply])

  // Refs so the scheduler always reads the latest state without restarting
  const tracksRef  = useRef(tracks);  tracksRef.current  = tracks
  const fontIdRef  = useRef(fontId);  fontIdRef.current  = fontId
  const swingRef   = useRef(swing);   swingRef.current   = swing
  const playingRef = useRef(playing); playingRef.current = playing
  const totalStepsRef = useRef(totalSteps); totalStepsRef.current = totalSteps
  const stepRef    = useRef(0)
  const timeoutRef = useRef<number | null>(null)  // Track the timeout ID

  const stop = useCallback(() => {
    setPlaying(false)
    setStep(-1)
    stepRef.current = 0
    // Cancel any pending timeout
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Scheduling with swing support
  useEffect(() => {
    if (!playing) return
    const baseMsPerStep = (60_000 / bpm) / 4   // 16th note duration

    const tick = () => {
      // Check if still playing (might have been stopped)
      if (!playingRef.current) return
      
      const s = stepRef.current
      tracksRef.current.forEach((t) => {
        if (!t.muted && t.steps[s]) {
          // Calculate velocity based on step intensity (0=off, 1=light, 2=medium, 3=heavy)
          const intensity = t.steps[s]
          const velocityMultiplier = intensity === 1 ? 0.5 : intensity === 2 ? 0.75 : 1.0
          const actualVelocity = Math.round(t.velocity * velocityMultiplier)
          
          onNoteOn(fontIdRef.current, t.note, actualVelocity)
          setTimeout(() => onNoteOff(fontIdRef.current, t.note), Math.min(baseMsPerStep * 0.8, 120))
        }
      })
      setStep(s)
      const nextStep = (s + 1) % totalStepsRef.current
      stepRef.current = nextStep

      // Apply swing: delay odd-numbered steps (offbeats)
      const swingAmount = swingRef.current / 100
      const isOffbeat = s % 2 === 0  // steps 0,2,4,6... are on-beats, next ones are off-beats
      const delayMs = isOffbeat ? baseMsPerStep * (1 + swingAmount * 0.5) : baseMsPerStep * (1 - swingAmount * 0.5)
      
      timeoutRef.current = window.setTimeout(tick, delayMs)
    }

    tick() // fire immediately on first tick
    
    return () => {
      // Cleanup: cancel any pending timeout when effect re-runs or component unmounts
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [playing, bpm, onNoteOn, onNoteOff])

  const toggleStep = (trackId: string, step: number) => {
    setTracks((prev) =>
      prev.map((t) => t.id === trackId
        ? { ...t, steps: t.steps.map((v, i) => i === step ? (v + 1) % 4 : v) }
        : t,
      ),
    )
  }

  const toggleMute = (trackId: string) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, muted: !t.muted } : t))
  }

  const clearTrack = (trackId: string) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, steps: Array(totalSteps).fill(0) } : t))
  }

  const changeNote = (trackId: string, note: number) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, note } : t))
  }

  const changeNoteByName = (trackId: string, name: string) => {
    const midi = noteNameToMidi(name)
    if (midi !== null) changeNote(trackId, midi)
  }

  const loadPreset = (presetKey: keyof typeof DRUM_PRESETS) => {
    const preset = DRUM_PRESETS[presetKey].tracks
    // Duplicate the 16-step pattern to fill the available bars
    const extendedTracks = preset.map((t) => {
      const basePattern = t.steps.slice(0, STEPS_PER_BAR)
      const extended = []
      for (let i = 0; i < bars; i++) {
        extended.push(...basePattern)
      }
      return { ...t, steps: extended }
    })
    setTracks(extendedTracks)
  }

  const handleBarsChange = (newBars: number) => {
    setBars(newBars)
    const newTotalSteps = newBars * STEPS_PER_BAR
    setTracks((prev) => prev.map((t) => {
      if (t.steps.length === newTotalSteps) return t
      if (t.steps.length > newTotalSteps) {
        // Shrink: truncate
        return { ...t, steps: t.steps.slice(0, newTotalSteps) }
      } else {
        // Grow: repeat pattern
        const extended = [...t.steps]
        while (extended.length < newTotalSteps) {
          const remaining = newTotalSteps - extended.length
          const toCopy = Math.min(STEPS_PER_BAR, remaining)
          extended.push(...t.steps.slice(0, toCopy))
        }
        return { ...t, steps: extended }
      }
    }))
  }

  const handleSaveBeat = useCallback(() => {
    const name = beatName.trim() || `Beat ${savedBeats.length + 1}`
    setSavedBeats(saveBeat(name, tracks, bars))
    setBeatName('')
  }, [beatName, savedBeats.length, tracks, bars])

  const handleLoadBeat = useCallback((beat: SavedBeat) => {
    setBars(beat.bars)
    setTracks(beat.tracks)
    setShowSaved(false)
  }, [])

  const handleDeleteBeat = useCallback((id: string) => {
    setSavedBeats(deleteBeat(id))
  }, [])

  return (
    <div style={{ borderTop: '2px solid var(--ink)', background: 'var(--surface)', flexShrink: 0 }}>

      {/* ── Header band ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: collapsed ? 'none' : '2px solid var(--ink)',
        minHeight: 42,
      }}>
        {/* Section label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRight: '1px solid var(--border)', paddingRight: 16 }}>
          <div style={{ width: 5, alignSelf: 'stretch', background: 'var(--accent-2)', marginRight: 12 }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: '0.1em', lineHeight: 1 }}>
            DRUMS
          </span>
        </div>

        {!collapsed && <>
          {/* Play / Stop */}
          <div style={{ display: 'flex', gap: 0, borderRight: '1px solid var(--border)', alignSelf: 'stretch', alignItems: 'center', padding: '0 16px' }}>
            <button
              onClick={() => playing ? stop() : setPlaying(true)}
              style={{
                ...btn,
                background: playing ? 'var(--accent-2)' : 'var(--accent-1)',
                border: `1.5px solid ${playing ? 'var(--accent-2)' : 'var(--accent-1)'}`,
                color: '#fff',
                minWidth: 64,
              }}
            >
              {playing ? '■ STOP' : '▶ PLAY'}
            </button>
          </div>

          {/* BPM */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>BPM</span>
            <input
              type="number" min={40} max={300} value={bpm}
              onChange={(e) => setBpm(Math.max(40, Math.min(300, Number(e.target.value))))}
              style={{ ...numInput, width: 52 }}
            />
            <input type="range" min={40} max={240} value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </div>

          {/* Bars */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>BARS</span>
            <input
              type="number" min={1} max={8} value={bars}
              onChange={(e) => handleBarsChange(Math.max(1, Math.min(8, Number(e.target.value))))}
              style={{ ...numInput, width: 42 }}
            />
          </div>

          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>VOL</span>
            <input type="range" min={0} max={127} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ width: 72 }}
            />
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 22 }}>{volume}</span>
          </div>

          {/* Swing */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>SWING</span>
            <input type="range" min={0} max={100} value={swing}
              onChange={(e) => setSwing(Number(e.target.value))}
              style={{ width: 72 }}
            />
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 22 }}>{swing}%</span>
          </div>

          {/* Font selector */}
          {fonts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
              <span style={lbl}>FONT</span>
              <select
                value={fontId}
                onChange={(e) => setFontId(e.target.value)}
                style={sel}
              >
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>{f.name.replace(/\.[^.]+$/, '').toUpperCase()}</option>
                ))}
              </select>
            </div>
          )}

          {/* Playing step indicator */}
          {playing && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-2)', padding: '0 16px', letterSpacing: '0.1em' }}>
              STEP {currentStep + 1}
            </span>
          )}

          {/* Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>PRESET</span>
            <select
              onChange={(e) => { if (e.target.value) loadPreset(e.target.value as keyof typeof DRUM_PRESETS); e.target.value = '' }}
              value=""
              style={sel}
            >
              <option value="">Select...</option>
              <option value="lofi">Lo-Fi Chill</option>
              <option value="jazz">Jazz Swing</option>
            </select>
          </div>

          {/* Save beat */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <input
              value={beatName}
              onChange={(e) => setBeatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveBeat()}
              placeholder="beat name"
              style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--ink)', fontSize: 11, padding: '2px 4px', outline: 'none', width: 90 }}
            />
            <button onClick={handleSaveBeat} style={ghostBtn}>SAVE</button>
          </div>

          {/* Saved beats */}
          {savedBeats.length > 0 && (
            <div style={{ position: 'relative', alignSelf: 'stretch', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--border)' }}>
              <button onClick={() => setShowSaved((v) => !v)} style={{
                ...ghostBtn, margin: '0 16px',
                background: showSaved ? 'var(--accent-2)' : 'transparent',
                color: showSaved ? '#fff' : 'var(--ink)',
                border: showSaved ? '1.5px solid var(--accent-2)' : '1.5px solid var(--ink)',
              }}>
                BEATS {showSaved ? '▲' : '▼'}
              </button>
              {showSaved && (
                <div style={{
                  position: 'absolute', top: '100%', left: 16, zIndex: 100,
                  background: 'var(--bg)', border: '1.5px solid var(--ink)',
                  minWidth: 220, boxShadow: '4px 4px 0 var(--ink)',
                }}>
                  {savedBeats.map((beat) => (
                    <div key={beat.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <button onClick={() => handleLoadBeat(beat)} style={{
                        flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                        color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
                        fontSize: 11, padding: '9px 12px', letterSpacing: '0.05em',
                      }}>
                        {beat.name}
                        <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 10 }}>{beat.bars}B</span>
                      </button>
                      <button onClick={() => handleDeleteBeat(beat.id)} style={{
                        background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)',
                        color: 'var(--muted)', cursor: 'pointer', padding: '0 12px', alignSelf: 'stretch', fontSize: 14,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>}

        {/* Collapse toggle */}
        <button
          onClick={() => { if (playing) stop(); setCollapsed((v) => !v) }}
          style={{ ...ghostBtn, marginLeft: 'auto', marginRight: 12, fontSize: 10 }}
        >
          {collapsed ? '▲ EXPAND' : '▼ COLLAPSE'}
        </button>
      </div>

      {/* ── Grid ── */}
      {!collapsed && (
        <div style={{ overflowX: 'auto' }}>
          {tracks.map((track) => (
            <div key={track.id} style={{
              display: 'flex', alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              background: track.muted ? 'var(--bg)' : 'var(--surface)',
            }}>
              {/* Track label */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                width: 88, flexShrink: 0,
                padding: '0 0 0 12px',
                borderRight: '1px solid var(--border)',
                alignSelf: 'stretch',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                  color: track.muted ? 'var(--muted)' : 'var(--ink)',
                  flex: 1,
                }}>
                  {track.name}
                </span>
              </div>

              {/* Note selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px', borderRight: '1px solid var(--border)', alignSelf: 'stretch', justifyContent: 'center' }}>
                <input
                  type="text"
                  value={noteName(track.note)}
                  onChange={(e) => changeNoteByName(track.id, e.target.value.trim().toUpperCase())}
                  style={{ ...numInput, width: 38, textAlign: 'center', fontSize: 10 }}
                  title="Note name (e.g., C4, A0)"
                />
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={track.note}
                  onChange={(e) => changeNote(track.id, Math.max(0, Math.min(127, Number(e.target.value))))}
                  style={{ ...numInput, width: 38, fontSize: 9 }}
                  title="MIDI note number"
                />
              </div>

              {/* Mute + clear buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px', borderRight: '1px solid var(--border)', alignSelf: 'stretch', justifyContent: 'center' }}>
                <button onClick={() => toggleMute(track.id)} style={{
                  ...microBtn,
                  background: track.muted ? 'var(--muted)' : 'transparent',
                  color: track.muted ? '#fff' : 'var(--muted)',
                }}>M</button>
                <button onClick={() => clearTrack(track.id)} style={{ ...microBtn, color: 'var(--muted)' }}>✕</button>
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 10px', flex: 1 }}>
                {track.steps.map((intensity, i) => {
                  const isCurrent = i === currentStep && playing
                  const isGroupStart = i > 0 && i % GROUP === 0
                  
                  // intensity: 0=off, 1=light, 2=medium, 3=heavy
                  const getStepColor = () => {
                    if (isCurrent) {
                      if (intensity === 0) return '#dbd8d0'
                      if (intensity === 1) return '#fbbf24'  // light yellow
                      if (intensity === 2) return '#fb923c'  // orange
                      return 'var(--accent-1)'  // heavy red
                    }
                    if (intensity === 0) return 'var(--bg)'
                    if (intensity === 1) return '#d4d4d4'  // light gray
                    if (intensity === 2) return '#8b8b8b'  // medium gray
                    return 'var(--ink)'  // heavy black
                  }
                  
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                      {isGroupStart && (
                        <div style={{ width: 6, flexShrink: 0 }} />
                      )}
                      <button
                        onClick={() => toggleStep(track.id, i)}
                        style={{
                          width: 28, height: 28,
                          border: `1.5px solid ${intensity > 0 ? 'var(--ink)' : 'var(--border)'}`,
                          borderRadius: 0,
                          background: getStepColor(),
                          cursor: 'pointer',
                          outline: isCurrent ? '2px solid var(--accent-1)' : 'none',
                          outlineOffset: -1,
                          transition: 'background 80ms ease-out, outline 80ms ease-out',
                          flexShrink: 0,
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const btn: React.CSSProperties = {
  borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)',
  fontSize: 11, letterSpacing: '0.12em', padding: '7px 14px',
}
const ghostBtn: React.CSSProperties = {
  ...btn, background: 'transparent', border: '1.5px solid var(--border)',
  color: 'var(--muted)',
}
const microBtn: React.CSSProperties = {
  borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)',
  fontSize: 9, letterSpacing: '0.1em', padding: '2px 4px',
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink)',
}
const lbl: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em',
  color: 'var(--muted)', userSelect: 'none', whiteSpace: 'nowrap',
}
const sel: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 0, color: 'var(--ink)', fontSize: 11, padding: '3px 5px',
}
const numInput: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 0, color: 'var(--ink)', fontSize: 11,
  padding: '3px 5px', textAlign: 'center',
}
