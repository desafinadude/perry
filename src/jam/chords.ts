/*
 * Chord symbols in iReal Pro spelling: root + quality + optional /bass.
 *   C^7  C-7  Ch7  Co7  C7b9  C7alt  C-^7  C6  C69  Csus  C7sus  C/E  C-7/Bb
 * Also accepts common spellings on input (Cmaj7, Cm7, Cmin7, Cø, Cdim7, CΔ…)
 * and normalises them to iReal form.
 */

export const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
}
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface Chord {
  /** Root pitch class 0–11. */
  root: number
  /** iReal quality string ('' = major triad). */
  quality: string
  /** Bass pitch class when slash chord, else null. */
  bass: number | null
  /** Intervals above the root in semitones (0 included), sorted. */
  intervals: number[]
  /** Key tones used for voicing: third (or sus), seventh/sixth, colour tones. */
  third: number | null
  seventh: number | null
  fifth: number | null
  /** Extensions and alterations (above the octave or altered 5ths). */
  tensions: number[]
}

export interface ParsedSymbol {
  ok: boolean
  /** Normalised iReal text, e.g. "C-7/Bb". */
  text: string
  chord?: Chord
  error?: string
}

/** Turn common spellings into iReal quality spelling. */
export function normaliseQuality(q: string): string {
  let s = q.trim()
  s = s.replace(/[Δ△]/g, '^').replace(/ø/g, 'h').replace(/°/g, 'o').replace(/♭/g, 'b').replace(/♯/g, '#')
  s = s.replace(/^maj(?=\d|$|\(|#|b|add|sus)/i, '^')
  s = s.replace(/^M(?=7|9|13)/, '^')
  s = s.replace(/^min(?=\^|maj)/i, '-')
  s = s.replace(/^(min|mi|m)(?!aj)/, '-')
  s = s.replace(/^-maj/i, '-^')
  s = s.replace(/^dim7?/i, (m) => (m.endsWith('7') ? 'o7' : 'o'))
  s = s.replace(/^aug/i, '+')
  s = s.replace(/^-7b5/, 'h7')
  s = s.replace(/^h$/, 'h7')
  return s
}

/** Interval structure of an iReal quality. Returns null if unrecognised. */
export function qualityStructure(qualityIn: string): Omit<Chord, 'root' | 'bass' | 'quality'> | null {
  let s = normaliseQuality(qualityIn)
  let third: number | null = 4
  let fifth: number | null = 7
  let seventh: number | null = null
  const tensions = new Set<number>()

  if (s.startsWith('-')) { third = 3; s = s.slice(1) }
  else if (s.startsWith('h')) { third = 3; fifth = 6; seventh = 10; s = s.slice(1); if (s.startsWith('7')) s = s.slice(1) }
  else if (s.startsWith('o')) {
    third = 3; fifth = 6; s = s.slice(1)
    if (s.startsWith('7')) { seventh = 9; s = s.slice(1) }
  } else if (s.startsWith('+')) { fifth = 8; s = s.slice(1) }

  let maj = false
  if (s.startsWith('^')) { maj = true; seventh = 11; s = s.slice(1) }

  const num = s.match(/^(69|13|11|9|7|6|5|2)/)
  if (num) {
    s = s.slice(num[1].length)
    const dom = maj ? 11 : (seventh ?? 10)
    switch (num[1]) {
      case '7': seventh = dom; break
      case '9': seventh = dom; tensions.add(14); break
      case '11': seventh = dom; tensions.add(14); tensions.add(17); break
      case '13': seventh = dom; tensions.add(14); tensions.add(21); break
      case '6': if (seventh === null) seventh = 9; break
      case '69': if (seventh === null) seventh = 9; tensions.add(14); break
      case '5': third = null; break
      case '2': third = 2; break
    }
  }

  // sus / add
  if (/sus2/.test(s)) { third = 2; s = s.replace('sus2', '') }
  if (/sus4?/.test(s)) { third = 5; s = s.replace(/sus4?/, '') }
  if (/add9|add2/.test(s)) { tensions.add(14); s = s.replace(/add9|add2/, '') }
  if (/add3/.test(s)) { s = s.replace('add3', '') /* 7susadd3: keep the 4th, add the 3rd */; tensions.add(16) }
  if (/add4|\(add4\)/.test(s)) { tensions.add(17); s = s.replace(/\(?add4\)?/, '') }
  if (/\(add13\)|add13/.test(s)) { tensions.add(21); s = s.replace(/\(?add13\)?/, '') }
  if (/alt/.test(s)) {
    if (seventh === null) seventh = 10
    fifth = null
    tensions.add(13); tensions.add(15); tensions.add(20)
    s = s.replace('alt', '')
  }

  // alterations, possibly several: b9 #9 #11 b13 b5 #5 b6
  const alt = /([b#])(13|11|9|6|5)/g
  let m: RegExpExecArray | null
  let consumed = s
  while ((m = alt.exec(s))) {
    const [, sign, deg] = m
    if (deg === '5') fifth = sign === 'b' ? 6 : 8
    else if (deg === '6') tensions.add(8)
    else if (deg === '9') tensions.add(sign === 'b' ? 13 : 15)
    else if (deg === '11') tensions.add(sign === 'b' ? 16 : 18)
    else if (deg === '13') tensions.add(sign === 'b' ? 20 : 22)
    consumed = consumed.replace(m[0], '')
    if (seventh === null && (deg === '9' || deg === '13' || deg === '11')) seventh = maj ? 11 : 10
  }
  // an altered 9 replaces the natural 9 implied by "9"/"13"
  if (tensions.has(13) || tensions.has(15)) tensions.delete(14)
  // a b5/#11 replaces the natural 5th when it is the 5th itself
  if (tensions.has(18) && fifth === 7 && /7#11|9#11|13#11/.test(qualityIn)) { /* keep 5th; #11 is a colour */ }

  const rest = consumed.replace(/[()\s]/g, '')
  if (rest.length > 0) return null

  const iv = new Set<number>([0])
  if (third !== null) iv.add(third)
  if (fifth !== null) iv.add(fifth)
  if (seventh !== null) iv.add(seventh)
  tensions.forEach((t) => iv.add(t))
  return {
    intervals: [...iv].sort((a, b) => a - b),
    third, fifth, seventh,
    tensions: [...tensions].sort((a, b) => a - b),
  }
}

/** Parse one chord symbol (no alternate-chord parentheses). */
export function parseChord(input: string): ParsedSymbol {
  const raw = input.trim().replace(/♭/g, 'b').replace(/♯/g, '#')
  if (!raw) return { ok: false, text: '', error: 'Empty' }
  const m = raw.match(/^([A-Ga-g])([b#]?)([^/]*)(?:\/([A-Ga-g][b#]?))?$/)
  if (!m) return { ok: false, text: raw, error: 'Start with a note name A–G, e.g. C-7 or Bb^7' }
  const rootName = m[1].toUpperCase() + m[2]
  const root = NOTE_PC[rootName]
  const qualityText = m[3]
  const st = qualityStructure(qualityText)
  if (!st) return { ok: false, text: raw, error: `Unknown quality “${qualityText}”` }
  const quality = normaliseQuality(qualityText)
  const bassName = m[4] ? m[4][0].toUpperCase() + m[4].slice(1) : null
  const bass = bassName ? NOTE_PC[bassName] : null
  return {
    ok: true,
    text: rootName + quality + (bassName ? '/' + bassName : ''),
    chord: { root, quality, bass, ...st },
  }
}

const QUALITY_NAMES: [RegExp, string][] = [
  [/^\^7#11$/, 'major 7 ♯11'], [/^\^9$/, 'major 9'], [/^\^13$/, 'major 13'], [/^\^7?$/, 'major 7'],
  [/^-\^7$/, 'minor-major 7'], [/^-7$/, 'minor 7'], [/^-9$/, 'minor 9'], [/^-11$/, 'minor 11'], [/^-6$/, 'minor 6'],
  [/^-$/, 'minor'], [/^h7?$/, 'half-diminished'], [/^o7$/, 'diminished 7'], [/^o$/, 'diminished'],
  [/^\+$/, 'augmented'], [/^7alt$/, 'altered dominant'], [/^7sus$/, 'dominant 7 sus4'], [/^sus$/, 'sus4'],
  [/^7$/, 'dominant 7'], [/^9$/, 'dominant 9'], [/^13$/, 'dominant 13'], [/^6$/, 'major 6'], [/^69$/, 'six-nine'],
  [/^$/, 'major'],
]

/** Plain-English description, e.g. "C minor 7 · bass B♭". */
export function describeChord(c: Chord, flats = true): string {
  const q = QUALITY_NAMES.find(([r]) => r.test(c.quality))?.[1] ?? c.quality
  return `${pcName(c.root, flats)} ${q}${c.bass !== null ? ` · bass ${pcName(c.bass, flats)}` : ''}`
}

export function pcName(pc: number, flats = true): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12]
}

/** Keys that are conventionally spelled with sharps. */
const SHARP_KEYS = new Set([7, 2, 9, 4, 11]) // G D A E B (major); F#/Gb is spelled with flats
export function keyPrefersFlats(keyText: string): boolean {
  const minor = keyText.endsWith('-')
  const pc = NOTE_PC[keyText.replace('-', '')]
  if (pc === undefined) return true
  const major = minor ? (pc + 3) % 12 : pc
  return !SHARP_KEYS.has(major)
}

/** Transpose an iReal chord text by n semitones. Leaves non-chords untouched. */
export function transposeSymbol(text: string, n: number, flats: boolean): string {
  if (!n) return text
  return text.replace(/^([A-G][b#]?)(.*?)(?:\/([A-G][b#]?))?$/, (_, r: string, q: string, b?: string) => {
    const rr = pcName(NOTE_PC[r] + n, flats)
    const bb = b ? '/' + pcName(NOTE_PC[b] + n, flats) : ''
    return rr + q + bb
  })
}

export function transposeKey(key: string, n: number): string {
  if (!n) return key
  const minor = key.endsWith('-')
  const pc = NOTE_PC[key.replace('-', '')]
  if (pc === undefined) return key
  const target = (pc + n + 120) % 12
  const name = pcName(target, !SHARP_KEYS.has(minor ? (target + 3) % 12 : target))
  return name + (minor ? '-' : '')
}

/** Split display text into parts for typesetting. */
export function displayParts(text: string): { root: string; acc: string; qual: string; bass: string } {
  if (text === 'n') return { root: 'N.C.', acc: '', qual: '', bass: '' }
  const m = text.match(/^([A-GW])([b#]?)([^/]*)(?:\/([A-G][b#]?))?$/)
  if (!m) return { root: text, acc: '', qual: '', bass: '' }
  const acc = m[2] === 'b' ? '♭' : m[2] === '#' ? '♯' : ''
  const qual = m[3]
    .replace(/^\^/, '△').replace(/^-\^/, '–△').replace(/^-/, '–')
    .replace(/^h7?/, 'ø7').replace(/^o/, '°')
    .replace(/b(?=\d)/g, '♭').replace(/#(?=\d)/g, '♯')
  const bass = m[4] ? '/' + m[4].replace('b', '♭').replace('#', '♯') : ''
  return { root: m[1] === 'W' ? '' : m[1], acc, qual, bass }
}

/** Quick-pick qualities for the editor (label, iReal text). */
export const QUICK_QUALITIES: [string, string][] = [
  ['△7', '^7'], ['–7', '-7'], ['7', '7'], ['ø7', 'h7'], ['°7', 'o7'], ['6', '6'], ['–6', '-6'], ['69', '69'],
  ['9', '9'], ['–9', '-9'], ['13', '13'], ['7♭9', '7b9'], ['7♯9', '7#9'], ['7alt', '7alt'], ['sus', 'sus'], ['7sus', '7sus'],
]
