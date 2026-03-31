import { useState, useCallback, useEffect, useRef } from 'react'
import type { MelodicTrack, MelodicNote, LoadedFont, Preset } from '../types'
import { noteName } from '../types'

interface Props {
  tracks: MelodicTrack[]
  bars: number
  fonts: LoadedFont[]
  presetsByFont: Record<string, Preset[]>
  onTracksChange: (tracks: MelodicTrack[]) => void
  onAddTrack: () => void
  onRemoveTrack: (id: string) => void
  // Playback props
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  bpm: number
  swing: number
  onMelodicNoteOn: (track: MelodicTrack, note: number, velocity: number) => void
  onMelodicNoteOff: (track: MelodicTrack, note: number) => void
}

const STEPS_PER_BAR = 16
const PIANO_RANGE = { min: 36, max: 84 } // C2 to C6

export function PianoRoll({ tracks, bars, fonts, presetsByFont, onTracksChange, onAddTrack, onRemoveTrack, playing, onPlayingChange, bpm, swing, onMelodicNoteOn, onMelodicNoteOff }: Props) {
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(tracks[0]?.id ?? null)
  const [currentStep, setStep] = useState(-1)
  const totalSteps = bars * STEPS_PER_BAR
  const noteRange = PIANO_RANGE.max - PIANO_RANGE.min + 1

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId)

  // Refs for playback
  const tracksRef = useRef(tracks); tracksRef.current = tracks
  const swingRef = useRef(swing); swingRef.current = swing
  const playingRef = useRef(playing); playingRef.current = playing
  const totalStepsRef = useRef(totalSteps); totalStepsRef.current = totalSteps
  const stepRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)
  const activeNotesRef = useRef<Map<string, number>>(new Map()) // Track active notes per track

  const stop = useCallback(() => {
    onPlayingChange(false)
    setStep(-1)
    stepRef.current = 0
    // Stop all active notes
    activeNotesRef.current.forEach((note, trackId) => {
      const track = tracksRef.current.find(t => t.id === trackId)
      if (track) {
        onMelodicNoteOff(track, note)
      }
    })
    activeNotesRef.current.clear()
    // Cancel any pending timeout
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [onPlayingChange, onMelodicNoteOff])

  // Playback scheduling
  useEffect(() => {
    if (!playing) return
    const baseMsPerStep = (60_000 / bpm) / 4 // 16th note duration

    const tick = () => {
      if (!playingRef.current) return
      
      const s = stepRef.current
      
      // Play notes that start at this step
      tracksRef.current.forEach((track) => {
        if (track.muted) return
        
        track.notes.forEach((noteData) => {
          if (noteData.start === s) {
            // Start note
            onMelodicNoteOn(track, noteData.note, noteData.velocity)
            // Schedule note off based on length
            const noteOffDelay = baseMsPerStep * noteData.length * 0.8
            setTimeout(() => {
              onMelodicNoteOff(track, noteData.note)
            }, noteOffDelay)
          }
        })
      })
      
      setStep(s)
      const nextStep = (s + 1) % totalStepsRef.current
      stepRef.current = nextStep

      // Apply swing
      const swingAmount = swingRef.current / 100
      const isOffbeat = s % 2 === 0
      const delayMs = isOffbeat ? baseMsPerStep * (1 + swingAmount * 0.5) : baseMsPerStep * (1 - swingAmount * 0.5)
      
      timeoutRef.current = window.setTimeout(tick, delayMs)
    }

    tick()
    
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [playing, bpm, onMelodicNoteOn, onMelodicNoteOff])

  const updateTrack = useCallback((id: string, updates: Partial<MelodicTrack>) => {
    onTracksChange(tracks.map((t) => t.id === id ? { ...t, ...updates } : t))
  }, [tracks, onTracksChange])

  const toggleNote = useCallback((trackId: string, note: number, step: number) => {
    const track = tracks.find((t) => t.id === trackId)
    if (!track) return

    // Check if note exists at this step
    const existingNoteIndex = track.notes.findIndex((n) => n.note === note && n.start === step)
    
    if (existingNoteIndex >= 0) {
      // Remove the note
      const newNotes = track.notes.filter((_, i) => i !== existingNoteIndex)
      updateTrack(trackId, { notes: newNotes })
    } else {
      // Add a new note
      const newNote: MelodicNote = { note, start: step, length: 1, velocity: 100 }
      updateTrack(trackId, { notes: [...track.notes, newNote] })
    }
  }, [tracks, updateTrack])

  const changeProgram = useCallback((trackId: string, bank: number, program: number) => {
    updateTrack(trackId, { bank, program })
  }, [updateTrack])

  const changeFontId = useCallback((trackId: string, fontId: string) => {
    const presets = presetsByFont[fontId] ?? []
    const first = presets.find((p) => !p.isDrum) ?? presets[0]
    updateTrack(trackId, {
      fontId,
      bank: first?.bank ?? 0,
      program: first?.program ?? 0,
    })
  }, [presetsByFont, updateTrack])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
      {/* Track controls */}
      {selectedTrack && (
        <div style={{ 
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: '2px solid var(--ink)', background: 'var(--bg)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
            FONT
          </span>
          <select
            value={selectedTrack.fontId}
            onChange={(e) => changeFontId(selectedTrack.id, e.target.value)}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 0, color: 'var(--ink)', fontSize: 11, padding: '3px 5px',
            }}
          >
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>{f.name.replace(/\.[^.]+$/, '')}</option>
            ))}
          </select>

          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
            PRESET
          </span>
          <select
            value={`${selectedTrack.bank}:${selectedTrack.program}`}
            onChange={(e) => {
              const [bank, program] = e.target.value.split(':').map(Number)
              changeProgram(selectedTrack.id, bank, program)
            }}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 0, color: 'var(--ink)', fontSize: 11, padding: '3px 5px',
              minWidth: 150,
            }}
          >
            {(presetsByFont[selectedTrack.fontId] ?? [])
              .filter((p) => !p.isDrum)
              .map((p) => (
                <option key={`${p.bank}:${p.program}`} value={`${p.bank}:${p.program}`}>
                  {p.name}
                </option>
              ))}
          </select>

          <button
            onClick={() => updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })}
            style={{
              background: selectedTrack.muted ? 'var(--muted)' : 'transparent',
              border: '1.5px solid var(--border)',
              borderRadius: 0,
              color: selectedTrack.muted ? '#fff' : 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '4px 8px',
            }}
          >
            {selectedTrack.muted ? 'MUTED' : 'MUTE'}
          </button>
        </div>
      )}

      {/* Piano roll grid */}
      {selectedTrack && (
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <div style={{ display: 'flex', minWidth: 'fit-content' }}>
            {/* Piano keys */}
            <div style={{ width: 60, flexShrink: 0, borderRight: '2px solid var(--ink)' }}>
              {Array.from({ length: noteRange }, (_, i) => {
                const midiNote = PIANO_RANGE.max - i
                const isBlack = [1, 3, 6, 8, 10].includes(midiNote % 12)
                return (
                  <div
                    key={midiNote}
                    style={{
                      height: 20,
                      borderBottom: '1px solid var(--border)',
                      background: isBlack ? '#666' : 'var(--bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      padding: '0 6px',
                    }}
                  >
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: isBlack ? '#ccc' : 'var(--muted)',
                    }}>
                      {noteName(midiNote)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Grid */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {Array.from({ length: noteRange }, (_, i) => {
                const midiNote = PIANO_RANGE.max - i
                const isBlack = [1, 3, 6, 8, 10].includes(midiNote % 12)
                return (
                  <div key={midiNote} style={{ display: 'flex', height: 20, borderBottom: '1px solid var(--border)' }}>
                    {Array.from({ length: totalSteps }, (_, step) => {
                      const isBarStart = step % STEPS_PER_BAR === 0
                      const isBeatStart = step % 4 === 0
                      const hasNote = selectedTrack.notes.some((n) => n.note === midiNote && n.start === step)
                      const isCurrent = step === currentStep && playing
                      
                      return (
                        <button
                          key={step}
                          onClick={() => toggleNote(selectedTrack.id, midiNote, step)}
                          style={{
                            width: 24,
                            height: '100%',
                            border: 'none',
                            borderRight: isBarStart ? '2px solid var(--ink)' : isBeatStart ? '1px solid #ccc' : '1px solid #eee',
                            background: isCurrent 
                              ? 'var(--accent-2)'
                              : hasNote
                              ? 'var(--accent-1)'
                              : isBlack
                              ? '#f5f5f5'
                              : '#fff',
                            cursor: 'pointer',
                            padding: 0,
                            transition: 'background 80ms',
                          }}
                          onMouseEnter={(e) => {
                            if (!hasNote && !isCurrent) e.currentTarget.style.background = '#ddd'
                          }}
                          onMouseLeave={(e) => {
                            if (!hasNote && !isCurrent) e.currentTarget.style.background = isBlack ? '#f5f5f5' : '#fff'
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
