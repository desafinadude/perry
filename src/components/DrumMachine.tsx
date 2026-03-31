import { useState, useEffect, useRef, useCallback } from 'react'
import type { DrumTrack, LoadedFont } from '../types'
import { DEFAULT_DRUM_TRACKS } from '../types'

interface Props {
  fonts: LoadedFont[]
  onNoteOn:  (fontId: string, note: number, velocity: number) => void
  onNoteOff: (fontId: string, note: number) => void
  onApply:   (fontId: string, volume: number) => void
}

const STEPS = 16
const GROUP = 4  // visual grouping

export function DrumMachine({ fonts, onNoteOn, onNoteOff, onApply }: Props) {
  const [tracks, setTracks]       = useState<DrumTrack[]>(DEFAULT_DRUM_TRACKS)
  const [playing, setPlaying]     = useState(false)
  const [bpm, setBpm]             = useState(100)
  const [currentStep, setStep]    = useState(-1)
  const [volume, setVolume]       = useState(100)
  const [fontId, setFontId]       = useState<string>(fonts[0]?.id ?? '')
  const [collapsed, setCollapsed] = useState(false)

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
  const stepRef    = useRef(0)

  const stop = useCallback(() => {
    setPlaying(false)
    setStep(-1)
    stepRef.current = 0
  }, [])

  // Scheduling
  useEffect(() => {
    if (!playing) return
    const ms = (60_000 / bpm) / 4   // 16th note duration

    const tick = () => {
      const s = stepRef.current
      tracksRef.current.forEach((t) => {
        if (!t.muted && t.steps[s]) {
          onNoteOn(fontIdRef.current, t.note, t.velocity)
          setTimeout(() => onNoteOff(fontIdRef.current, t.note), Math.min(ms * 0.8, 120))
        }
      })
      setStep(s)
      stepRef.current = (s + 1) % STEPS
    }

    tick() // fire immediately on first tick
    const id = setInterval(tick, ms)
    return () => clearInterval(id)
  }, [playing, bpm, onNoteOn, onNoteOff])

  const toggleStep = (trackId: string, step: number) => {
    setTracks((prev) =>
      prev.map((t) => t.id === trackId
        ? { ...t, steps: t.steps.map((v, i) => i === step ? !v : v) }
        : t,
      ),
    )
  }

  const toggleMute = (trackId: string) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, muted: !t.muted } : t))
  }

  const clearTrack = (trackId: string) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, steps: Array(STEPS).fill(false) } : t))
  }

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

          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--border)', padding: '0 16px', alignSelf: 'stretch' }}>
            <span style={lbl}>VOL</span>
            <input type="range" min={0} max={127} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{ width: 72 }}
            />
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 22 }}>{volume}</span>
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
                {track.steps.map((on, i) => {
                  const isCurrent = i === currentStep && playing
                  const isGroupStart = i > 0 && i % GROUP === 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                      {isGroupStart && (
                        <div style={{ width: 6, flexShrink: 0 }} />
                      )}
                      <button
                        onClick={() => toggleStep(track.id, i)}
                        style={{
                          width: 28, height: 28,
                          border: `1.5px solid ${on ? 'var(--ink)' : 'var(--border)'}`,
                          borderRadius: 0,
                          background: isCurrent
                            ? (on ? 'var(--accent-1)' : '#dbd8d0')
                            : on
                            ? 'var(--ink)'
                            : 'var(--bg)',
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
