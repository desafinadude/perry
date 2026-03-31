import { useState, useCallback, useEffect } from 'react'
import { DrumMachine } from './DrumMachine'
import { PianoRoll } from './PianoRoll'
import type { LoadedFont, DrumTrack, MelodicTrack, Preset, SequencerState, SavedProject } from '../types'
import { DEFAULT_DRUM_TRACKS, getSavedProjects, saveProject, deleteProject } from '../types'

interface Props {
  fonts: LoadedFont[]
  presetsByFont: Record<string, Preset[]>
  onNoteOn: (fontId: string, note: number, velocity: number) => void
  onNoteOff: (fontId: string, note: number) => void
  onApplyDrums: (fontId: string, volume: number) => void
  onApplyMelodic: (track: MelodicTrack) => void
  onMelodicNoteOn: (track: MelodicTrack, note: number, velocity: number) => void
  onMelodicNoteOff: (track: MelodicTrack, note: number) => void
  // Playback state from parent
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  bpm: number
  swing: number
  bars: number
}

type TabType = 'drums' | string // 'drums' or melodic track ID

let trackIdCounter = 1

export function Sequencer({ fonts, presetsByFont, onNoteOn, onNoteOff, onApplyDrums, onApplyMelodic, onMelodicNoteOn, onMelodicNoteOff, playing, onPlayingChange, bpm, swing, bars }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('drums')
  const [melodic, setMelodic] = useState<MelodicTrack[]>([])
  
  // Update selected tab if the active melodic track is removed
  useEffect(() => {
    if (activeTab !== 'drums' && !melodic.find(t => t.id === activeTab)) {
      setActiveTab('drums')
    }
  }, [melodic, activeTab])

  const handleAddMelodicTrack = useCallback(() => {
    const fontId = fonts[0]?.id ?? 'main'
    const presets = presetsByFont[fontId] ?? []
    const first = presets.find((p) => !p.isDrum) ?? presets[0]
    
    const newTrack: MelodicTrack = {
      id: `melodic_${trackIdCounter++}`,
      name: `Track ${melodic.length + 1}`,
      notes: [],
      muted: false,
      fontId,
      channel: melodic.length % 16,
      program: first?.program ?? 0,
      bank: first?.bank ?? 0,
      volume: 100,
    }
    setMelodic([...melodic, newTrack])
    // Apply immediately
    onApplyMelodic(newTrack)
    // Switch to new track
    setActiveTab(newTrack.id)
  }, [melodic, fonts, presetsByFont, onApplyMelodic])

  const handleRemoveMelodicTrack = useCallback((id: string) => {
    setMelodic((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleMelodicChange = useCallback((updatedTrack: MelodicTrack) => {
    setMelodic((prev) => prev.map((t) => t.id === updatedTrack.id ? updatedTrack : t))
    // Apply track changes
    onApplyMelodic(updatedTrack)
  }, [onApplyMelodic])

  const handleTabChange = useCallback((tab: TabType) => {
    // Don't stop playback when switching tabs
    setActiveTab(tab)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--surface)',
      }}>
        {/* DRUMS tab */}
        <button
          onClick={() => handleTabChange('drums')}
          style={{
            background: activeTab === 'drums' ? 'var(--ink)' : 'transparent',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: activeTab === 'drums' ? 'var(--bg)' : 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          DRUMS
        </button>
        
        {/* Melodic track tabs */}
        {melodic.map((track) => (
          <div key={track.id} style={{ display: 'flex', alignItems: 'stretch' }}>
            <button
              onClick={() => handleTabChange(track.id)}
              style={{
                background: activeTab === track.id ? 'var(--ink)' : 'transparent',
                border: 'none',
                borderRight: '1px solid var(--border)',
                color: activeTab === track.id ? 'var(--bg)' : 'var(--ink)',
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                letterSpacing: '0.1em',
                padding: '8px 16px',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {track.name}
            </button>
            {/* Remove button */}
            <button
              onClick={() => handleRemoveMelodicTrack(track.id)}
              style={{
                background: activeTab === track.id ? 'var(--ink)' : 'transparent',
                border: 'none',
                borderRight: '1px solid var(--border)',
                color: activeTab === track.id ? 'var(--bg)' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: 14,
                padding: '0 8px',
              }}
            >
              ×
            </button>
          </div>
        ))}
        
        {/* Add new track button */}
        <button
          onClick={handleAddMelodicTrack}
          style={{
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 18,
            padding: '8px 16px',
          }}
        >
          +
        </button>
      </div>

      {/* Content - keep all mounted to preserve state */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* DRUMS */}
        <div style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: activeTab === 'drums' ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
          <DrumMachine
            fonts={fonts}
            onNoteOn={onNoteOn}
            onNoteOff={onNoteOff}
            onApply={onApplyDrums}
            playing={playing}
            onPlayingChange={onPlayingChange}
            bpm={bpm}
            swing={swing}
            bars={bars}
          />
        </div>
        
        {/* Each melodic track */}
        {melodic.map((track) => (
          <div key={track.id} style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: activeTab === track.id ? 'flex' : 'none',
            flexDirection: 'column',
          }}>
            <PianoRoll
              tracks={[track]}
              bars={bars}
              fonts={fonts}
              presetsByFont={presetsByFont}
              onTracksChange={(tracks) => tracks[0] && handleMelodicChange(tracks[0])}
              onAddTrack={handleAddMelodicTrack}
              onRemoveTrack={handleRemoveMelodicTrack}
              playing={playing}
              onPlayingChange={onPlayingChange}
              bpm={bpm}
              swing={swing}
              onMelodicNoteOn={onMelodicNoteOn}
              onMelodicNoteOff={onMelodicNoteOff}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
