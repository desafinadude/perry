import { useState, useCallback } from 'react'
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
  // Playback state from parent
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  bpm: number
  swing: number
  bars: number
}

type TabType = 'drums' | 'melodic'

let trackIdCounter = 1

export function Sequencer({ fonts, presetsByFont, onNoteOn, onNoteOff, onApplyDrums, onApplyMelodic, playing, onPlayingChange, bpm, swing, bars }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('drums')
  const [melodic, setMelodic] = useState<MelodicTrack[]>([])

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
  }, [melodic, fonts, presetsByFont, onApplyMelodic])

  const handleRemoveMelodicTrack = useCallback((id: string) => {
    setMelodic((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleMelodicChange = useCallback((tracks: MelodicTrack[]) => {
    setMelodic(tracks)
    // Apply track changes
    tracks.forEach((t) => onApplyMelodic(t))
  }, [onApplyMelodic])

  const handleTabChange = useCallback((tab: TabType) => {
    // Stop playback when switching tabs
    if (playing) {
      onPlayingChange(false)
    }
    setActiveTab(tab)
  }, [playing, onPlayingChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--surface)',
      }}>
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
        
        <button
          onClick={() => handleTabChange('melodic')}
          style={{
            background: activeTab === 'melodic' ? 'var(--ink)' : 'transparent',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: activeTab === 'melodic' ? 'var(--bg)' : 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          MELODIC {melodic.length > 0 && `(${melodic.length})`}
        </button>
      </div>

      {/* Content - keep both mounted to preserve state */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
        
        <div style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: activeTab === 'melodic' ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
          <PianoRoll
            tracks={melodic}
            bars={bars}
            fonts={fonts}
            presetsByFont={presetsByFont}
            onTracksChange={handleMelodicChange}
            onAddTrack={handleAddMelodicTrack}
            onRemoveTrack={handleRemoveMelodicTrack}
            playing={playing}
            onPlayingChange={onPlayingChange}
            bpm={bpm}
            swing={swing}
            onNoteOn={onNoteOn}
            onNoteOff={onNoteOff}
          />
        </div>
      </div>
    </div>
  )
}
