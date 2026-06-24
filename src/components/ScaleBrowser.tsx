import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import type { Zone } from '../types'
import {
  SCALES, CATEGORIES, CATEGORY_LABELS, ROOT_NAMES, rootPcToMidi,
  type ScaleEntry,
} from '../data/scales'
import { generateScaleMusicXml } from '../utils/scaleXmlGenerator'
// @ts-ignore
import SheetMusicOSMD from './SheetMusicOSMD'
import { Piano } from './Piano'

interface ScaleBrowserProps {
  zones: Zone[]
  noteOn: (zone: Zone, note: number, velocity: number) => void
  noteOff: (zone: Zone, note: number) => void
  allNotesOff: () => void
}

type OctaveMode = 'rh' | 'lh' | 'both'

// ── Tone.js synth (lazy init, reused across plays) ──────────────────────────
let toneSynth: Tone.PolySynth | null = null
function getToneSynth(): Tone.PolySynth {
  if (!toneSynth) {
    toneSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.5 },
      volume: -8,
    }).toDestination()
  }
  return toneSynth
}

const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToToneName(midi: number): string {
  return `${MIDI_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export default function ScaleBrowser({
  zones,
  noteOn,
  noteOff,
  allNotesOff,
}: ScaleBrowserProps) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('major')
  const [rootPc, setRootPc] = useState(0)           // pitch class 0–11
  const [scaleIdx, setScaleIdx] = useState(0)
  const [octaveMode, setOctaveMode] = useState<OctaveMode>('rh')
  const [tempo, setTempo] = useState(80)
  const [showChord, setShowChord] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [playingNotes, setPlayingNotes] = useState<Set<number>>(new Set())

  const stopRef = useRef<(() => void) | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────
  const scalesInCategory = useMemo(
    () => SCALES.filter((s) => s.category === category),
    [category],
  )

  // Keep scaleIdx in bounds when category changes
  const safeIdx = Math.min(scaleIdx, scalesInCategory.length - 1)
  const scale: ScaleEntry = scalesInCategory[safeIdx]

  const rootMidi = useMemo(
    () => rootPcToMidi(rootPc, octaveMode === 'lh' ? 3 : 4),
    [rootPc, octaveMode],
  )

  // Transpose the display symbol to the selected root
  const displaySymbol = useMemo(() => {
    return scale.symbol.replace(/^C/, ROOT_NAMES[rootPc])
  }, [scale.symbol, rootPc])

  // MusicXML (re-generated whenever anything relevant changes)
  const xml = useMemo(() => {
    return generateScaleMusicXml(rootMidi, scale.intervals, {
      tempo,
      octaveMode,
      showChord,
      chordIntervals: scale.chordIntervals,
    })
  }, [rootMidi, scale, tempo, octaveMode, showChord])

  // Piano highlight sets – full keyboard, all octaves
  const scaleHighlight = useMemo(() => {
    const pcs = new Set(scale.intervals.map((i) => (i + rootPc) % 12))
    pcs.add(rootPc % 12) // ensure root always included
    const notes = new Set<number>()
    for (let midi = 21; midi <= 108; midi++) {
      if (pcs.has(midi % 12)) notes.add(midi)
    }
    return notes
  }, [scale.intervals, rootPc])

  const chordHighlight = useMemo(() => {
    const pcs = new Set(scale.chordIntervals.map((i) => (i + rootPc) % 12))
    const notes = new Set<number>()
    for (let midi = 21; midi <= 108; midi++) {
      if (pcs.has(midi % 12)) notes.add(midi)
    }
    return notes
  }, [scale.chordIntervals, rootPc])

  // ── Playback helpers ──────────────────────────────────────────────────────
  // Route a note through loaded zones (same logic as App's handleNoteOn)
  const playZoneNote = useCallback(
    (midi: number, velocity = 80) => {
      const matching = zones.filter(
        (z) => midi >= z.minNote && midi <= z.maxNote && z.layer !== 'playback',
      )
      if (matching.length > 0) {
        matching.forEach((z) => noteOn(z, midi, velocity))
      } else {
        // Fallback: internal Tone.js synth
        try {
          getToneSynth().triggerAttack(midiToToneName(midi), Tone.now())
        } catch (_) {}
      }
    },
    [zones, noteOn],
  )

  const stopZoneNote = useCallback(
    (midi: number) => {
      const matching = zones.filter(
        (z) => midi >= z.minNote && midi <= z.maxNote && z.layer !== 'playback',
      )
      if (matching.length > 0) {
        matching.forEach((z) => noteOff(z, midi))
      } else {
        try {
          getToneSynth().triggerRelease(midiToToneName(midi), Tone.now())
        } catch (_) {}
      }
    },
    [zones, noteOff],
  )

  const stopAll = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    Tone.getTransport().cancel()
    Tone.getTransport().stop()
    allNotesOff()
    try { toneSynth?.releaseAll() } catch (_) {}
    setPlaying(false)
    setPlayingNotes(new Set())
  }, [allNotesOff])

  // Play a sequence of MIDI notes at the given tempo
  const playSequence = useCallback(
    async (notes: number[]) => {
      await Tone.start()
      stopAll()
      setPlaying(true)

      const beatSec = 60 / tempo
      const transport = Tone.getTransport()
      transport.cancel()

      notes.forEach((midi, i) => {
        const delay = i * beatSec
        const offDelay = delay + beatSec * 0.88
        transport.schedule(() => {
          playZoneNote(midi)
          setPlayingNotes(new Set([midi]))
        }, `+${delay}`)
        transport.schedule(() => {
          stopZoneNote(midi)
        }, `+${offDelay}`)
      })

      // Clear playing indicator after last note
      transport.schedule(() => {
        setPlaying(false)
        setPlayingNotes(new Set())
      }, `+${notes.length * beatSec}`)

      transport.start()

      stopRef.current = () => {
        transport.cancel()
        transport.stop()
      }
    },
    [tempo, playZoneNote, stopZoneNote, stopAll],
  )

  const handlePlayScale = useCallback(async () => {
    if (playing) { stopAll(); return }

    const base = rootMidi
    const lhBase = rootMidi - 12
    const buildSeq = (b: number) => {
      const up = scale.intervals.map((i) => b + i)
      up.push(b + 12)
      const down = [...scale.intervals].reverse().map((i) => b + i)
      return [...up, ...down]
    }

    let notes: number[]
    if (octaveMode === 'both') {
      // Interleave: LH and RH play the same sequence in their respective octaves
      // Play LH first then RH, or simultaneously. Let's play them sequentially for clarity.
      notes = buildSeq(base) // just RH for now; simultaneous is complex
      // For "both" mode, we'll actually play both hands together via two parallel calls
      await Tone.start()
      stopAll()
      setPlaying(true)
      const rhSeq = buildSeq(base)
      const lhSeq = buildSeq(lhBase)
      const beatSec = 60 / tempo
      const transport = Tone.getTransport()
      transport.cancel()

      rhSeq.forEach((midi, i) => {
        const delay = i * beatSec
        transport.schedule(() => { playZoneNote(midi) }, `+${delay}`)
        transport.schedule(() => { stopZoneNote(midi) }, `+${delay + beatSec * 0.88}`)
      })
      lhSeq.forEach((midi, i) => {
        const delay = i * beatSec
        transport.schedule(() => { playZoneNote(midi) }, `+${delay}`)
        transport.schedule(() => { stopZoneNote(midi) }, `+${delay + beatSec * 0.88}`)
      })
      transport.schedule(() => {
        setPlaying(false)
        setPlayingNotes(new Set())
      }, `+${rhSeq.length * beatSec}`)
      transport.start()
      stopRef.current = () => { transport.cancel(); transport.stop() }
      return
    }

    notes = buildSeq(base)
    await playSequence(notes)
  }, [playing, stopAll, scale, rootMidi, octaveMode, tempo, playSequence, playZoneNote, stopZoneNote])

  const handlePlayChord = useCallback(async () => {
    if (playing) { stopAll(); return }
    await Tone.start()
    const chordMidis = scale.chordIntervals.map((i) => rootMidi + i)
    const durMs = (60 / tempo) * 4 * 1000 // whole note duration

    setPlaying(true)
    setPlayingNotes(new Set(chordMidis))
    chordMidis.forEach((midi) => playZoneNote(midi))

    const timerId = setTimeout(() => {
      chordMidis.forEach((midi) => stopZoneNote(midi))
      setPlaying(false)
      setPlayingNotes(new Set())
    }, durMs)

    stopRef.current = () => {
      clearTimeout(timerId)
      chordMidis.forEach((midi) => stopZoneNote(midi))
    }
  }, [playing, stopAll, scale.chordIntervals, rootMidi, tempo, playZoneNote, stopZoneNote])

  // Stop when leaving the tab
  useEffect(() => () => { stopAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation helpers ────────────────────────────────────────────────────
  const prevScale = () => {
    stopAll()
    setScaleIdx((i) => (i > 0 ? i - 1 : scalesInCategory.length - 1))
  }
  const nextScale = () => {
    stopAll()
    setScaleIdx((i) => (i < scalesInCategory.length - 1 ? i + 1 : 0))
  }
  const handleCategoryChange = (cat: typeof category) => {
    stopAll()
    setCategory(cat)
    setScaleIdx(0)
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = styles

  return (
    <div style={s.container}>

      {/* ── Top controls bar ─────────────────────────────────────────────── */}
      <div style={s.controlBar}>

        {/* Category */}
        <div style={s.controlGroup}>
          <span style={s.label}>CATEGORY</span>
          <select
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value as typeof category)}
            style={s.select}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div style={s.divider} />

        {/* Root */}
        <div style={s.controlGroup}>
          <span style={s.label}>ROOT</span>
          <select
            value={rootPc}
            onChange={(e) => { stopAll(); setRootPc(Number(e.target.value)) }}
            style={{ ...s.select, minWidth: 60 }}
          >
            {ROOT_NAMES.map((name, pc) => (
              <option key={pc} value={pc}>{name}</option>
            ))}
          </select>
        </div>

        <div style={s.divider} />

        {/* Scale navigator */}
        <div style={s.controlGroup}>
          <span style={s.label}>SCALE  {safeIdx + 1}/{scalesInCategory.length}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={prevScale} style={s.arrowBtn}>◀</button>
            <span style={s.scaleName}>{displaySymbol} · {scale.name}</span>
            <button onClick={nextScale} style={s.arrowBtn}>▶</button>
          </div>
        </div>

        <div style={s.divider} />

        {/* Octave mode */}
        <div style={s.controlGroup}>
          <span style={s.label}>HANDS</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['rh', 'lh', 'both'] as OctaveMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { stopAll(); setOctaveMode(m) }}
                style={{ ...s.toggleBtn, ...(octaveMode === m ? s.toggleBtnActive : {}) }}
              >
                {m === 'rh' ? 'RH' : m === 'lh' ? 'LH' : 'BOTH'}
              </button>
            ))}
          </div>
        </div>

        <div style={s.divider} />

        {/* Tempo */}
        <div style={s.controlGroup}>
          <span style={s.label}>TEMPO · {tempo} BPM</span>
          <input
            type="range" min={40} max={200} value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </div>

        <div style={s.divider} />

        {/* Show chord toggle */}
        <div style={s.controlGroup}>
          <span style={s.label}>CHORD NOTATION</span>
          <button
            onClick={() => setShowChord((v) => !v)}
            style={{ ...s.toggleBtn, ...(showChord ? s.toggleBtnActive : {}) }}
          >
            {showChord ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* ── Main body ────────────────────────────────────────────────────── */}
      <div style={s.body}>

        {/* Sheet music */}
        <div style={s.sheetWrap}>
          <SheetMusicOSMD musicXml={xml} activeNotes={playingNotes} />
        </div>

        {/* Piano keyboard */}
        <div style={s.pianoWrap}>
          <div style={s.legendRow}>
            <span style={s.legendDot('#1A6BB5')} />
            <span style={s.legendText}>Scale tones</span>
            <span style={s.legendDot('#D93B2B')} />
            <span style={s.legendText}>Chord tones</span>
          </div>
          <Piano
            zones={[]}
            activeNotes={playingNotes}
            highlightNotes={scaleHighlight}
            highlightNotes2={chordHighlight}
            height={90}
          />
        </div>

        {/* Info + play panel */}
        <div style={s.infoPanel}>

          {/* Scale info */}
          <div style={s.infoGrid}>
            <div style={s.infoCell}>
              <span style={s.infoLabel}>FORMULA</span>
              <span style={s.infoValue}>{scale.wh}</span>
            </div>
            <div style={s.infoCell}>
              <span style={s.infoLabel}>SCALE IN {ROOT_NAMES[rootPc]}</span>
              <span style={s.infoValue}>{transposeScaleString(scale.scaleInC, rootPc)}</span>
            </div>
            <div style={s.infoCell}>
              <span style={s.infoLabel}>CHORD IN {ROOT_NAMES[rootPc]}</span>
              <span style={s.infoValue}>{transposeScaleString(scale.chordInC, rootPc)}</span>
            </div>
            {scale.altSymbols.length > 0 && (
              <div style={s.infoCell}>
                <span style={s.infoLabel}>ALSO WRITTEN AS</span>
                <span style={s.infoValue}>
                  {scale.altSymbols.map((sym) => sym.replace(/^C/, ROOT_NAMES[rootPc])).join('  ·  ')}
                </span>
              </div>
            )}
          </div>

          {/* Play buttons */}
          <div style={s.playRow}>
            <button
              onClick={handlePlayScale}
              style={{ ...s.playBtn, ...(playing ? s.playBtnStop : {}) }}
            >
              {playing ? '■ STOP' : '▶ PLAY SCALE'}
            </button>
            <button
              onClick={handlePlayChord}
              disabled={playing}
              style={{ ...s.playBtn, opacity: playing ? 0.4 : 1 }}
            >
              ♩ PLAY CHORD
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Transpose a "C D E F..." string to the given root pitch class ──────────
const NOTE_FLAT_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C♯': 1, 'D♯': 3, 'F♯': 6, 'G♯': 8, 'A♯': 10, 'B♯': 0,
}
const ROOT_NAMES_FULL = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

function transposeScaleString(scaleInC: string, rootPc: number): string {
  if (rootPc === 0) return scaleInC
  // tokenise: capture note names with optional ♭ ♯ + or - signs and then parenthetical groups
  return scaleInC.replace(
    /([A-G][♭♯#b]?)(\([^)]*\))?/g,
    (match, note, paren) => {
      const pc = NOTE_FLAT_MAP[note]
      if (pc === undefined) return match
      const transposed = (pc + rootPc) % 12
      return ROOT_NAMES_FULL[transposed] + (paren ?? '')
    },
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  controlBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    background: 'var(--surface)',
    borderBottom: '2px solid var(--ink)',
    padding: '0 12px',
    minHeight: 52,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
    rowGap: 6,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    gap: 4,
    padding: '8px 14px',
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    background: 'var(--border)',
    flexShrink: 0,
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.15em',
    color: 'var(--muted)',
    textTransform: 'uppercase' as const,
  },
  select: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 0,
    color: 'var(--ink)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    padding: '4px 6px',
    cursor: 'pointer',
    minWidth: 140,
  },
  scaleName: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--ink)',
    minWidth: 260,
    textAlign: 'center' as const,
    letterSpacing: '0.05em',
  },
  arrowBtn: {
    background: 'transparent',
    border: '1.5px solid var(--border)',
    borderRadius: 0,
    color: 'var(--ink)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    padding: '4px 8px',
    lineHeight: 1,
  },
  toggleBtn: {
    background: 'transparent',
    border: '1.5px solid var(--border)',
    borderRadius: 0,
    color: 'var(--muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.1em',
    padding: '4px 10px',
  },
  toggleBtnActive: {
    background: 'var(--ink)',
    border: '1.5px solid var(--ink)',
    color: 'var(--bg)',
  },
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'auto',
    minHeight: 0,
  },
  sheetWrap: {
    padding: '12px 24px 0',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    minHeight: 140,
  },
  pianoWrap: {
    background: 'var(--surface)',
    borderBottom: '2px solid var(--ink)',
    flexShrink: 0,
  },
  legendRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 16px 2px',
  },
  legendText: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--muted)',
    letterSpacing: '0.1em',
    marginRight: 10,
  },
  legendDot: (color: string) => ({
    display: 'inline-block',
    width: 10,
    height: 10,
    background: color,
    flexShrink: 0,
  }),
  infoPanel: {
    padding: '16px 24px',
    background: 'var(--bg)',
    flexShrink: 0,
  },
  infoGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '12px 32px',
    marginBottom: 16,
  },
  infoCell: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  infoLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.18em',
    color: 'var(--muted)',
    textTransform: 'uppercase' as const,
  },
  infoValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    color: 'var(--ink)',
    letterSpacing: '0.06em',
  },
  playRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  playBtn: {
    background: 'var(--ink)',
    border: '1.5px solid var(--ink)',
    borderRadius: 0,
    color: 'var(--bg)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.15em',
    padding: '8px 20px',
    transition: 'background 0.15s',
  },
  playBtnStop: {
    background: 'var(--accent-2)',
    border: '1.5px solid var(--accent-2)',
  },
} as const
