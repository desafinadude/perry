/**
 * Generates MusicXML for a scale (up + down) with an optional block chord measure.
 * Uses flat-preference enharmonic spelling (suits jazz context).
 */

// [step, alter] with flat preference (suits jazz)
const NOTE_TABLE: Array<[string, number]> = [
  ['C',  0],   // 0  – C
  ['D', -1],   // 1  – D♭
  ['D',  0],   // 2  – D
  ['E', -1],   // 3  – E♭
  ['E',  0],   // 4  – E
  ['F',  0],   // 5  – F
  ['G', -1],   // 6  – G♭
  ['G',  0],   // 7  – G
  ['A', -1],   // 8  – A♭
  ['A',  0],   // 9  – A
  ['B', -1],   // 10 – B♭
  ['B',  0],   // 11 – B
]

function midiToXmlPitch(midi: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  const [step, alter] = NOTE_TABLE[pc]
  return { step, alter, octave }
}

function noteXml(
  midi: number,
  duration: number,
  type: string,
  isChord = false,
  staff = 1,
): string {
  const { step, alter, octave } = midiToXmlPitch(midi)
  return `      <note>
        ${isChord ? '<chord/>' : ''}
        <pitch>
          <step>${step}</step>
          ${alter !== 0 ? `<alter>${alter}</alter>` : ''}
          <octave>${octave}</octave>
        </pitch>
        <duration>${duration}</duration>
        <type>${type}</type>
        <staff>${staff}</staff>
      </note>`
}

function restXml(duration: number, type: string, staff = 1): string {
  return `      <note>
        <rest/>
        <duration>${duration}</duration>
        <type>${type}</type>
        <staff>${staff}</staff>
      </note>`
}

export interface ScaleXmlOptions {
  tempo?: number
  octaveMode?: 'rh' | 'lh' | 'both'
  numOctaves?: number  // how many octaves up (and back down), default 2
  // Header text embedded into the score
  title?: string
  subtitle?: string
  annotation?: string
}

/**
 * @param rootMidi  MIDI note for the root (e.g. 60 = C4)
 * @param intervals Semitone intervals from root (not including octave)
 */
export function generateScaleMusicXml(
  rootMidi: number,
  intervals: number[],
  options: ScaleXmlOptions = {},
): string {
  const {
    tempo = 80,
    octaveMode = 'rh',
    numOctaves = 2,
    title = '',
    subtitle = '',
    annotation = '',
  } = options

  const DIVISIONS = 4
  const BEATS = 4
  const MEASURE_DUR = DIVISIONS * BEATS

  // Build scale notes: up numOctaves then back down, no repeated top note
  function scaleNotes(base: number): number[] {
    const up: number[] = []
    for (let oct = 0; oct < numOctaves; oct++) {
      intervals.forEach((i) => up.push(base + oct * 12 + i))
    }
    up.push(base + numOctaves * 12) // top note

    const down: number[] = []
    for (let oct = numOctaves - 1; oct >= 0; oct--) {
      ;[...intervals].reverse().forEach((i) => down.push(base + oct * 12 + i))
    }
    return [...up, ...down]
  }

  const rhBase = rootMidi
  const lhBase = rootMidi - 12
  const rhNotes = scaleNotes(rhBase)
  const lhNotes = octaveMode === 'both' ? scaleNotes(lhBase) : null

  const isTwoStaff = octaveMode === 'both'

  function packIntoMeasures(notes: number[], staff: number): string[] {
    const measures: string[] = []
    let i = 0
    while (i < notes.length) {
      let content = ''
      let beats = 0
      while (i < notes.length && beats < BEATS) {
        content += noteXml(notes[i], DIVISIONS, 'quarter', false, staff) + '\n'
        beats++
        i++
      }
      while (beats < BEATS) {
        content += restXml(DIVISIONS, 'quarter', staff) + '\n'
        beats++
      }
      measures.push(content)
    }
    return measures
  }

  const rhMeasures = packIntoMeasures(rhNotes, 1)
  const lhMeasures = lhNotes ? packIntoMeasures(lhNotes, 2) : null
  const numScaleMeasures = rhMeasures.length

  const measureXmls: string[] = []

  for (let m = 0; m < numScaleMeasures; m++) {
    const isFirst = m === 0

    const attrs = isFirst
      ? `      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${BEATS}</beats><beat-type>4</beat-type></time>
        <staves>${isTwoStaff ? 2 : 1}</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        ${isTwoStaff ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : ''}
      </attributes>
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>${tempo}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${tempo}"/>
      </direction>`
      : ''

    const backup = lhMeasures
      ? `      <backup><duration>${MEASURE_DUR}</duration></backup>`
      : ''

    const lhContent = lhMeasures ? backup + '\n' + lhMeasures[m] : ''

    measureXmls.push(
      `    <measure number="${m + 1}">\n${attrs}\n${rhMeasures[m]}${lhContent}    </measure>`,
    )
  }

  const headerXml = `
  ${title ? `<movement-title>${escXml(title)}</movement-title>` : ''}
  ${subtitle ? `<identification><miscellaneous><miscellaneous-field name="subtitle">${escXml(subtitle)}</miscellaneous-field></miscellaneous></identification>` : ''}
  ${subtitle ? `<credit page="1">
    <credit-type>subtitle</credit-type>
    <credit-words font-size="11" justify="center" valign="top" default-x="510" default-y="770">${escXml(subtitle)}</credit-words>
  </credit>` : ''}
  ${annotation ? `<credit page="1">
    <credit-type>rights</credit-type>
    <credit-words font-size="9" justify="center" valign="top" default-x="510" default-y="748">${escXml(annotation)}</credit-words>
  </credit>` : ''}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  ${headerXml}
  <part-list>
    <score-part id="P1">
      <part-name>Scale</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measureXmls.join('\n')}
  </part>
</score-partwise>`
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
