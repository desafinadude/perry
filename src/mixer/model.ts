/*
 * Mixer settings: per-channel strips, three shared FX buses (send / return),
 * and the master. Zones carry their own strip settings (`zone.mix`), so they
 * are saved with zone configs; buses, master and the JAM band's built-in
 * parts live in the global MixerSettings (also saved with configs).
 */
import type { EffectSettings, Zone } from '../types'

export type FilterType = 'lowpass' | 'highpass' | 'bandpass'

export interface ChannelMix {
  /** Fader in dB (−Infinity … +6). */
  level: number
  /** −1 … 1 */
  pan: number
  mute: boolean
  solo: boolean
  /** Shelf / peak gains in dB (−12 … +12). */
  eqLow: number
  eqMid: number
  eqHigh: number
  filterOn: boolean
  filterType: FilterType
  cutoff: number
  resonance: number
  /** Post-fader send amounts 0 … 1. */
  sendRev: number
  sendDly: number
  sendCho: number
}

export const defaultMix = (): ChannelMix => ({
  level: 0, pan: 0, mute: false, solo: false,
  eqLow: 0, eqMid: 0, eqHigh: 0,
  filterOn: false, filterType: 'lowpass', cutoff: 18000, resonance: 0.7,
  sendRev: 0, sendDly: 0, sendCho: 0,
})

export type DelaySync = '1/2' | '1/4.' | '1/4' | '1/8.' | '1/8' | '1/8T' | '1/16'
export const DELAY_SYNCS: DelaySync[] = ['1/2', '1/4.', '1/4', '1/8.', '1/8', '1/8T', '1/16']
const SYNC_BEATS: Record<DelaySync, number> = { '1/2': 2, '1/4.': 1.5, '1/4': 1, '1/8.': 0.75, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25 }
export const syncSeconds = (s: DelaySync, bpm: number) => (SYNC_BEATS[s] * 60) / Math.max(30, bpm)

export interface BusReturn {
  /** Return fader in dB. */
  level: number
  mute: boolean
}

export interface MixerSettings {
  reverb: BusReturn & { size: number; decay: number; predelay: number; tone: number }
  delay: BusReturn & { time: number; sync: DelaySync | null; feedback: number; tone: number; width: number }
  chorus: BusReturn & { rate: number; depth: number }
  master: { level: number }
  /** Strips for the JAM band's built-in sounds and the click. */
  jam: Record<JamStrip, ChannelMix>
}

export type JamStrip = 'drums' | 'bass' | 'keys' | 'click'
export const JAM_STRIPS: JamStrip[] = ['drums', 'bass', 'keys', 'click']

export const defaultMixer = (): MixerSettings => ({
  reverb: { level: 0, mute: false, size: 0.55, decay: 0.5, predelay: 0.02, tone: 6000 },
  delay: { level: -3, mute: false, time: 0.32, sync: '1/8.', feedback: 0.35, tone: 3500, width: 0.6 },
  chorus: { level: 0, mute: false, rate: 0.8, depth: 0.4 },
  master: { level: 0 },
  jam: {
    drums: { ...defaultMix(), sendRev: 0.15 },
    bass: { ...defaultMix() },
    keys: { ...defaultMix(), sendRev: 0.25 },
    click: { ...defaultMix(), level: -6 },
  },
})

/** Fill in anything missing from stored settings (older saves). */
export function normaliseMixer(m: Partial<MixerSettings> | null | undefined): MixerSettings {
  const d = defaultMixer()
  if (!m) return d
  return {
    reverb: { ...d.reverb, ...m.reverb },
    delay: { ...d.delay, ...m.delay },
    chorus: { ...d.chorus, ...m.chorus },
    master: { ...d.master, ...m.master },
    jam: Object.fromEntries(JAM_STRIPS.map((k) => [k, { ...d.jam[k], ...(m.jam?.[k] ?? {}) }])) as Record<JamStrip, ChannelMix>,
  }
}

/** Old per-zone insert effects → strip settings (mix amounts become sends). */
export function mixFromEffects(fx: EffectSettings): ChannelMix {
  return {
    ...defaultMix(),
    pan: fx.pan,
    filterOn: fx.filterOn, filterType: fx.filterType, cutoff: fx.cutoff, resonance: fx.resonance,
    sendRev: fx.reverbOn ? fx.reverbMix : 0,
    sendDly: fx.delayOn ? fx.delayMix : 0,
    sendCho: fx.chorusOn ? fx.chorusMix : 0,
  }
}

/** A zone's strip settings, migrating old `effects` if needed. */
export function mixOf(zone: Zone): ChannelMix {
  if (zone.mix) return { ...defaultMix(), ...zone.mix }
  if (zone.effects) return mixFromEffects(zone.effects)
  // SoundFont channels used to get the synth's built-in GM reverb; keep a
  // similar amount via the shared bus until the user sets their own
  if ((zone.engine ?? 'soundfont') === 'soundfont') return { ...defaultMix(), sendRev: 0.25 }
  return defaultMix()
}

// ── fader law ───────────────────────────────────────────────────────────────
// position 0 … 1 (top = 1). Unity gain sits at 0.75, +6 dB at the top.
export const UNITY_POS = 0.75
export function posToDb(pos: number): number {
  if (pos <= 0.001) return -Infinity
  if (pos >= UNITY_POS) return ((pos - UNITY_POS) / (1 - UNITY_POS)) * 6
  return 40 * Math.log10(pos / UNITY_POS)
}
export function dbToPos(db: number): number {
  if (!Number.isFinite(db) || db <= -100) return 0
  if (db >= 0) return Math.min(1, UNITY_POS + (db / 6) * (1 - UNITY_POS))
  return Math.max(0, UNITY_POS * Math.pow(10, db / 40))
}
export const dbToGain = (db: number) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0)
export const fmtDb = (db: number) => (!Number.isFinite(db) || db <= -100 ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`)
