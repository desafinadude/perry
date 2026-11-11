/*
 * Perry's own instrument icons: 24×24, 1.6px strokes in currentColor, drawn
 * to sit with the Swiss / Blue Note faceplates. Zones without a chosen icon
 * get one guessed from their name (see guessIcon).
 */

/** Outline of two overlapping circles (a guitar body), as one path. */
function body(c1: [number, number], r1: number, c2: [number, number], r2: number): string {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1]
  const d = Math.hypot(dx, dy)
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(r1 * r1 - a * a)
  const ux = dx / d, uy = dy / d
  const px = c1[0] + a * ux, py = c1[1] + a * uy
  const i1 = [px - h * uy, py + h * ux].map((n) => n.toFixed(2))
  const i2 = [px + h * uy, py - h * ux].map((n) => n.toFixed(2))
  return `M${i1[0]} ${i1[1]}A${r1} ${r1} 0 1 1 ${i2[0]} ${i2[1]}A${r2} ${r2} 0 1 1 ${i1[0]} ${i1[1]}Z`
}

export interface BuiltinIcon {
  id: string
  name: string
  /** Inner SVG markup (trusted, ours). */
  markup: string
  /** Name words that suggest this icon. */
  words: string[]
}

const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"'
const F = 'fill="currentColor"'

export const BUILTIN_ICONS: BuiltinIcon[] = [
  {
    id: 'keys', name: 'Keys', words: ['piano', 'keys', 'key', 'grand', 'rhodes', 'wurli', 'wurlitzer', 'epiano', 'clav', 'harpsichord'],
    markup: `<rect x="3" y="6" width="18" height="12" ${S}/><path d="M7.5 12V18M12 12V18M16.5 12V18" ${S}/><path d="M6.5 6h2v6h-2zM11 6h2v6h-2zM15.5 6h2v6h-2z" ${F}/>`,
  },
  {
    id: 'organ', name: 'Organ', words: ['organ', 'hammond', 'b3', 'church'],
    markup: `<rect x="3" y="14" width="18" height="6" ${S}/><path d="M7.5 14V20M12 14V20M16.5 14V20M6 4V9M10 4V11M14 4V7M18 4V10" ${S}/><path d="M5 8h2v2H5zM9 10h2v2H9zM13 6h2v2h-2zM17 9h2v2h-2z" ${F}/>`,
  },
  {
    id: 'synth', name: 'Synth', words: ['synth', 'synthesizer', 'moog', 'analog', 'poly'],
    markup: `<rect x="3" y="5" width="18" height="14" ${S}/><path d="M3 11H21M7.5 15V19M12 15V19M16.5 15V19M15 8H19" ${S}/><circle cx="7" cy="8" r="1.4" ${F}/><circle cx="11" cy="8" r="1.4" ${F}/>`,
  },
  {
    id: 'guitar', name: 'Guitar', words: ['guitar', 'gtr', 'acoustic', 'nylon', 'steel', 'ukulele', 'uke', 'banjo', 'strum'],
    markup: `<path d="${body([8, 16], 5, [13, 11], 3.5)}" ${S}/><path d="M15.2 8.8L20 4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M19 3L21 5" ${S}/><circle cx="9.2" cy="14.8" r="1.4" ${F}/><path d="M5.6 16.8L7.6 18.8" ${S}/>`,
  },
  {
    id: 'bass', name: 'Bass', words: ['bass', 'upright', 'fretless'],
    markup: `<path d="${body([7, 17], 4, [10.5, 13.5], 2.8)}" ${S}/><path d="M12.4 11.6L20.5 3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.5 2.5L21.5 4.5" ${S}/><path d="M6.2 15.2L8.8 17.8" ${S}/>`,
  },
  {
    id: 'drums', name: 'Drums', words: ['drum', 'drums', 'kit', 'snare', 'kick', 'tom', 'toms', 'beat', 'beats', 'percussion', 'perc'],
    markup: `<ellipse cx="12" cy="11" rx="8" ry="2.6" ${S}/><path d="M4 11V17A8 2.6 0 0 0 20 17V11M8 13.4V19.2M12 13.6V19.6M16 13.4V19.2" ${S}/><path d="M5 3L10.5 8.5M19 3L13.5 8.5" ${S}/>`,
  },
  {
    id: 'cymbal', name: 'Cymbals', words: ['cymbal', 'cymbals', 'hat', 'hihat', 'hats', 'ride', 'crash', 'shaker', 'tambourine'],
    markup: `<path d="M3 8.5Q12 4.5 21 8.5ZM3 11Q12 15 21 11Z" ${S}/><path d="M12 6V4M12 13V21M8 21H16" ${S}/>`,
  },
  {
    id: 'mic', name: 'Vocals', words: ['vocal', 'vocals', 'vox', 'voice', 'voices', 'choir', 'sing', 'singer', 'mic', 'aahs', 'oohs'],
    markup: `<rect x="9.5" y="3" width="5" height="10" rx="2.5" ${S}/><path d="M6.5 10.5A5.5 5.5 0 0 0 17.5 10.5M12 16V20M8.5 20H15.5" ${S}/>`,
  },
  {
    id: 'brass', name: 'Brass', words: ['brass', 'trumpet', 'horn', 'horns', 'trombone', 'tuba', 'cornet', 'flugel', 'flugelhorn'],
    markup: `<path d="M3 11H14L20.5 7V17L14 13H3Z" ${S}/><path d="M7 11V7.5M9.5 11V7.5M12 11V7.5M6 13V16H13V13" ${S}/><path d="M6.2 6.2h1.6v1.6H6.2zM8.7 6.2h1.6v1.6H8.7zM11.2 6.2h1.6v1.6h-1.6z" ${F}/>`,
  },
  {
    id: 'sax', name: 'Sax', words: ['sax', 'saxophone', 'alto', 'tenor', 'soprano', 'reed', 'reeds', 'clarinet', 'oboe', 'bassoon'],
    markup: `<path d="M17.5 2.5L14 5V15A4 4 0 0 1 6 15V12.5M3.8 12.5H8.2" ${S}/><circle cx="14" cy="8.5" r="1.1" ${F}/><circle cx="14" cy="11.5" r="1.1" ${F}/><circle cx="14" cy="14.5" r="1.1" ${F}/>`,
  },
  {
    id: 'strings', name: 'Strings', words: ['string', 'strings', 'violin', 'viola', 'cello', 'fiddle', 'orchestra', 'ensemble', 'pizz', 'pizzicato'],
    markup: `<path d="M12 9C9.2 9 8 10 8.6 12C9 13 8 13.6 8 15.2C8 18.6 10 20.5 12 20.5C14 20.5 16 18.6 16 15.2C16 13.6 15 13 15.4 12C16 10 14.8 9 12 9Z" ${S}/><path d="M12 3V16.5M10.5 18H13.5M10 13.2V15.2M14 13.2V15.2" ${S}/><circle cx="12" cy="3" r="1.3" ${F}/>`,
  },
  {
    id: 'flute', name: 'Flute', words: ['flute', 'piccolo', 'recorder', 'pipe', 'pipes', 'pan', 'woodwind', 'whistle', 'ocarina'],
    markup: `<path d="M3.5 19L19 3.5L20.5 5L5 20.5Z" ${S}/><circle cx="10" cy="13" r="0.9" ${F}/><circle cx="12.3" cy="10.7" r="0.9" ${F}/><circle cx="14.6" cy="8.4" r="0.9" ${F}/><path d="M16.2 6.6L17.4 7.8" ${S}/>`,
  },
  {
    id: 'bell', name: 'Bells', words: ['bell', 'bells', 'vibes', 'vibraphone', 'glock', 'glockenspiel', 'mallet', 'mallets', 'marimba', 'xylophone', 'celesta', 'chime', 'chimes', 'music box', 'kalimba'],
    markup: `<path d="M7 16V11A5 5 0 0 1 17 11V16L18.5 17.5H5.5Z" ${S}/><path d="M12 6V4" ${S}/><circle cx="12" cy="19.6" r="1.3" ${F}/>`,
  },
  {
    id: 'pad', name: 'Pad', words: ['pad', 'pads', 'ambient', 'atmos', 'atmosphere', 'drone', 'texture', 'sine', 'warm', 'wash'],
    markup: `<path d="M3 12C6 4 9 4 12 12S18 20 21 12" ${S}/><path d="M3 20H21" ${S} stroke-dasharray="1.6 2"/>`,
  },
  {
    id: 'lead', name: 'Lead', words: ['lead', 'saw', 'sawtooth', 'square', 'solo', 'pluck', 'arp'],
    markup: `<path d="M3 17L9 7V17L15 7V17L21 7" ${S}/>`,
  },
  {
    id: 'sample', name: 'Sample', words: ['sample', 'samples', 'loop', 'loops', 'chop', 'break', 'breaks', 'fx', 'sfx', 'vinyl'],
    markup: `<path d="M4 10V14M7 7V17M10 4V20M13 8V16M16 5.5V18.5M19 9.5V14.5" ${S}/>`,
  },
  {
    id: 'click', name: 'Click', words: ['click', 'metronome', 'metro', 'count'],
    markup: `<path d="M8 20.5L10.5 3.5H13.5L16 20.5Z" ${S}/><path d="M12 16L17.5 6.5M8.8 15.5H15.2" ${S}/>`,
  },
  {
    id: 'harp', name: 'Harp', words: ['harp', 'lyre', 'koto', 'zither', 'dulcimer', 'sitar'],
    markup: `<path d="M6 20.5V4C11 4 13 9 19 9.5L6 20.5" ${S}/><path d="M9 5.2V18M12 7V15.4M15 8.6V12.9" ${S}/>`,
  },
]

const BY_ID = new Map(BUILTIN_ICONS.map((i) => [i.id, i]))
export const builtinIcon = (id: string) => BY_ID.get(id)

/** Best built-in icon for a name ("Walking Bass" → bass), or null. */
export function guessIcon(name: string): BuiltinIcon | null {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
  const padded = ` ${words.replace(/\s+/g, ' ').trim()} `
  // the last matching word wins ("synth bass" → bass, "bass drum" → drums)
  let best: BuiltinIcon | null = null, at = -1
  for (const icon of BUILTIN_ICONS) {
    for (const w of icon.words) {
      const i = padded.lastIndexOf(` ${w} `)
      if (i > at) { at = i; best = icon }
    }
  }
  return best
}
