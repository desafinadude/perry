/**
 * SheetPlayer – MusicXML load, playback and match mode.
 * Ported from perryplay/src/App.jsx.
 * MIDI notes are fed in from the parent (perry App.tsx) via the imperative
 * handle so that perry's existing useMidi hook remains the single source of truth.
 */

import React, {
  useState, useEffect, useRef, useCallback,
  forwardRef, useImperativeHandle,
} from 'react'
import { flushSync } from 'react-dom'
import { FolderOpen } from 'lucide-react'
import { Piano } from './Piano'
import type { Zone } from '../types'
// @ts-ignore
import { parseMusicXml } from '../utils/musicXmlParser'
// @ts-ignore
import { startPlayback, stopPlayback, pausePlayback, playCountIn } from '../utils/audioEngine'
// @ts-ignore – JSX components
import SheetMusicOSMD from './SheetMusicOSMD'
// @ts-ignore
import SheetTransportControls from './SheetTransportControls'
import {
  SCALES, CATEGORIES, CATEGORY_LABELS, ROOT_NAMES, rootPcToMidi,
  type ScaleEntry,
} from '../data/scales'
import { generateScaleMusicXml } from '../utils/scaleXmlGenerator'

// ── Scale string transposition helper ──────────────────────────────────────
const NOTE_PC_MAP: Record<string, number> = {
  'C': 0, 'D♭': 1, 'D': 2, 'E♭': 3, 'E': 4, 'F': 5,
  'G♭': 6, 'G': 7, 'A♭': 8, 'A': 9, 'B♭': 10, 'B': 11,
  'C♯': 1, 'D♯': 3, 'F♯': 6, 'G♯': 8, 'A♯': 10,
}
const ROOT_FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

function transposeStr(scaleInC: string, rootPc: number): string {
  if (rootPc === 0) return scaleInC
  return scaleInC.replace(/([A-G][♭♯]?)(\([^)]*\))?/g, (match, note, paren) => {
    const pc = NOTE_PC_MAP[note]
    if (pc === undefined) return match
    return ROOT_FLAT_NAMES[(pc + rootPc) % 12] + (paren ?? '')
  })
}

export interface SheetPlayerHandle {
  /** Called by App.tsx handleNoteOn to feed live MIDI into match mode */
  onMidiNoteOn: (note: number) => void
  /** Called by App.tsx handleNoteOff */
  onMidiNoteOff: (note: number) => void
}

interface SheetPlayerProps {
  /** All configured zones from App – used to route sheet-playback audio */
  zones: Zone[]
  noteOn: (zone: Zone, note: number, velocity: number) => void
  noteOff: (zone: Zone, note: number) => void
  allNotesOff: () => void
}

export const SheetPlayer = forwardRef<SheetPlayerHandle, SheetPlayerProps>(
  function SheetPlayer({ zones, noteOn, noteOff, allNotesOff }, ref) {

  // ── File / data state ──────────────────────────────────────
  const [xmlString, setXmlString] = useState<string | null>(null)
  const [audioData, setAudioData] = useState<any>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // ── Transport state ────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [tempo, setTempo] = useState(100)
  const [loop, setLoop] = useState(false)
  const [loopBarStart, setLoopBarStart] = useState<number | null>(null)
  const [loopBarEnd, setLoopBarEnd] = useState<number | null>(null)
  const [soloMode, setSoloMode] = useState('both')
  const [metronome, setMetronome] = useState(true)
  const [countIn, setCountIn] = useState(true)
  const [countInBeat, setCountInBeat] = useState(0)
  // Layer of zones to use for sheet playback audio
  const [playbackLayer, setPlaybackLayer] = useState<'playback' | 'both' | 'all'>('playback')

  // ── Match state ────────────────────────────────────────────
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(new Set())
  const [matchMode, setMatchMode] = useState(false)
  const [accuracy, setAccuracy] = useState<{ pct: number; correct: number; total: number } | null>(null)
  const [matchLiveNotes, setMatchLiveNotes] = useState<Set<number>>(new Set())

  // ── Scale mode state ───────────────────────────────────────
  type ScaleCat = typeof CATEGORIES[number]
  type OctaveMode = 'rh' | 'lh' | 'both'
  const [scaleMode, setScaleMode] = useState(false)
  const [scaleCat, setScaleCat] = useState<ScaleCat>('major_modes')
  const [scaleRootPc, setScaleRootPc] = useState(0)
  const [scaleIdx, setScaleIdx] = useState(0)
  const [scaleOctave, setScaleOctave] = useState<OctaveMode>('rh')

  // ── Refs ────────────────────────────────────────────────────
  const audioDataRef = useRef<any>(null)
  const tempoRef = useRef(100)
  const loopRef = useRef(false)
  const loopBarStartRef = useRef<number | null>(null)
  const loopBarEndRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const matchModeRef = useRef(false)
  const currentTimeRef = useRef(0)
  const loopRestartingRef = useRef(false)
  const handlePlayRef = useRef<((seekTime?: number | null) => void) | null>(null)
  const osmdRef = useRef<any>(null)
  const metronomeRef = useRef(false)
  const countInRef = useRef(false)
  const isCountingRef = useRef(false)
  const activeMidiNotesKeyRef = useRef('')
  // Keep latest prop refs so playback callbacks always see current values
  const zonesRef = useRef<Zone[]>(zones)
  const noteOnRef = useRef(noteOn)
  const noteOffRef = useRef(noteOff)
  const allNotesOffRef = useRef(allNotesOff)
  useEffect(() => { zonesRef.current = zones }, [zones])
  useEffect(() => { noteOnRef.current = noteOn }, [noteOn])
  useEffect(() => { noteOffRef.current = noteOff }, [noteOff])
  useEffect(() => { allNotesOffRef.current = allNotesOff }, [allNotesOff])

  useEffect(() => { metronomeRef.current = metronome }, [metronome])
  useEffect(() => { countInRef.current = countIn }, [countIn])
  useEffect(() => { tempoRef.current = tempo }, [tempo])
  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { loopBarStartRef.current = loopBarStart }, [loopBarStart])
  useEffect(() => { loopBarEndRef.current = loopBarEnd }, [loopBarEnd])
  useEffect(() => { matchModeRef.current = matchMode }, [matchMode])

  // Auto-select 'playback' layer (no-op — just keeping effect for future hooks)
  useEffect(() => {
    // If no zones exist with layer='playback', fall back gracefully in noteCallbacks
  }, [zones])

  // ── Expose MIDI entry points to parent ─────────────────────
  useImperativeHandle(ref, () => ({
    onMidiNoteOn(note: number) {
      if (!matchModeRef.current) return
      flushSync(() => setMatchLiveNotes(prev => new Set([...prev, note])))
      osmdRef.current?.matchNote(note)
    },
    onMidiNoteOff(note: number) {
      setMatchLiveNotes(prev => { const n = new Set(prev); n.delete(note); return n })
    },
  }), [])

  // ── Helper: measure → display time ─────────────────────────
  const measureToDisplayTime = useCallback((measureIdx: number) => {
    const data = audioDataRef.current
    if (!data) return 0
    const rawTime = measureIdx * data.beatsPerMeasure / data.bpm * 60
    return rawTime / (tempoRef.current / 100)
  }, [])

  // ── Active notes at display time ───────────────────────────
  const getActiveAtTime = useCallback((displayTime: number) => {
    const data = audioDataRef.current
    if (!data) return new Set<number>()
    const scale = tempoRef.current / 100
    const midiNotes = new Set<number>()
    for (const evt of data.timeline) {
      const start = evt.time / scale
      const end = (evt.time + evt.duration) / scale
      if (displayTime >= start - 0.03 && displayTime < end + 0.03) {
        evt.midiNotes.forEach((m: number) => midiNotes.add(m))
      }
    }
    return midiNotes
  }, [])

  // ── Playback ────────────────────────────────────────────────
  const handlePlay = useCallback((seekTime: number | null = null) => {
    const data = audioDataRef.current
    if (!data || isCountingRef.current) return

    const scale = tempoRef.current / 100
    let uiStart = seekTime ?? currentTimeRef.current

    if (seekTime === null && loopRef.current && loopBarStartRef.current !== null) {
      const lsTime = measureToDisplayTime(loopBarStartRef.current)
      const leTime = loopBarEndRef.current !== null
        ? measureToDisplayTime(loopBarEndRef.current + 1) : Infinity
      if (uiStart < lsTime || uiStart >= leTime - 0.05) uiStart = lsTime
    }

    if (countInRef.current && seekTime === null && !isPlayingRef.current) {
      isCountingRef.current = true
      setCountInBeat(0)
      playCountIn(
        data.bpm, data.beatsPerMeasure || 4, scale,
        (beat: number) => setCountInBeat(beat),
        () => {
          isCountingRef.current = false
          setCountInBeat(0)
          if (isPlayingRef.current) return
          doStart(uiStart)
        },
      )
      return
    }

    doStart(uiStart)

    function doStart(uiStartTime: number) {
      osmdRef.current?.clearColoring()
      const rawStart = uiStartTime * scale
      const metOpts = metronomeRef.current
        ? { enabled: true, bpm: data.bpm, beatsPerMeasure: data.beatsPerMeasure || 4 }
        : null
      const rawLoopEnd = (loopRef.current && loopBarEndRef.current !== null)
        ? measureToDisplayTime(loopBarEndRef.current + 1) * scale
        : null

      // Route sheet playback through all zones matching the selected layer.
      // 'playback' → zones tagged layer='playback'
      // 'both'     → zones tagged layer='both'
      // 'all'      → every zone
      // Fallback: if no matching zones, use all zones.
      const allZones = zonesRef.current
      const layerZones = playbackLayer === 'all'
        ? allZones
        : allZones.filter(z => (z.layer ?? 'both') === playbackLayer)
      const activeZones = layerZones.length > 0 ? layerZones : allZones
      const noteCallbacks = activeZones.length > 0 ? {
        noteOn: (midi: number, velocity: number) => activeZones.forEach(z => noteOnRef.current(z, midi, velocity)),
        noteOff: (midi: number) => activeZones.forEach(z => noteOffRef.current(z, midi)),
        allOff: () => allNotesOffRef.current(),
      } : null

      startPlayback(data.timeline, scale, rawStart, data.totalDuration, (rawTime: number) => {
        const uiTime = rawTime / scale
        currentTimeRef.current = uiTime
        setCurrentTime(uiTime)

        const newNotes = getActiveAtTime(uiTime)
        const newKey = [...newNotes].sort().join(',')
        if (newKey !== activeMidiNotesKeyRef.current) {
          activeMidiNotesKeyRef.current = newKey
          setActiveMidiNotes(newNotes)
        }

        osmdRef.current?.syncToTime(uiTime)

        const rawTotal = data.totalDuration
        if (loopRef.current) {
          const leTime = loopBarEndRef.current !== null
            ? measureToDisplayTime(loopBarEndRef.current + 1)
            : rawTotal / scale
          const lsTime = loopBarStartRef.current !== null
            ? measureToDisplayTime(loopBarStartRef.current) : 0

          if (uiTime >= leTime - 0.08 && !loopRestartingRef.current) {
            loopRestartingRef.current = true
            stopPlayback()
            setTimeout(() => {
              loopRestartingRef.current = false
              if (loopRef.current && isPlayingRef.current) {
                // Ensure the visual cursor jumps to the loop start measure so
                // graphics follow the repeated audio.
                if (loopBarStartRef.current !== null) {
                  try { osmdRef.current?.jumpToMeasure(loopBarStartRef.current) } catch (_) {}
                }
                handlePlayRef.current?.(lsTime)
              }
            }, 30)
          }
        } else if (uiTime >= rawTotal / scale - 0.1) {
          setIsPlaying(false)
          isPlayingRef.current = false
          osmdRef.current?.resetCursor()
        }
      }, metOpts, rawLoopEnd, noteCallbacks)

      setIsPlaying(true)
      isPlayingRef.current = true
    }
  }, [getActiveAtTime, measureToDisplayTime])

  useEffect(() => { handlePlayRef.current = handlePlay }, [handlePlay])

  const handlePause = useCallback(() => {
    pausePlayback()
    setIsPlaying(false)
    isPlayingRef.current = false
  }, [])

  const handleStop = useCallback(() => {
    stopPlayback()
    setIsPlaying(false)
    isPlayingRef.current = false
    isCountingRef.current = false
    loopRestartingRef.current = false
    setCountInBeat(0)
    setCurrentTime(0)
    currentTimeRef.current = 0
    setActiveMidiNotes(new Set())
    setAccuracy(null)
    osmdRef.current?.clearColoring()
    osmdRef.current?.resetCursor()
  }, [])

  const handleSeek = useCallback((time: number) => {
    const wasPlaying = isPlayingRef.current
    stopPlayback()
    loopRestartingRef.current = false
    setCurrentTime(time)
    currentTimeRef.current = time
    setActiveMidiNotes(new Set())
    activeMidiNotesKeyRef.current = ''
    osmdRef.current?.syncToTime(time)
    if (wasPlaying) setTimeout(() => handlePlayRef.current?.(time), 50)
  }, [])

  // ── Scale auto-generation ───────────────────────────────────
  // Whenever scale mode is active and any selector changes, regenerate XML and
  // feed it through the same parseMusicXml pipeline as a normal file load.
  useEffect(() => {
    if (!scaleMode) return
    const scalesInCat = SCALES.filter((s) => s.category === scaleCat)
    const safeIdx = Math.min(scaleIdx, scalesInCat.length - 1)
    const scale: ScaleEntry = scalesInCat[safeIdx]

    const rootMidi = rootPcToMidi(scaleRootPc, scaleOctave === 'lh' ? 3 : 4)
    const rootName = ROOT_NAMES[scaleRootPc]

    // Transpose chord/scale strings from C to selected root
    const chordInRoot = transposeStr(scale.chordInC, scaleRootPc)
    const scaleInRoot = transposeStr(scale.scaleInC, scaleRootPc)
    const altStr = scale.altSymbols.length
      ? scale.altSymbols.map((s) => s.replace(/^C/, rootName)).join('  ·  ')
      : ''

    const titleStr = `${scale.symbol.replace(/^C/, rootName)}  —  ${scale.name}`
    const subtitleStr = `Formula: ${scale.wh}   ·   Chord: ${chordInRoot}`
    const annotationStr = altStr ? `Also: ${altStr}` : ''

    const xml = generateScaleMusicXml(rootMidi, scale.intervals, {
      tempo,
      octaveMode: scaleOctave,
      numOctaves: 2,
      title: titleStr,
      subtitle: subtitleStr,
      annotation: annotationStr,
    })

    resetPlayback()
    try {
      const audioInfo = parseMusicXml(xml)
      if (!audioInfo) return
      audioDataRef.current = audioInfo
      setAudioData(audioInfo)
      setXmlString(xml)
      setFileName(null) // no file name in scale mode
    } catch (e) {
      console.error('Scale XML parse error', e)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleMode, scaleCat, scaleRootPc, scaleIdx, scaleOctave, tempo])

  // ── File loading ────────────────────────────────────────────
  const resetPlayback = useCallback(() => {
    stopPlayback()
    setIsPlaying(false)
    isPlayingRef.current = false
    loopRestartingRef.current = false
    setCurrentTime(0)
    currentTimeRef.current = 0
    setActiveMidiNotes(new Set())
    setLoopBarStart(null)
    setLoopBarEnd(null)
  }, [])

  const handleFileLoad = useCallback((arrayBuffer: ArrayBuffer, name: string) => {
    resetPlayback()
    setFileName(name)
    try {
      if (name.endsWith('.mxl')) {
        alert('.mxl files are compressed MusicXML. Please export as uncompressed .xml.')
        return
      }
      const decoder = new TextDecoder('utf-8')
      const text = decoder.decode(new Uint8Array(arrayBuffer))
      const audioInfo = parseMusicXml(text)
      if (!audioInfo) { alert('No notes found in MusicXML file'); return }
      audioDataRef.current = audioInfo
      setAudioData(audioInfo)
      setXmlString(text)
    } catch (e: any) {
      console.error(e)
      alert('Failed to parse MusicXML: ' + e.message)
    }
  }, [resetPlayback])

  // ── Measure click (loop markers) ────────────────────────────
  const handleMeasureClick = useCallback((measureIdx: number, shiftKey: boolean) => {
    if (shiftKey) {
      setLoopBarEnd(() => {
        const newEnd = measureIdx
        const start = loopBarStartRef.current
        if (start !== null && newEnd < start) { setLoopBarStart(newEnd); return start }
        return newEnd
      })
    } else {
      setLoopBarStart(measureIdx)
      setLoopBarEnd(prev => (prev !== null && prev < measureIdx ? null : prev))
    }
    setLoop(true)
  }, [])

  // ── Match mode: reset live notes when toggled off ──────────
  useEffect(() => {
    if (!matchMode) {
      setMatchLiveNotes(new Set())
      setAccuracy(null)
      osmdRef.current?.clearColoring()
    }
  }, [matchMode])

  // ── Derived ─────────────────────────────────────────────────
  const displayDuration = audioData ? audioData.totalDuration / (tempo / 100) : 0
  const [osmdTotalMeasures, setOsmdTotalMeasures] = useState(0)

  return (
    <div className="sheet-player">
      {/* ── Toolbar ── */}
      <div className="sheet-toolbar">
        {/* File / Scale mode toggle */}
        <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
          <button
            onClick={() => { setScaleMode(false); resetPlayback(); setXmlString(null); setAudioData(null); setFileName(null) }}
            style={{ ...modeTabStyle, ...(scaleMode ? {} : modeTabActiveStyle) }}
          >
            FILE
          </button>
          <button
            onClick={() => setScaleMode(true)}
            style={{ ...modeTabStyle, ...(scaleMode ? modeTabActiveStyle : {}) }}
          >
            ♩ SCALE
          </button>
        </div>

        {scaleMode ? (
          /* ── Scale picker controls ── */
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1, flexWrap: 'wrap' }}>
            {/* Category */}
            <div style={scaleCtrlGroup}>
              <span style={scaleLabel}>CATEGORY</span>
              <select
                value={scaleCat}
                onChange={(e) => { setScaleCat(e.target.value as any); setScaleIdx(0) }}
                style={scaleSelect}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>

            <div style={scaleDivider} />

            {/* Root */}
            <div style={scaleCtrlGroup}>
              <span style={scaleLabel}>ROOT</span>
              <select
                value={scaleRootPc}
                onChange={(e) => setScaleRootPc(Number(e.target.value))}
                style={{ ...scaleSelect, minWidth: 52 }}
              >
                {ROOT_NAMES.map((name, pc) => (
                  <option key={pc} value={pc}>{name}</option>
                ))}
              </select>
            </div>

            <div style={scaleDivider} />

            {/* Scale navigator */}
            {(() => {
              const scalesInCat = SCALES.filter((s) => s.category === scaleCat)
              const safeIdx = Math.min(scaleIdx, scalesInCat.length - 1)
              return (
                <div style={scaleCtrlGroup}>
                  <span style={scaleLabel}>SCALE  {safeIdx + 1}/{scalesInCat.length}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button onClick={() => setScaleIdx((i) => Math.max(0, i - 1))} style={arrowBtnStyle}>◀</button>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 220, textAlign: 'center' as const }}>
                      {scalesInCat[safeIdx]?.symbol.replace(/^C/, ROOT_NAMES[scaleRootPc])}
                      {' · '}
                      {scalesInCat[safeIdx]?.name}
                    </span>
                    <button onClick={() => setScaleIdx((i) => Math.min(SCALES.filter((s) => s.category === scaleCat).length - 1, i + 1))} style={arrowBtnStyle}>▶</button>
                  </div>
                </div>
              )
            })()}

            <div style={scaleDivider} />

            {/* Hands */}
            <div style={scaleCtrlGroup}>
              <span style={scaleLabel}>HANDS</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['rh', 'lh', 'both'] as const).map((m) => (
                  <button key={m} onClick={() => setScaleOctave(m)}
                    style={{ ...toggleBtnStyle, ...(scaleOctave === m ? toggleBtnActiveStyle : {}) }}>
                    {m === 'rh' ? 'RH' : m === 'lh' ? 'LH' : 'BOTH'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── File mode controls ── */
          <>
            {fileName && <span className="sp-filename">{fileName}</span>}

            {/* Layer picker for sheet playback audio */}
            {zones.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted)' }}>
                  LAYER
                </span>
                <select
                  value={playbackLayer}
                  onChange={e => setPlaybackLayer(e.target.value as 'playback' | 'both' | 'all')}
                  style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 0, color: 'var(--ink)', fontSize: 11,
                    padding: '3px 6px', fontFamily: 'var(--font-mono)',
                  }}
                  title="Which zone layer sounds during sheet playback"
                >
                  <option value="playback">PLAY zones only</option>
                  <option value="both">BOTH zones only</option>
                  <option value="all">All zones</option>
                </select>
              </div>
            )}

            <label className="sp-load-btn">
              <FolderOpen size={13} strokeWidth={2} />
              LOAD MUSICXML
              <input
                type="file" accept=".xml,.musicxml"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) {
                    const r = new FileReader()
                    r.onload = ev => handleFileLoad(ev.target!.result as ArrayBuffer, f.name)
                    r.readAsArrayBuffer(f)
                    e.target.value = ''
                  }
                }}
              />
            </label>
          </>
        )}
      </div>

      {!xmlString ? (
        <div className="sp-empty">
          <div className="sp-empty-icon">♪</div>
          <div className="sp-empty-title">LOAD A MUSICXML FILE</div>
          <div className="sp-empty-hint">Accepts .xml and .musicxml</div>
        </div>
      ) : (
        <div className="sp-player-layout">
          {/* Sheet area */}
          <div className="sp-sheet-area">
            <SheetMusicOSMD
              ref={osmdRef}
              xmlString={xmlString}
              // Pass a tempo-scaled BPM so OSMD's timeline is built in the same
              // display-time units used by the audio engine (uiTime = raw / scale).
              // This keeps the visual cursor in sync when tempo != 100%.
              bpm={audioData ? audioData.bpm * (tempo / 100) : undefined}
              measureOrder={audioData?.measureOrder ?? null}
              loopStart={loopBarStart}
              loopEnd={loopBarEnd}
              stretchToFit={scaleMode}
              matchMode={matchMode}
              isPlaying={isPlaying}
              onAccuracy={(pct: number, correct: number, total: number) =>
                setAccuracy({ pct, correct, total })}
              onMeasureClick={handleMeasureClick}
              onReady={(tl: any[]) => {
                const max = tl.length > 0 ? tl[tl.length - 1].measureIdx + 1 : 0
                setOsmdTotalMeasures(max)
              }}
            />
            {matchMode && (
              <div className="sp-accuracy-sidebar">
                <div className="sp-accuracy-track">
                  <div
                    className="sp-accuracy-fill"
                    style={{
                      height: `${accuracy ? accuracy.pct : 100}%`,
                      background: !accuracy || accuracy.pct >= 80
                        ? 'var(--accent-1)'
                        : accuracy.pct >= 50 ? '#e08c00' : 'var(--accent-2)',
                    }}
                  />
                </div>
                <div className="sp-accuracy-label">
                  {accuracy ? `${accuracy.pct}%` : '100%'}
                </div>
              </div>
            )}
          </div>

          {/* Bottom panel: piano + transport */}
          <div className="sp-bottom-panel">
            <Piano
              zones={[]}
              activeNotes={activeMidiNotes}
              highlightNotes={matchMode ? matchLiveNotes : undefined}
              height={60}
            />
            <SheetTransportControls
              isPlaying={isPlaying}
              isCounting={countInBeat > 0}
              countInBeat={countInBeat}
              beatsPerMeasure={audioData?.beatsPerMeasure ?? 4}
              onPlay={() => handlePlay()}
              onPause={handlePause}
              onStop={handleStop}
              metronome={metronome}
              onMetronomeToggle={() => setMetronome(m => !m)}
              countIn={countIn}
              onCountInToggle={() => setCountIn(c => !c)}
              tempo={tempo}
              onTempoChange={(t: number) => {
                setTempo(t)
                tempoRef.current = t
                if (isPlayingRef.current) {
                  const rawNow = currentTimeRef.current * (tempo / 100)
                  stopPlayback()
                  setTimeout(() => handlePlayRef.current?.(rawNow / t * 100), 30)
                }
              }}
              loop={loop}
              onLoopToggle={() => {
                setLoop(l => {
                  const next = !l
                  if (next && loopBarStartRef.current === null) {
                    setLoopBarStart(0)
                    setLoopBarEnd(osmdTotalMeasures > 0 ? osmdTotalMeasures - 1 : 0)
                  }
                  return next
                })
              }}
              loopStart={loopBarStart}
              loopEnd={loopBarEnd}
              onLoopRangeChange={(s: number | null, e: number | null) => {
                setLoopBarStart(s); setLoopBarEnd(e)
              }}
              totalMeasures={osmdTotalMeasures}
              soloMode={soloMode}
              onSoloChange={(mode: string) => {
                setSoloMode(mode)
                if (isPlayingRef.current) {
                  const t = currentTimeRef.current
                  stopPlayback()
                  setTimeout(() => handlePlayRef.current?.(t), 30)
                }
              }}
              matchMode={matchMode}
              onMatchToggle={() => { setMatchMode(m => !m); setAccuracy(null) }}
              currentTime={currentTime}
              totalDuration={displayDuration}
              onSeek={handleSeek}
              bpm={audioData?.bpm}
            />
          </div>
        </div>
      )}
    </div>
  )
})

// ── Style constants for scale mode toolbar ─────────────────────────────────
const modeTabStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1.5px solid var(--border)',
  borderRadius: 0,
  color: 'var(--muted)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  padding: '5px 12px',
}
const modeTabActiveStyle: React.CSSProperties = {
  background: 'var(--ink)',
  border: '1.5px solid var(--ink)',
  color: 'var(--bg)',
}
const scaleCtrlGroup: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 4,
  padding: '6px 12px',
}
const scaleLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.15em',
  color: 'var(--muted)',
  textTransform: 'uppercase',
}
const scaleSelect: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '3px 6px',
  cursor: 'pointer',
  minWidth: 130,
}
const scaleDivider: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'var(--border)',
  flexShrink: 0,
}
const arrowBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1.5px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '3px 8px',
}
const toggleBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1.5px solid var(--border)',
  borderRadius: 0,
  color: 'var(--muted)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  padding: '3px 9px',
}
const toggleBtnActiveStyle: React.CSSProperties = {
  background: 'var(--ink)',
  border: '1.5px solid var(--ink)',
  color: 'var(--bg)',
}
