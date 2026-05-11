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

  // ── Match state ────────────────────────────────────────────
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(new Set())
  const [matchMode, setMatchMode] = useState(false)
  const [accuracy, setAccuracy] = useState<{ pct: number; correct: number; total: number } | null>(null)
  const [matchLiveNotes, setMatchLiveNotes] = useState<Set<number>>(new Set())

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

      // Build noteCallbacks from zones marked for playback (usage 'playback' or 'both').
      // The audio engine will use these instead of its internal Tone PolySynth.
      const noteCallbacks = {
        noteOn: (midi: number, velocity: number) => {
          const activeZones = zonesRef.current.filter(
            (z) => (z.usage ?? 'both') !== 'midi' && midi >= z.minNote && midi <= z.maxNote
          )
          activeZones.forEach((z) => noteOnRef.current(z, midi, velocity))
        },
        noteOff: (midi: number) => {
          const activeZones = zonesRef.current.filter(
            (z) => (z.usage ?? 'both') !== 'midi' && midi >= z.minNote && midi <= z.maxNote
          )
          activeZones.forEach((z) => noteOffRef.current(z, midi))
        },
        allOff: () => allNotesOffRef.current(),
      }

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
        {fileName && <span className="sp-filename">{fileName}</span>}
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
