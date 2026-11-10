/*
 * Jam styles — the "pattern files".
 *
 * A style is plain data (JSON-compatible) describing how each band member
 * plays one bar. Patterns are lists of hits with times in quarter-note beats
 * from the start of the bar; a part with several bars cycles through them.
 * Hits at or beyond the bar length are dropped (so 4/4 patterns still work in
 * 3/4). Off-beat eighths (x.5) are pushed to `swing`.
 *
 * Drums use General MIDI drum numbers (36 kick, 37 side stick, 38 snare,
 * 42 closed hat, 44 pedal hat, 46 open hat, 49 crash, 51 ride, 53 bell).
 * Bass hits name a chord degree; "approach" leads chromatically into the next
 * chord's root. `walking: true` asks the arranger to improvise a walking line.
 * Comp hits play the current chord in the style's voicing; a hit within half
 * a beat of a chord change anticipates the new chord.
 *
 * To add a style, add an object to STYLES. See docs/jam-styles.md.
 */

export interface DrumHit { t: number; n: number; v: number }
export type BassDegree = 'root' | 'fifth' | 'third' | 'seventh' | 'octave' | 'approach'
export interface BassHit { t: number; d: number; deg: BassDegree; v: number }
export interface CompHit { t: number; d: number; v: number }
export type Voicing = 'rootless' | 'shell' | 'triad' | 'spread'

export interface StyleDef {
  id: string
  name: string
  /** Where the off-beat eighth lands: 0.5 straight, ~0.62 medium swing, 0.67 triplet. */
  swing: number
  defaultBpm: number
  /** iReal style names that map to this style (case-insensitive substrings). */
  matches: string[]
  drums: { bars: DrumHit[][]; crashOnChorus?: boolean }
  bass: { walking: true; v: number } | { walking?: false; bars: BassHit[][] }
  comp: {
    voicing: Voicing
    bars: CompHit[][]
    /** Also strike at chord changes the pattern misses (for sparse patterns). */
    fillChanges?: boolean
  }
  /** Short names for the band panel. */
  labels: { drums: string; bass: string; comp: string }
}

const K = 36, SS = 37, SN = 38, CH = 42, PH = 44, OH = 46, RD = 51

const eighths = (n: number, v: number, accent = v) =>
  Array.from({ length: 8 }, (_, i) => ({ t: i / 2, n, v: i % 2 === 0 ? accent : v }))
const sixteenths = (n: number, v: number, accent = v) =>
  Array.from({ length: 16 }, (_, i) => ({ t: i / 4, n, v: i % 4 === 0 ? accent : i % 2 === 0 ? (v + accent) / 2 : v }))

export const STYLES: StyleDef[] = [
  {
    id: 'swing',
    name: 'Medium Swing',
    swing: 0.64,
    defaultBpm: 140,
    matches: ['swing', 'bop', 'up tempo', 'medium', 'dixie', 'shuffle', 'waltz', 'jazz', 'blues'],
    drums: {
      crashOnChorus: true,
      bars: [[
        { t: 0, n: RD, v: 0.62 }, { t: 1, n: RD, v: 0.72 }, { t: 1.5, n: RD, v: 0.45 },
        { t: 2, n: RD, v: 0.62 }, { t: 3, n: RD, v: 0.72 }, { t: 3.5, n: RD, v: 0.45 },
        { t: 1, n: PH, v: 0.55 }, { t: 3, n: PH, v: 0.55 },
        { t: 0, n: K, v: 0.22 }, { t: 1, n: K, v: 0.18 }, { t: 2, n: K, v: 0.22 }, { t: 3, n: K, v: 0.18 },
      ], [
        { t: 0, n: RD, v: 0.62 }, { t: 1, n: RD, v: 0.72 }, { t: 1.5, n: RD, v: 0.45 },
        { t: 2, n: RD, v: 0.62 }, { t: 3, n: RD, v: 0.72 }, { t: 3.5, n: RD, v: 0.45 },
        { t: 1, n: PH, v: 0.55 }, { t: 3, n: PH, v: 0.55 },
        { t: 0, n: K, v: 0.22 }, { t: 2, n: K, v: 0.2 }, { t: 2.5, n: SN, v: 0.22 }, { t: 3.5, n: SN, v: 0.3 },
      ]],
    },
    bass: { walking: true, v: 0.82 },
    comp: {
      voicing: 'rootless',
      bars: [
        [{ t: 0, d: 0.7, v: 0.62 }, { t: 1.5, d: 0.4, v: 0.55 }],
        [{ t: 0.5, d: 0.4, v: 0.5 }, { t: 2, d: 0.7, v: 0.58 }, { t: 3.5, d: 0.4, v: 0.5 }],
      ],
    },
    labels: { drums: 'RIDE · HATS 2 & 4', bass: 'WALKING', comp: 'CHARLESTON · ROOTLESS' },
  },
  {
    id: 'ballad',
    name: 'Ballad',
    swing: 0.6,
    defaultBpm: 68,
    matches: ['ballad', 'slow'],
    drums: {
      bars: [[
        { t: 0, n: RD, v: 0.35 }, { t: 1, n: RD, v: 0.4 }, { t: 1.5, n: RD, v: 0.25 },
        { t: 2, n: RD, v: 0.35 }, { t: 3, n: RD, v: 0.4 }, { t: 3.5, n: RD, v: 0.25 },
        { t: 1, n: PH, v: 0.4 }, { t: 3, n: PH, v: 0.4 }, { t: 0, n: K, v: 0.25 },
      ]],
    },
    bass: {
      bars: [[
        { t: 0, d: 1.9, deg: 'root', v: 0.75 }, { t: 2, d: 1.4, deg: 'fifth', v: 0.65 }, { t: 3.5, d: 0.45, deg: 'approach', v: 0.5 },
      ]],
    },
    comp: { voicing: 'spread', fillChanges: true, bars: [[{ t: 0, d: 3.8, v: 0.5 }]] },
    labels: { drums: 'SOFT RIDE · 2 & 4', bass: 'TWO-FEEL', comp: 'SUSTAINED · SPREAD' },
  },
  {
    id: 'bossa',
    name: 'Bossa Nova',
    swing: 0.5,
    defaultBpm: 132,
    matches: ['bossa', 'samba', 'latin', 'brazil', 'mambo', 'cha', 'afro', 'bolero', 'rumba', 'tango', 'calypso', 'salsa', 'son'],
    drums: {
      bars: [[
        ...eighths(CH, 0.3, 0.42),
        { t: 0, n: SS, v: 0.6 }, { t: 1.5, n: SS, v: 0.55 }, { t: 3, n: SS, v: 0.6 },
        { t: 0, n: K, v: 0.6 }, { t: 1.5, n: K, v: 0.4 }, { t: 2, n: K, v: 0.6 }, { t: 3.5, n: K, v: 0.4 },
      ], [
        ...eighths(CH, 0.3, 0.42),
        { t: 1, n: SS, v: 0.6 }, { t: 2.5, n: SS, v: 0.6 },
        { t: 0, n: K, v: 0.6 }, { t: 1.5, n: K, v: 0.4 }, { t: 2, n: K, v: 0.6 }, { t: 3.5, n: K, v: 0.4 },
      ]],
    },
    bass: {
      bars: [[
        { t: 0, d: 1.4, deg: 'root', v: 0.8 }, { t: 1.5, d: 0.45, deg: 'fifth', v: 0.6 },
        { t: 2, d: 1.4, deg: 'fifth', v: 0.75 }, { t: 3.5, d: 0.45, deg: 'root', v: 0.6 },
      ]],
    },
    comp: {
      voicing: 'shell',
      bars: [
        [{ t: 0, d: 0.45, v: 0.55 }, { t: 1.5, d: 0.45, v: 0.5 }, { t: 3, d: 0.45, v: 0.5 }],
        [{ t: 0.5, d: 0.45, v: 0.5 }, { t: 2, d: 0.45, v: 0.55 }, { t: 3.5, d: 0.45, v: 0.5 }],
      ],
    },
    labels: { drums: 'SIDE STICK · CLAVE', bass: 'ROOT – FIFTH', comp: 'GUITAR-STYLE STABS' },
  },
  {
    id: 'pop',
    name: 'Pop 8ths',
    swing: 0.5,
    defaultBpm: 108,
    matches: ['pop', 'rock', 'even', 'country', 'folk', 'reggae', 'ballad pop'],
    drums: {
      crashOnChorus: true,
      bars: [[
        ...eighths(CH, 0.4, 0.55),
        { t: 0, n: K, v: 0.85 }, { t: 2, n: K, v: 0.75 }, { t: 2.5, n: K, v: 0.55 },
        { t: 1, n: SN, v: 0.8 }, { t: 3, n: SN, v: 0.8 },
      ]],
    },
    bass: {
      bars: [Array.from({ length: 8 }, (_, i) => ({
        t: i / 2, d: 0.45, deg: (i === 6 ? 'fifth' : 'root') as BassDegree, v: i % 2 === 0 ? 0.8 : 0.6,
      }))],
    },
    comp: {
      voicing: 'triad',
      fillChanges: true,
      bars: [[{ t: 0, d: 1.4, v: 0.6 }, { t: 1.5, d: 0.45, v: 0.45 }, { t: 2, d: 1.4, v: 0.55 }, { t: 3.5, d: 0.45, v: 0.45 }]],
    },
    labels: { drums: 'BACKBEAT · 8THS', bass: 'ROOT 8THS', comp: 'TRIADS · PUSHES' },
  },
  {
    id: 'funk',
    name: 'Funk 16ths',
    swing: 0.5,
    defaultBpm: 98,
    matches: ['funk', 'r&b', 'soul', 'groove', 'disco', 'hip'],
    drums: {
      crashOnChorus: true,
      bars: [[
        ...sixteenths(CH, 0.25, 0.5),
        { t: 0, n: K, v: 0.9 }, { t: 0.75, n: K, v: 0.6 }, { t: 2.5, n: K, v: 0.75 },
        { t: 1, n: SN, v: 0.85 }, { t: 3, n: SN, v: 0.85 }, { t: 2.75, n: SN, v: 0.2 }, { t: 1.75, n: SN, v: 0.18 },
        { t: 3.5, n: OH, v: 0.45 },
      ]],
    },
    bass: {
      bars: [[
        { t: 0, d: 0.4, deg: 'root', v: 0.9 }, { t: 0.75, d: 0.2, deg: 'root', v: 0.6 },
        { t: 1.5, d: 0.2, deg: 'octave', v: 0.7 }, { t: 2.5, d: 0.4, deg: 'root', v: 0.8 },
        { t: 3, d: 0.2, deg: 'seventh', v: 0.6 }, { t: 3.5, d: 0.2, deg: 'fifth', v: 0.65 },
      ]],
    },
    comp: {
      voicing: 'shell',
      bars: [[{ t: 0.5, d: 0.15, v: 0.55 }, { t: 1.75, d: 0.15, v: 0.5 }, { t: 2.5, d: 0.15, v: 0.55 }, { t: 3.25, d: 0.15, v: 0.5 }]],
    },
    labels: { drums: '16TH HATS · GHOSTS', bass: 'SYNCOPATED', comp: 'CHOPS' },
  },
]

export function styleById(id: string): StyleDef {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

/** Pick a style for an iReal style label. */
export function styleForName(name: string): StyleDef {
  const n = name.toLowerCase()
  // more specific first: "Pop Ballad" → pop, "Latin Jazz" → bossa
  const order = ['funk', 'bossa', 'pop', 'ballad', 'swing']
  for (const id of order) {
    const s = styleById(id)
    if (s.matches.some((m) => n.includes(m))) return s
  }
  return STYLES[0]
}
