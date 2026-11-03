import type { SynthSettings, SynthWave } from '../types'

/*
 * Offline "what will this patch sound like" maths for the synth scope.
 * Uses the same biquad formulas as the Web Audio spec so the preview curve
 * matches what BiquadFilterNode actually does.
 */

export const PREVIEW_RATE = 44100
/** Reference pitch for previews: C4. */
export const PREVIEW_FREQ = 261.63

type FilterType = SynthSettings['filterType']

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Web Audio BiquadFilterNode coefficients (normalised by a0). */
export function biquad(type: FilterType, freq: number, q: number, fs = PREVIEW_RATE): Biquad {
  const w0 = (2 * Math.PI * Math.min(freq, fs / 2 - 1)) / fs
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (type === 'bandpass') {
    const alpha = sin / (2 * Math.max(q, 0.0001))
    b0 = alpha; b1 = 0; b2 = -alpha
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  } else {
    // lowpass / highpass: Web Audio treats Q in dB for these types
    const alpha = sin / (2 * Math.pow(10, q / 20))
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2
    } else {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Linear magnitude of a biquad at frequency f. */
export function magnitude(c: Biquad, f: number, fs = PREVIEW_RATE): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2
  const ni = -(c.b1 * s1 + c.b2 * s2)
  const dr = 1 + c.a1 * c1 + c.a2 * c2
  const di = -(c.a1 * s1 + c.a2 * s2)
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
}

function waveAt(wave: SynthWave, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p)
    case 'square': return p < 0.5 ? 1 : -1
    case 'sawtooth': return 2 * p - 1
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5)
  }
}

// deterministic noise so the preview doesn't flicker on every render
function noiseAt(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

export interface PreviewWave {
  /** OSC1 + OSC2 + noise, before the filter. */
  mix: Float32Array
  /** The same signal after the filter (at its resting cutoff). */
  filtered: Float32Array
}

/**
 * Render `cycles` periods of the reference note through the patch.
 * Runs the filter over a warm-up first so the shown slice is steady-state.
 */
export function renderPreview(s: SynthSettings, cycles = 3): PreviewWave {
  const period = PREVIEW_RATE / PREVIEW_FREQ
  const show = Math.round(period * cycles)
  const warm = Math.round(period * 12)
  const total = warm + show
  const f1 = Math.pow(2, s.osc1.octave) * Math.pow(2, s.osc1.detune / 1200)
  const f2 = Math.pow(2, s.osc2.octave) * Math.pow(2, s.osc2.detune / 1200)
  const c = biquad(s.filterType, Math.max(20, Math.min(18000, s.cutoff)), s.resonance)
  const mix = new Float32Array(show)
  const filtered = new Float32Array(show)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < total; i++) {
    const ph = i / period
    const x = 0.5 * (s.osc1.level * waveAt(s.osc1.wave, ph * f1) + s.osc2.level * waveAt(s.osc2.wave, ph * f2))
      + 0.5 * s.noise * noiseAt(i)
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    if (i >= warm) {
      mix[i - warm] = x
      filtered[i - warm] = y
    }
  }
  return { mix, filtered }
}

export interface Partial { freq: number; amp: number }

/** Harmonic series of one oscillator (amplitudes relative to the fundamental). */
function partials(wave: SynthWave, f0: number, level: number, maxFreq = 20000): Partial[] {
  const out: Partial[] = []
  for (let n = 1; n * f0 < maxFreq && n <= 200; n++) {
    let a = 0
    if (wave === 'sine') a = n === 1 ? 1 : 0
    else if (wave === 'sawtooth') a = 1 / n
    else if (wave === 'square') a = n % 2 ? 1 / n : 0
    else a = n % 2 ? 1 / (n * n) : 0
    if (a > 0) out.push({ freq: n * f0, amp: a * level * 0.5 })
  }
  return out
}

/** Partials of both oscillators at the reference pitch. */
export function patchPartials(s: SynthSettings): Partial[] {
  const f1 = PREVIEW_FREQ * Math.pow(2, s.osc1.octave) * Math.pow(2, s.osc1.detune / 1200)
  const f2 = PREVIEW_FREQ * Math.pow(2, s.osc2.octave) * Math.pow(2, s.osc2.detune / 1200)
  return [...partials(s.osc1.wave, f1, s.osc1.level), ...partials(s.osc2.wave, f2, s.osc2.level)]
}
