// Jazz Scale Syllabus data
// Source: Learn Jazz Standards — "16 Jazz Scales You Need To Know"
// https://www.learnjazzstandards.com/blog/16-important-jazz-scales/

export type ScaleCategory =
  | 'major_modes'
  | 'diminished'
  | 'other'
  | 'bebop'

export const CATEGORY_LABELS: Record<ScaleCategory, string> = {
  major_modes: 'Modes of the Major Scale',
  diminished:  'Diminished Scales',
  other:       'Other Essential Scales',
  bebop:       'Bebop Scales',
}

export const CATEGORIES: ScaleCategory[] = [
  'major_modes', 'diminished', 'other', 'bebop',
]

export interface ScaleEntry {
  id: string
  name: string
  symbol: string           // chord symbol in C
  category: ScaleCategory
  intervals: number[]      // semitones from root (not including octave)
  wh: string               // W&H construction
  formula: string          // degree formula e.g. "1 2 3 4 5 6 7"
  scaleInC: string         // scale spelled out from C
  chordInC: string         // typical chord tones in C
  chordIntervals: number[] // semitones from root
  chordUsage: string       // what chord/context this scale is used over
  altSymbols: string[]     // alternate scale names
  tension: number          // 1=mild … 5=tense
}

export const SCALES: ScaleEntry[] = [

  // ── MODES OF THE MAJOR SCALE ──────────────────────────────────────────────

  {
    id: 'ionian',
    name: 'Ionian (Major)',
    symbol: 'C∆7',
    category: 'major_modes',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    wh: 'W W H W W W H',
    formula: '1 2 3 4 5 6 7',
    scaleInC: 'C D E F G A B C',
    chordInC: 'C E G B',
    chordIntervals: [0, 4, 7, 11],
    chordUsage: 'I∆7 — tonic major chord',
    altSymbols: ['Major Scale', 'Cmaj7', 'CM7'],
    tension: 1,
  },
  {
    id: 'dorian',
    name: 'Dorian Minor',
    symbol: 'Cmi7',
    category: 'major_modes',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    wh: 'W H W W W H W',
    formula: '1 2 ♭3 4 5 6 ♭7',
    scaleInC: 'C D E♭ F G A B♭ C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: 'ii−7 or i−7 — most common minor scale in jazz',
    altSymbols: ['Dorian Mode', 'Cmin7'],
    tension: 1,
  },
  {
    id: 'phrygian',
    name: 'Phrygian Minor',
    symbol: 'Cmi7',
    category: 'major_modes',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    wh: 'H W W W H W W',
    formula: '1 ♭2 ♭3 4 5 ♭6 ♭7',
    scaleInC: 'C D♭ E♭ F G A♭ B♭ C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: 'iii−7 or V7(♭9)sus',
    altSymbols: ['Phrygian Mode'],
    tension: 3,
  },
  {
    id: 'lydian',
    name: 'Lydian',
    symbol: 'C∆7♯11',
    category: 'major_modes',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    wh: 'W W W H W W H',
    formula: '1 2 3 ♯4 5 6 7',
    scaleInC: 'C D E F♯ G A B C',
    chordInC: 'C E G B',
    chordIntervals: [0, 4, 7, 11],
    chordUsage: 'IV∆7 or I∆7♯11 — brightest major mode',
    altSymbols: ['Lydian Mode', 'Cmaj7♯11', 'Cmaj7♭5'],
    tension: 2,
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian (Dominant)',
    symbol: 'C7',
    category: 'major_modes',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    wh: 'W W H W W H W',
    formula: '1 2 3 4 5 6 ♭7',
    scaleInC: 'C D E F G A B♭ C',
    chordInC: 'C E G B♭',
    chordIntervals: [0, 4, 7, 10],
    chordUsage: 'V7 — basic dominant scale',
    altSymbols: ['Dominant Scale', 'Mixolydian Mode'],
    tension: 2,
  },
  {
    id: 'aeolian',
    name: 'Aeolian (Natural Minor)',
    symbol: 'Cmi7',
    category: 'major_modes',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    wh: 'W H W W H W W',
    formula: '1 2 ♭3 4 5 ♭6 ♭7',
    scaleInC: 'C D E♭ F G A♭ B♭ C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: 'vi−7 or i−7 — tonic minor scale',
    altSymbols: ['Natural Minor', 'Aeolian Mode'],
    tension: 2,
  },
  {
    id: 'locrian',
    name: 'Locrian (Half-Diminished)',
    symbol: 'CØ7',
    category: 'major_modes',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    wh: 'H W W H W W W',
    formula: '1 ♭2 ♭3 4 ♭5 ♭6 ♭7',
    scaleInC: 'C D♭ E♭ F G♭ A♭ B♭ C',
    chordInC: 'C E♭ G♭ B♭',
    chordIntervals: [0, 3, 6, 10],
    chordUsage: 'iiØ7 — half-diminished (min7♭5) chord',
    altSymbols: ['Locrian Mode', 'Cmin7♭5', 'Cm7♭5'],
    tension: 4,
  },

  // ── DIMINISHED SCALES ─────────────────────────────────────────────────────

  {
    id: 'half_whole_dim',
    name: 'Half-Whole Diminished',
    symbol: 'C7♭9',
    category: 'diminished',
    intervals: [0, 1, 3, 4, 6, 7, 9, 10],
    wh: 'H W H W H W H W',
    formula: '1 ♭2 ♭3 3 ♯4 5 6 ♭7',
    scaleInC: 'C D♭ E♭ E F♯ G A B♭ C',
    chordInC: 'C E G B♭',
    chordIntervals: [0, 4, 7, 10],
    chordUsage: 'V7♭9 / V13♭9 — dominant diminished',
    altSymbols: ['Dominant Diminished', 'HW Diminished'],
    tension: 4,
  },
  {
    id: 'whole_half_dim',
    name: 'Whole-Half Diminished',
    symbol: 'C°7',
    category: 'diminished',
    intervals: [0, 2, 3, 5, 6, 8, 9, 11],
    wh: 'W H W H W H W H',
    formula: '1 2 ♭3 4 ♯4 ♯5 6 7',
    scaleInC: 'C D E♭ F G♭ A♭ A B C',
    chordInC: 'C E♭ G♭ A',
    chordIntervals: [0, 3, 6, 9],
    chordUsage: 'C°7 — diminished seventh chord',
    altSymbols: ['WH Diminished', 'Diminished Scale'],
    tension: 4,
  },

  // ── OTHER ESSENTIAL SCALES ────────────────────────────────────────────────

  {
    id: 'altered',
    name: 'Altered Scale',
    symbol: 'C7alt',
    category: 'other',
    intervals: [0, 1, 3, 4, 6, 8, 10],
    wh: 'H W H W W W W',
    formula: '1 ♭2 ♭3 3 ♯4 ♭6 ♭7',
    scaleInC: 'C D♭ E♭ E G♭ A♭ B♭ C',
    chordInC: 'C E G♭ B♭',
    chordIntervals: [0, 4, 6, 10],
    chordUsage: 'V7alt / V7(♯9♭13) — altered dominant',
    altSymbols: ['Super Locrian', 'Diminished Whole-Tone', '7th mode of Melodic Minor'],
    tension: 5,
  },
  {
    id: 'whole_tone',
    name: 'Whole-Tone Scale',
    symbol: 'C7♭13',
    category: 'other',
    intervals: [0, 2, 4, 6, 8, 10],
    wh: 'W W W W W W',
    formula: '1 2 3 ♯4 ♭6 ♭7',
    scaleInC: 'C D E F♯ A♭ B♭ C',
    chordInC: 'C E G B♭',
    chordIntervals: [0, 4, 7, 10],
    chordUsage: 'V7♭13 (with natural 9, not ♭9/♯9)',
    altSymbols: ['Whole Tone'],
    tension: 4,
  },
  {
    id: 'minor_pentatonic',
    name: 'Minor Pentatonic',
    symbol: 'Cmi7',
    category: 'other',
    intervals: [0, 3, 5, 7, 10],
    wh: '−3 W W −3 W',
    formula: '1 ♭3 4 5 ♭7',
    scaleInC: 'C E♭ F G B♭ C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: 'Minor chords / blues',
    altSymbols: ['Minor Pentatonic'],
    tension: 1,
  },
  {
    id: 'blues',
    name: 'Blues Scale',
    symbol: 'Cmi7',
    category: 'other',
    intervals: [0, 3, 5, 6, 7, 10],
    wh: '−3 W H H −3 W',
    formula: '1 ♭3 4 ♭5 5 ♭7',
    scaleInC: 'C E♭ F G♭ G B♭ C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: 'Blues / minor chords — minor pentatonic + ♯4',
    altSymbols: ['Blues Scale', 'Minor Blues'],
    tension: 2,
  },
  {
    id: 'lydian_dominant',
    name: 'Lydian Dominant',
    symbol: 'C7♯11',
    category: 'other',
    intervals: [0, 2, 4, 6, 7, 9, 10],
    wh: 'W W W H W H W',
    formula: '1 2 3 ♯4 5 6 ♭7',
    scaleInC: 'C D E F♯ G A B♭ C',
    chordInC: 'C E G B♭',
    chordIntervals: [0, 4, 7, 10],
    chordUsage: 'V7♯11 / IV7 / ♭II7 tritone sub',
    altSymbols: ['Lydian ♭7', '4th mode of Melodic Minor', 'Overtone Scale'],
    tension: 3,
  },

  // ── BEBOP SCALES ──────────────────────────────────────────────────────────

  {
    id: 'bebop_major',
    name: 'Major Bebop',
    symbol: 'C∆7',
    category: 'bebop',
    // ascending: 1 2 3 4 5 ♭6 6 7  (chromatic pass between 5 and 6)
    intervals: [0, 2, 4, 5, 7, 8, 9, 11],
    wh: 'W W H W H H H H',
    formula: '1 2 3 4 5 ♭6 6 7',
    scaleInC: 'C D E F G A♭ A B C',
    chordInC: 'C E G B',
    chordIntervals: [0, 4, 7, 11],
    chordUsage: '∆7 chords — chromatic pass between 6 and 5',
    altSymbols: ['Major Bebop Scale'],
    tension: 2,
  },
  {
    id: 'bebop_minor',
    name: 'Minor Bebop',
    symbol: 'Cmi7',
    category: 'bebop',
    // ascending: 1 2 ♭3 4 5 6 ♭7 7  (chromatic pass between ♭7 and 8)
    intervals: [0, 2, 3, 5, 7, 9, 10, 11],
    wh: 'W H W W W H H H',
    formula: '1 2 ♭3 4 5 6 ♭7 7',
    scaleInC: 'C D E♭ F G A B♭ B C',
    chordInC: 'C E♭ G B♭',
    chordIntervals: [0, 3, 7, 10],
    chordUsage: '−7 chords — chromatic pass between 8 and ♭7',
    altSymbols: ['Minor Bebop Scale', 'Dorian Bebop'],
    tension: 2,
  },
  {
    id: 'bebop_dominant',
    name: 'Dominant Bebop',
    symbol: 'C7',
    category: 'bebop',
    // ascending: 1 2 3 4 5 6 ♭7 7  (chromatic pass between ♭7 and 8)
    intervals: [0, 2, 4, 5, 7, 9, 10, 11],
    wh: 'W W H W W H H H',
    formula: '1 2 3 4 5 6 ♭7 7',
    scaleInC: 'C D E F G A B♭ B C',
    chordInC: 'C E G B♭',
    chordIntervals: [0, 4, 7, 10],
    chordUsage: 'V7 unaltered — quintessential bebop scale',
    altSymbols: ['Dominant Bebop Scale', 'Mixolydian Bebop'],
    tension: 2,
  },
]

// Root note names (flat preference, as used in jazz)
export const ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

// Pitch class index → root MIDI (C4 = 60 area, octave 4)
export function rootPcToMidi(pc: number, octave = 4): number {
  return (octave + 1) * 12 + pc
}

