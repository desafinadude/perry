export interface Preset {
  bank: number
  program: number
  name: string
  isDrum: boolean
}

export interface LoadedFont {
  id: string
  name: string
  presets: Preset[]
}

export interface Zone {
  id: string
  name: string
  minNote: number
  maxNote: number
  channel: number
  program: number
  bank: number
  volume: number
  color: string
  fontId: string
}

export interface DrumTrack {
  id: string
  name: string
  note: number      // GM drum MIDI note
  steps: number[]   // 16 steps: 0=off, 1=light, 2=medium, 3=heavy
  velocity: number  // base velocity
  muted: boolean
}

export interface SavedConfig {
  id: string
  name: string
  zones: Zone[]
  createdAt: number
}

export interface SavedBeat {
  id: string
  name: string
  tracks: DrumTrack[]
  bars: number
  createdAt: number
}

export const DEFAULT_DRUM_TRACKS: DrumTrack[] = [
  { id: 'kick',   name: 'KICK',   note: 36, steps: Array(16).fill(0), velocity: 110, muted: false },
  { id: 'snare',  name: 'SNARE',  note: 38, steps: Array(16).fill(0), velocity: 100, muted: false },
  { id: 'rim',    name: 'RIM',    note: 37, steps: Array(16).fill(0), velocity: 80,  muted: false },
  { id: 'chh',    name: 'C.HH',   note: 42, steps: Array(16).fill(0), velocity: 75,  muted: false },
  { id: 'ohh',    name: 'O.HH',   note: 46, steps: Array(16).fill(0), velocity: 75,  muted: false },
  { id: 'lotom',  name: 'LO TOM', note: 41, steps: Array(16).fill(0), velocity: 90,  muted: false },
  { id: 'hitom',  name: 'HI TOM', note: 50, steps: Array(16).fill(0), velocity: 90,  muted: false },
  { id: 'crash',  name: 'CRASH',  note: 49, steps: Array(16).fill(0), velocity: 100, muted: false },
]

// Drum machine preset patterns
export const DRUM_PRESETS = {
  lofi: {
    name: 'LO-FI CHILL',
    tracks: [
      { id: 'kick',   name: 'KICK',   note: 36, steps: [3, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0], velocity: 100, muted: false },
      { id: 'snare',  name: 'SNARE',  note: 38, steps: [0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0], velocity: 90, muted: false },
      { id: 'rim',    name: 'RIM',    note: 37, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 75, muted: false },
      { id: 'chh',    name: 'C.HH',   note: 42, steps: [0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0], velocity: 65, muted: false },
      { id: 'ohh',    name: 'O.HH',   note: 46, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 70, muted: false },
      { id: 'lotom',  name: 'LO TOM', note: 41, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 85, muted: false },
      { id: 'hitom',  name: 'HI TOM', note: 50, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 85, muted: false },
      { id: 'crash',  name: 'CRASH',  note: 49, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 95, muted: false },
    ],
  },
  jazz: {
    name: 'JAZZ SWING',
    tracks: [
      { id: 'kick',   name: 'KICK',   note: 36, steps: [3, 0, 0, 2, 0, 0, 3, 0, 0, 2, 0, 0, 3, 0, 0, 0], velocity: 95, muted: false },
      { id: 'snare',  name: 'SNARE',  note: 38, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 85, muted: false },
      { id: 'rim',    name: 'RIM',    note: 37, steps: [0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 2], velocity: 70, muted: false },
      { id: 'chh',    name: 'C.HH',   note: 42, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 60, muted: false },
      { id: 'ohh',    name: 'O.HH',   note: 46, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 65, muted: false },
      { id: 'lotom',  name: 'LO TOM', note: 41, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 80, muted: false },
      { id: 'hitom',  name: 'HI TOM', note: 50, steps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], velocity: 80, muted: false },
      { id: 'crash',  name: 'CRASH',  note: 51, steps: [2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2], velocity: 75, muted: false },
    ],
  },
}

export const ZONE_COLORS = [
  '#4ade80', '#60a5fa', '#fb923c', '#f472b6',
  '#a78bfa', '#34d399', '#fbbf24', '#f87171',
]

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (midi: number) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1)
export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12)

// Convert note name (like "A0" or "C8") to MIDI number, or return null if invalid
export const noteNameToMidi = (name: string): number | null => {
  const match = name.match(/^([A-G]#?)(-?\d+)$/)
  if (!match) return null
  const [, note, octave] = match
  const noteIndex = NOTE_NAMES.indexOf(note)
  if (noteIndex === -1) return null
  const midi = (parseInt(octave) + 1) * 12 + noteIndex
  return midi >= 0 && midi <= 127 ? midi : null
}

export const PIANO_MIN = 21
export const PIANO_MAX = 108

const STORAGE_KEY = 'perry_configs'
export const getSavedConfigs = (): SavedConfig[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
export const saveConfig = (name: string, zones: Zone[]): SavedConfig[] => {
  const updated = [...getSavedConfigs(), { id: Date.now().toString(), name, zones, createdAt: Date.now() }]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}
export const deleteConfig = (id: string): SavedConfig[] => {
  const updated = getSavedConfigs().filter((c) => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}

const BEATS_STORAGE_KEY = 'perry_beats'
export const getSavedBeats = (): SavedBeat[] => {
  try { return JSON.parse(localStorage.getItem(BEATS_STORAGE_KEY) || '[]') } catch { return [] }
}
export const saveBeat = (name: string, tracks: DrumTrack[], bars: number): SavedBeat[] => {
  const updated = [...getSavedBeats(), { id: Date.now().toString(), name, tracks, bars, createdAt: Date.now() }]
  localStorage.setItem(BEATS_STORAGE_KEY, JSON.stringify(updated))
  return updated
}
export const deleteBeat = (id: string): SavedBeat[] => {
  const updated = getSavedBeats().filter((b) => b.id !== id)
  localStorage.setItem(BEATS_STORAGE_KEY, JSON.stringify(updated))
  return updated
}
