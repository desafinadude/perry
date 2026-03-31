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
  effects?: EffectSettings
}

export interface EffectSettings {
  reverb: number      // 0-127
  chorus: number      // 0-127
  delay: number       // 0-127
  filter: number      // 0-127 (cutoff)
  pan: number         // 0-127 (64 = center)
}

export interface SavedConfig {
  id: string
  name: string
  zones: Zone[]
  createdAt: number
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
