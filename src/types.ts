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

/** Sound source engine used by a zone. */
export type ZoneEngine = 'soundfont' | 'synth' | 'sampler'

export interface Zone {
  id: string
  name: string
  minNote: number
  maxNote: number
  channel: number
  program: number
  bank: number
  /** True when the selected preset is a drum kit (the channel is switched to drum mode). */
  drums?: boolean
  volume: number
  color: string
  fontId: string
  /** Name of the SoundFont file, recorded when a config is saved so it can be found again. */
  fontName?: string
  /** Which layer this zone belongs to.
   *  'input'    – responds to live MIDI/keyboard only (silent during sheet playback)
   *  'playback' – sounds during sheet playback only (silent for live MIDI)
   *  'both'     – responds to both (default)
   */
  layer?: 'input' | 'playback' | 'both'
  /** Which engine plays this zone. Defaults to 'soundfont'. */
  engine?: ZoneEngine
  /** Legacy per-zone insert effects; migrated to `mix` (see mixer/model.ts). */
  effects?: EffectSettings
  /** Mixer strip settings: fader, pan, EQ, filter, sends. */
  mix?: import('./mixer/model').ChannelMix
  /** Subtractive synth patch (used when engine === 'synth'). */
  synth?: SynthSettings
  /** Sampler mapping (used when engine === 'sampler'). */
  sampler?: SamplerSettings
  /** Chosen icon. Unset → guessed from the name; { id: 'none' } → no icon. */
  icon?: ZoneIcon
}

/**
 * A zone's icon: one of Perry's built-ins (`id` only), or an imported SVG
 * (e.g. from the Noun Project) carried inline so it travels with configs.
 */
export interface ZoneIcon {
  id: string
  /** Sanitised SVG markup, for imported icons. */
  svg?: string
  name?: string
  /** Attribution, e.g. "Jane Doe · Noun Project". */
  credit?: string
}

/**
 * Per-channel insert effects chain.
 * All values in natural units (Hz, seconds, ratios) — not MIDI 0-127.
 */
export interface EffectSettings {
  filterOn: boolean
  filterType: 'lowpass' | 'highpass' | 'bandpass'
  cutoff: number        // Hz, 20..18000
  resonance: number     // Q, 0.5..18
  chorusOn: boolean
  chorusRate: number    // Hz, 0.05..6
  chorusDepth: number   // 0..1
  chorusMix: number     // 0..1
  delayOn: boolean
  delayTime: number     // seconds, 0..1.5
  delayFeedback: number // 0..0.9
  delayMix: number      // 0..1
  reverbOn: boolean
  reverbSize: number    // 0..1 (decay length)
  reverbMix: number     // 0..1
  pan: number           // -1..1 (0 = center)
}

/** Oscillator shape for the built-in synth. */
export type SynthWave = 'sine' | 'square' | 'sawtooth' | 'triangle'

export interface SynthOsc {
  wave: SynthWave
  octave: number    // -2..+2
  detune: number    // cents, -100..+100
  level: number     // 0..1
}

/** Built-in subtractive synth patch. */
export interface SynthSettings {
  osc1: SynthOsc
  osc2: SynthOsc
  noise: number              // 0..1
  filterType: 'lowpass' | 'highpass' | 'bandpass'
  cutoff: number             // Hz, 20..18000 (log slider)
  resonance: number          // Q, 0.5..18
  filterEnv: number          // envelope amount in octaves, 0..4
  filterDecay: number        // seconds, 0.01..2
  ampAttack: number          // seconds, 0.001..3
  ampDecay: number           // seconds, 0.001..3
  ampSustain: number         // 0..1
  ampRelease: number         // seconds, 0.01..5
  lfoRate: number            // Hz, 0.05..12 (vibrato)
  lfoDepth: number           // cents, 0..100
}

/** Sample mapping for the sampler engine. */
export interface SamplerSettings {
  fileName: string
  rootNote: number      // MIDI note the sample is recorded at
  loop: boolean
  loopStart: number     // seconds
  loopEnd: number       // seconds
  oneShot: boolean      // drums: noteOff ignored, plays to end
  ampAttack: number     // seconds
  ampDecay: number      // seconds
  ampSustain: number    // 0..1
  ampRelease: number    // seconds
}

export const DEFAULT_EFFECTS: EffectSettings = {
  filterOn: false, filterType: 'lowpass', cutoff: 18000, resonance: 0.7,
  chorusOn: false, chorusRate: 0.8, chorusDepth: 0.4, chorusMix: 0.3,
  delayOn: false, delayTime: 0.28, delayFeedback: 0.35, delayMix: 0.25,
  reverbOn: false, reverbSize: 0.5, reverbMix: 0.25,
  pan: 0,
}

export const DEFAULT_SYNTH: SynthSettings = {
  osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.8 },
  osc2: { wave: 'sawtooth', octave: 0, detune: -8, level: 0.6 },
  noise: 0,
  filterType: 'lowpass', cutoff: 3000, resonance: 1.2,
  filterEnv: 2.2, filterDecay: 0.35,
  ampAttack: 0.01, ampDecay: 0.25, ampSustain: 0.7, ampRelease: 0.35,
  lfoRate: 5.2, lfoDepth: 0,
}

export const DEFAULT_SAMPLER: SamplerSettings = {
  fileName: '', rootNote: 60,
  loop: false, loopStart: 0, loopEnd: 0, oneShot: false,
  ampAttack: 0.005, ampDecay: 0.1, ampSustain: 1, ampRelease: 0.15,
}

/** Deep-clone defaults so edits never mutate the shared constants. */
export const defaultEffects = (): EffectSettings => ({ ...DEFAULT_EFFECTS })
export const defaultSynth = (): SynthSettings => ({
  ...DEFAULT_SYNTH,
  osc1: { ...DEFAULT_SYNTH.osc1 },
  osc2: { ...DEFAULT_SYNTH.osc2 },
})
export const defaultSampler = (): SamplerSettings => ({ ...DEFAULT_SAMPLER })

export interface SavedConfig {
  id: string
  name: string
  zones: Zone[]
  createdAt: number
  /** Buses, master and JAM-band strips at the time of saving. */
  mixer?: import('./mixer/model').MixerSettings
}

export const ZONE_COLORS = [
  '#4ade80', '#60a5fa', '#fb923c', '#f472b6',
  '#a78bfa', '#34d399', '#fbbf24', '#f87171',
]

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (midi: number) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1)
/** Key that identifies a preset in a list: drum kits share bank/program numbers with melodic presets. */
export const presetKey = (p: { bank: number; program: number; isDrum?: boolean; drums?: boolean }) =>
  `${p.isDrum || p.drums ? 'd' : 'm'}:${p.bank}:${p.program}`

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

// Melodic editor types (used by PianoRoll)
export interface MelodicNote {
  note: number
  start: number
  length: number
  velocity: number
}

export interface MelodicTrack {
  id: string
  name?: string
  notes: MelodicNote[]
  fontId: string
  bank: number
  program: number
  muted?: boolean
}

export const PIANO_MIN = 21
export const PIANO_MAX = 108

const STORAGE_KEY = 'perry_configs'
export const getSavedConfigs = (): SavedConfig[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
export const saveConfig = (name: string, zones: Zone[], mixer?: SavedConfig['mixer']): SavedConfig[] => {
  const updated = [...getSavedConfigs(), { id: Date.now().toString(), name, zones, createdAt: Date.now(), ...(mixer ? { mixer } : {}) }]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}
export const deleteConfig = (id: string): SavedConfig[] => {
  const updated = getSavedConfigs().filter((c) => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}
