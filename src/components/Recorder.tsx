import { useState, useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { useMetronome } from '../hooks/useMetronome'

interface RecordedNote {
  note: number
  velocity: number
  timestamp: number
  duration?: number
}

export interface RecorderHandle {
  recordNoteOn: (note: number, velocity: number) => void
  recordNoteOff: (note: number) => void
}

interface Props {
  onPlayNoteOn?: (note: number, velocity: number) => void
  onPlayNoteOff?: (note: number) => void
}

// Simple MIDI file parser
function parseMidiFile(buffer: ArrayBuffer): RecordedNote[] {
  const data = new Uint8Array(buffer)
  let offset = 0
  
  // Read 32-bit big-endian
  const read32 = () => {
    const val = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    offset += 4
    return val
  }
  
  // Read 16-bit big-endian
  const read16 = () => {
    const val = (data[offset] << 8) | data[offset + 1]
    offset += 2
    return val
  }
  
  // Read variable-length quantity
  const readVarLen = () => {
    let val = 0
    let byte
    do {
      byte = data[offset++]
      val = (val << 7) | (byte & 0x7F)
    } while (byte & 0x80)
    return val
  }
  
  // Check header
  const headerType = String.fromCharCode(data[0], data[1], data[2], data[3])
  if (headerType !== 'MThd') throw new Error('Invalid MIDI file: missing MThd header')
  
  offset = 4
  const headerLength = read32()
  const format = read16()
  const tracks = read16()
  const division = read16()
  
  const ticksPerQuarterNote = division & 0x7FFF
  const microsecondsPerQuarterNote = 500000 // Default: 120 BPM
  const microsecondsPerTick = microsecondsPerQuarterNote / ticksPerQuarterNote
  
  const notes: RecordedNote[] = []
  const activeNotes = new Map<number, { timestamp: number; velocity: number }>()
  
  // Parse tracks
  for (let t = 0; t < tracks; t++) {
    const trackType = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
    if (trackType !== 'MTrk') throw new Error('Invalid track header')
    
    offset += 4
    const trackLength = read32()
    const trackEnd = offset + trackLength
    
    let currentTick = 0
    let runningStatus = 0
    
    while (offset < trackEnd) {
      const deltaTime = readVarLen()
      currentTick += deltaTime
      
      let status = data[offset]
      
      // Handle running status
      if (status < 0x80) {
        status = runningStatus
      } else {
        offset++
        runningStatus = status
      }
      
      const statusType = status & 0xF0
      
      if (statusType === 0x90) { // Note On
        const note = data[offset++]
        const velocity = data[offset++]
        const timestamp = (currentTick * microsecondsPerTick) / 1000 // Convert to ms
        
        if (velocity > 0) {
          activeNotes.set(note, { timestamp, velocity })
        } else {
          // Velocity 0 = Note Off
          const active = activeNotes.get(note)
          if (active) {
            notes.push({
              note,
              velocity: active.velocity,
              timestamp: active.timestamp,
              duration: timestamp - active.timestamp,
            })
            activeNotes.delete(note)
          }
        }
      } else if (statusType === 0x80) { // Note Off
        const note = data[offset++]
        offset++ // velocity (ignored)
        const timestamp = (currentTick * microsecondsPerTick) / 1000
        
        const active = activeNotes.get(note)
        if (active) {
          notes.push({
            note,
            velocity: active.velocity,
            timestamp: active.timestamp,
            duration: timestamp - active.timestamp,
          })
          activeNotes.delete(note)
        }
      } else if (statusType === 0xB0 || statusType === 0xE0) { // Control Change or Pitch Bend
        offset += 2
      } else if (statusType === 0xC0 || statusType === 0xD0) { // Program Change or Channel Pressure
        offset += 1
      } else if (status === 0xFF) { // Meta event
        const metaType = data[offset++]
        const metaLength = readVarLen()
        offset += metaLength
      } else if (status === 0xF0 || status === 0xF7) { // SysEx
        const sysexLength = readVarLen()
        offset += sysexLength
      }
    }
  }
  
  return notes.sort((a, b) => a.timestamp - b.timestamp)
}


export const Recorder = forwardRef<RecorderHandle, Props>((props, ref) => {
  const { onPlayNoteOn, onPlayNoteOff } = props
  const [isRecording, setIsRecording] = useState(false)
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [showPianoRoll, setShowPianoRoll] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1.0) // For horizontal zoom
  const startTimeRef = useRef<number>(0)
  const activeNotesRef = useRef<Map<number, number[]>>(new Map()) // note -> array of start times (for overlapping notes)
  const playbackTimeoutsRef = useRef<number[]>([]) // Store timeout IDs for cleanup
  const midiFileInputRef = useRef<HTMLInputElement>(null)

  // Metronome
  const metronome = useMetronome()

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all pending timeouts
      playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
      playbackTimeoutsRef.current = []
      metronome.stop()
    }
  }, [metronome])

  const handleRecord = useCallback(() => {
    if (!isRecording) {
      // Cancel any ongoing playback before recording
      playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
      playbackTimeoutsRef.current = []
      
      // Start metronome first if enabled (to establish timing reference)
      if (metronome.isEnabled) {
        metronome.start()
        // Use metronome's start time as recording reference
        startTimeRef.current = metronome.getStartTime()
      } else {
        startTimeRef.current = performance.now()
      }
      // Start recording
      setIsRecording(true)
      setRecordedNotes([])
      activeNotesRef.current.clear()
    } else {
      // Stop recording and disarm
      setIsRecording(false)
      // Stop metronome
      metronome.stop()
      // Finalize any still-active notes
      const now = performance.now()
      activeNotesRef.current.forEach((starts, note) => {
        starts.forEach(startTime => {
          setRecordedNotes(prev => prev.map(n => 
            n.note === note && n.timestamp === startTime && !n.duration
              ? { ...n, duration: now - startTimeRef.current - startTime }
              : n
          ))
        })
      })
      activeNotesRef.current.clear()
    }
  }, [isRecording, metronome])

  const handleClear = useCallback(() => {
    // Cancel any ongoing playback
    playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
    playbackTimeoutsRef.current = []
    
    setRecordedNotes([])
    setIsRecording(false)
    setIsPlaying(false)
    activeNotesRef.current.clear()
    metronome.stop()
  }, [metronome])

  const handleLoadMidi = useCallback(() => {
    midiFileInputRef.current?.click()
  }, [])

  const handleMidiFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    try {
      // Cancel any ongoing playback first
      playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
      playbackTimeoutsRef.current = []
      
      const buffer = await file.arrayBuffer()
      const notes = parseMidiFile(buffer)
      setRecordedNotes(notes)
      setIsRecording(false)
      setIsPlaying(false)
      activeNotesRef.current.clear()
      metronome.stop()
    } catch (error) {
      console.error('Failed to parse MIDI file:', error)
      alert('Failed to load MIDI file. Please make sure it\'s a valid MIDI file.')
    }
  }, [metronome])

  const handlePlay = useCallback(() => {
    if (recordedNotes.length === 0 || !onPlayNoteOn || !onPlayNoteOff) return
    
    // Cancel any previous playback timeouts
    playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
    playbackTimeoutsRef.current = []
    
    setIsPlaying(true)
    
    // Start metronome if enabled (synced with playback start)
    if (metronome.isEnabled) {
      metronome.start()
    }
    
    // Sort notes by timestamp
    const sortedNotes = [...recordedNotes].sort((a, b) => a.timestamp - b.timestamp)
    
    // Schedule all note events
    sortedNotes.forEach((note) => {
      // Note On
      const onId = window.setTimeout(() => {
        onPlayNoteOn(note.note, note.velocity)
      }, note.timestamp)
      playbackTimeoutsRef.current.push(onId)
      
      // Note Off
      if (note.duration !== undefined) {
        const offId = window.setTimeout(() => {
          onPlayNoteOff(note.note)
        }, note.timestamp + note.duration)
        playbackTimeoutsRef.current.push(offId)
      }
    })
    
    // Auto-stop when done
    const totalDuration = Math.max(...sortedNotes.map(n => n.timestamp + (n.duration || 0)))
    const stopId = window.setTimeout(() => {
      setIsPlaying(false)
      metronome.stop()
      playbackTimeoutsRef.current = []
    }, totalDuration)
    playbackTimeoutsRef.current.push(stopId)
  }, [recordedNotes, onPlayNoteOn, onPlayNoteOff, metronome])

  const handleStop = useCallback(() => {
    // Cancel all scheduled timeouts
    playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
    playbackTimeoutsRef.current = []
    
    setIsPlaying(false)
    metronome.stop()
  }, [metronome])

  const handleSeek = useCallback((timeMs: number) => {
    if (recordedNotes.length === 0 || !onPlayNoteOn || !onPlayNoteOff) return
    
    // Cancel any previous playback timeouts
    playbackTimeoutsRef.current.forEach(id => window.clearTimeout(id))
    playbackTimeoutsRef.current = []
    
    // Stop current playback if playing
    if (isPlaying) {
      setIsPlaying(false)
      metronome.stop()
    }
    
    // Start playback from the seeked position
    setIsPlaying(true)
    
    // Start metronome if enabled
    if (metronome.isEnabled) {
      metronome.start()
    }
    
    // Sort notes by timestamp
    const sortedNotes = [...recordedNotes].sort((a, b) => a.timestamp - b.timestamp)
    
    // Filter notes that start after the seek time
    const futureNotes = sortedNotes.filter(n => n.timestamp >= timeMs)
    
    // Schedule future note events (adjusted for seek position)
    futureNotes.forEach((note) => {
      const adjustedTime = note.timestamp - timeMs
      
      // Note On
      const onId = window.setTimeout(() => {
        onPlayNoteOn(note.note, note.velocity)
      }, adjustedTime)
      playbackTimeoutsRef.current.push(onId)
      
      // Note Off
      if (note.duration !== undefined) {
        const offId = window.setTimeout(() => {
          onPlayNoteOff(note.note)
        }, adjustedTime + note.duration)
        playbackTimeoutsRef.current.push(offId)
      }
    })
    
    // Auto-stop when done
    const totalDuration = Math.max(...sortedNotes.map(n => n.timestamp + (n.duration || 0))) - timeMs
    if (totalDuration > 0) {
      const stopId = window.setTimeout(() => {
        setIsPlaying(false)
        metronome.stop()
        playbackTimeoutsRef.current = []
      }, totalDuration)
      playbackTimeoutsRef.current.push(stopId)
    }
  }, [recordedNotes, onPlayNoteOn, onPlayNoteOff, isPlaying, metronome])

  const handleExport = useCallback(() => {
    if (recordedNotes.length === 0) return
    
    // Create a simple MIDI file format 0 (single track)
    // This is a basic implementation - could be enhanced with a proper MIDI library
    
    // MIDI file structure:
    // Header chunk: MThd + length(6) + format(0) + tracks(1) + division(480 ticks per quarter note)
    // Track chunk: MTrk + length + events
    
    const events: number[] = []
    
    // Tempo: 120 BPM = 500000 microseconds per quarter note
    // Meta event: FF 51 03 [tempo bytes]
    events.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20) // Delta time 0, set tempo
    
    // Convert recorded notes to MIDI events with delta times
    const sortedNotes = [...recordedNotes].sort((a, b) => a.timestamp - b.timestamp)
    
    let lastTime = 0
    sortedNotes.forEach((note) => {
      // Note On event
      const deltaOn = Math.round((note.timestamp / 1000) * 480) // Convert ms to ticks (480 ppqn)
      const deltaSinceLastEvent = Math.max(0, deltaOn - lastTime)
      events.push(...encodeVariableLength(deltaSinceLastEvent))
      events.push(0x90, note.note, note.velocity) // Note On, channel 0
      lastTime = deltaOn
      
      // Note Off event
      if (note.duration !== undefined) {
        const deltaOff = Math.round(note.duration / 1000 * 480)
        events.push(...encodeVariableLength(deltaOff))
        events.push(0x80, note.note, 0) // Note Off, channel 0
        lastTime += deltaOff
      }
    })
    
    // End of track
    events.push(0x00, 0xFF, 0x2F, 0x00)
    
    // Build the MIDI file
    const header = new Uint8Array([
      0x4D, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // Header length (6 bytes)
      0x00, 0x00,             // Format 0
      0x00, 0x01,             // 1 track
      0x01, 0xE0,             // 480 ticks per quarter note
    ])
    
    const trackData = new Uint8Array(events)
    const trackHeader = new Uint8Array([
      0x4D, 0x54, 0x72, 0x6B, // "MTrk"
      (trackData.length >> 24) & 0xFF,
      (trackData.length >> 16) & 0xFF,
      (trackData.length >> 8) & 0xFF,
      trackData.length & 0xFF,
    ])
    
    // Combine all parts
    const midiFile = new Uint8Array(header.length + trackHeader.length + trackData.length)
    midiFile.set(header, 0)
    midiFile.set(trackHeader, header.length)
    midiFile.set(trackData, header.length + trackHeader.length)
    
    // Download the file
    const blob = new Blob([midiFile], { type: 'audio/midi' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `perry-recording-${Date.now()}.mid`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [recordedNotes])
  
  // Helper function to encode variable-length quantities (MIDI format)
  function encodeVariableLength(value: number): number[] {
    if (value === 0) return [0]
    const bytes: number[] = []
    bytes.push(value & 0x7F)
    value >>= 7
    while (value > 0) {
      bytes.unshift((value & 0x7F) | 0x80)
      value >>= 7
    }
    return bytes
  }

  // TODO: Hook this up to actual MIDI note events from parent
  const recordNoteOn = useCallback((note: number, velocity: number) => {
    if (!isRecording) return
    const timestamp = performance.now() - startTimeRef.current
    
    // Track this note start time
    const starts = activeNotesRef.current.get(note) || []
    starts.push(timestamp)
    activeNotesRef.current.set(note, starts)
    
    // Add note to recording
    setRecordedNotes(prev => [...prev, { note, velocity, timestamp }])
  }, [isRecording])

  const recordNoteOff = useCallback((note: number) => {
    if (!isRecording) return
    
    // Find and remove the oldest start time for this note
    const starts = activeNotesRef.current.get(note)
    if (starts && starts.length > 0) {
      const startTime = starts.shift()! // Remove first (oldest) start time
      
      if (starts.length === 0) {
        activeNotesRef.current.delete(note)
      }
      
      const duration = performance.now() - startTimeRef.current - startTime
      
      // Find the matching note-on event and add duration
      setRecordedNotes(prev => {
        let found = false
        return prev.map(n => {
          if (!found && n.note === note && n.timestamp === startTime && !n.duration) {
            found = true
            return { ...n, duration }
          }
          return n
        })
      })
    }
  }, [isRecording])

  // Expose recording methods to parent via ref
  useImperativeHandle(ref, () => ({
    recordNoteOn,
    recordNoteOff,
  }), [recordNoteOn, recordNoteOff])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 20px',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--bg)',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          letterSpacing: '0.1em',
          color: 'var(--ink)',
        }}>
          RECORDER
        </span>

        <div style={{ flex: 1 }} />

        {/* RECORD button */}
        <button
          onClick={handleRecord}
          style={{
            background: isRecording ? 'var(--accent-2)' : 'var(--accent-1)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.1em',
            padding: '10px 20px',
            minWidth: 100,
          }}
        >
          {isRecording ? '■ STOP' : '● REC'}
        </button>

        {/* CLEAR button */}
        <button
          onClick={handleClear}
          disabled={recordedNotes.length === 0}
          style={{
            background: 'transparent',
            border: '1.5px solid var(--border)',
            color: 'var(--ink)',
            cursor: recordedNotes.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            opacity: recordedNotes.length > 0 ? 1 : 0.5,
          }}
        >
          CLEAR
        </button>

        {/* Stats */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.05em',
          padding: '0 16px',
          borderLeft: '1px solid var(--border)',
        }}>
          {recordedNotes.length} NOTE{recordedNotes.length !== 1 ? 'S' : ''}
        </div>

        {/* EXPORT button */}
        <button
          onClick={handleExport}
          disabled={recordedNotes.length === 0}
          style={{
            background: 'var(--ink)',
            border: 'none',
            color: 'var(--bg)',
            cursor: recordedNotes.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            opacity: recordedNotes.length > 0 ? 1 : 0.5,
          }}
        >
          EXPORT MIDI
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 32, background: 'var(--border)' }} />

        {/* LOAD button */}
        <button
          onClick={handleLoadMidi}
          style={{
            background: 'transparent',
            border: '1.5px solid var(--ink)',
            color: 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
          }}
        >
          LOAD MIDI
        </button>

        {/* PLAY/STOP button */}
        <button
          onClick={isPlaying ? handleStop : handlePlay}
          disabled={recordedNotes.length === 0}
          style={{
            background: isPlaying ? 'var(--accent-1)' : 'transparent',
            border: `1.5px solid ${isPlaying ? 'var(--accent-1)' : 'var(--ink)'}`,
            color: isPlaying ? '#fff' : 'var(--ink)',
            cursor: recordedNotes.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            opacity: recordedNotes.length > 0 ? 1 : 0.5,
          }}
        >
          {isPlaying ? '■ STOP' : '▶ PLAY'}
        </button>

        {/* Piano Roll toggle */}
        <button
          onClick={() => setShowPianoRoll(!showPianoRoll)}
          disabled={recordedNotes.length === 0}
          style={{
            background: showPianoRoll ? 'var(--accent-1)' : 'transparent',
            border: `1.5px solid ${showPianoRoll ? 'var(--accent-1)' : 'var(--border)'}`,
            color: showPianoRoll ? '#fff' : 'var(--ink)',
            cursor: recordedNotes.length > 0 ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
            opacity: recordedNotes.length > 0 ? 1 : 0.5,
          }}
        >
          PIANO ROLL
        </button>

        {/* Zoom controls - only show when piano roll is visible */}
        {showPianoRoll && recordedNotes.length > 0 && (
          <>
            <button
              onClick={() => setZoomLevel(Math.min(4, zoomLevel * 1.5))}
              style={{
                background: 'transparent',
                border: '1.5px solid var(--border)',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                padding: '8px 12px',
              }}
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => setZoomLevel(Math.max(0.25, zoomLevel / 1.5))}
              style={{
                background: 'transparent',
                border: '1.5px solid var(--border)',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                padding: '8px 12px',
              }}
              title="Zoom Out"
            >
              −
            </button>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--muted)',
              letterSpacing: '0.05em',
              padding: '0 8px',
            }}>
              {(zoomLevel * 100).toFixed(0)}%
            </span>
          </>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 32, background: 'var(--border)' }} />

        {/* Metronome toggle */}
        <button
          onClick={() => metronome.setIsEnabled(!metronome.isEnabled)}
          style={{
            background: metronome.isEnabled ? 'var(--accent-1)' : 'transparent',
            border: `1.5px solid ${metronome.isEnabled ? 'var(--accent-1)' : 'var(--border)'}`,
            color: metronome.isEnabled ? '#fff' : 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            padding: '8px 16px',
          }}
        >
          {metronome.isEnabled ? '♪' : '♪'} CLICK
        </button>

        {/* BPM control */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 8,
        }}>
          <input
            type="number"
            value={metronome.bpm}
            onChange={(e) => metronome.setBpm(Math.max(40, Math.min(240, Number(e.target.value))))}
            style={{
              width: 60,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: '6px 8px',
              textAlign: 'center',
            }}
            min={40}
            max={240}
          />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--muted)',
            letterSpacing: '0.05em',
          }}>
            BPM
          </span>
        </div>

      </div>

      {/* Hidden MIDI file input */}
      <input
        ref={midiFileInputRef}
        type="file"
        accept=".mid,.midi"
        onChange={handleMidiFileChange}
        style={{ display: 'none' }}
      />

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: showPianoRoll ? 0 : 20 }}>
        {recordedNotes.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 48,
              color: 'var(--border)',
              letterSpacing: '0.1em',
            }}>
              {isRecording ? '●' : '—'}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--muted)',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}>
              {isRecording 
                ? 'RECORDING...' 
                : 'PRESS RECORD OR LOAD MIDI FILE'}
            </div>
          </div>
        ) : showPianoRoll ? (
          <PianoRollView 
            notes={recordedNotes} 
            isPlaying={isPlaying}
            zoomLevel={zoomLevel}
            onSeek={handleSeek}
          />
        ) : (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
          }}>
            {recordedNotes.slice(0, 50).map((note, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                Note {note.note} • Vel {note.velocity} • @{(note.timestamp / 1000).toFixed(3)}s
                {note.duration !== undefined && ` • ${(note.duration / 1000).toFixed(3)}s`}
              </div>
            ))}
            {recordedNotes.length > 50 && (
              <div style={{ color: 'var(--muted)', marginTop: 12 }}>
                ... and {recordedNotes.length - 50} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

// Piano Roll visualization component
function PianoRollView({ 
  notes, 
  isPlaying, 
  zoomLevel = 1.0,
  onSeek 
}: { 
  notes: RecordedNote[]; 
  isPlaying: boolean;
  zoomLevel?: number;
  onSeek?: (timeMs: number) => void;
}) {
  if (notes.length === 0) return null

  // Calculate time range
  const maxTime = Math.max(...notes.map(n => n.timestamp + (n.duration || 0)))
  const minNote = Math.min(...notes.map(n => n.note))
  const maxNote = Math.max(...notes.map(n => n.note))
  
  // Add padding to note range
  const noteRange = Math.max(24, maxNote - minNote + 4)
  const startNote = Math.max(0, minNote - 2)
  
  // Calculate dimensions with zoom
  const pixelsPerMs = 0.1 * zoomLevel // Apply zoom to horizontal scale
  const noteHeight = 12
  const rollWidth = Math.max(800, maxTime * pixelsPerMs)
  const rollHeight = noteRange * noteHeight
  
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12)
  
  // Handle click to seek
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left + e.currentTarget.scrollLeft - 50 // Account for note labels
    const timeMs = clickX / pixelsPerMs
    onSeek(Math.max(0, Math.min(maxTime, timeMs)))
  }
  
  return (
    <div 
      style={{ height: '100%', overflow: 'auto', background: '#f5f5f5', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}
    >
      <div style={{ position: 'relative', width: rollWidth, height: rollHeight, margin: '20px' }}>
        {/* Grid lines and piano keys */}
        {Array.from({ length: noteRange }, (_, i) => {
          const midiNote = startNote + noteRange - 1 - i
          const isBlack = isBlackKey(midiNote)
          const noteName = NOTE_NAMES[midiNote % 12]
          const octave = Math.floor(midiNote / 12) - 1
          
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                top: i * noteHeight,
                width: rollWidth,
                height: noteHeight,
                borderBottom: '1px solid #ddd',
                background: isBlack ? '#e8e8e8' : '#fff',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {/* Note label */}
              <div style={{
                position: 'sticky',
                left: 0,
                width: 50,
                background: isBlack ? '#d0d0d0' : '#e5e5e5',
                borderRight: '1px solid #ccc',
                padding: '0 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: '#333',
                textAlign: 'right',
              }}>
                {noteName === 'C' ? `${noteName}${octave}` : noteName}
              </div>
            </div>
          )
        })}
        
        {/* Vertical time grid lines (every second) */}
        {Array.from({ length: Math.ceil(maxTime / 1000) + 1 }, (_, i) => (
          <div
            key={`time-${i}`}
            style={{
              position: 'absolute',
              left: 50 + i * 1000 * pixelsPerMs,
              top: 0,
              width: 1,
              height: rollHeight,
              background: i % 4 === 0 ? '#bbb' : '#ddd',
            }}
          />
        ))}
        
        {/* Notes */}
        {notes.map((note, i) => {
          const y = (startNote + noteRange - 1 - note.note) * noteHeight
          const x = 50 + note.timestamp * pixelsPerMs
          const width = (note.duration || 100) * pixelsPerMs
          const alpha = 0.3 + (note.velocity / 127) * 0.7 // 0.3 to 1.0
          
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y + 1,
                width: Math.max(2, width),
                height: noteHeight - 2,
                background: `rgba(59, 130, 246, ${alpha})`, // Blue
                border: '1px solid rgba(37, 99, 235, 0.8)',
                borderRadius: 2,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
              title={`Note ${note.note}, Vel ${note.velocity}, ${(note.timestamp / 1000).toFixed(3)}s`}
            />
          )
        })}
        
        {/* Playback cursor */}
        {isPlaying && (
          <div style={{
            position: 'absolute',
            left: 50,
            top: 0,
            width: 2,
            height: rollHeight,
            background: 'var(--accent-2)',
            animation: `playhead ${maxTime}ms linear`,
          }} />
        )}
      </div>
      
      <style>{`
        @keyframes playhead {
          from { transform: translateX(0); }
          to { transform: translateX(${maxTime * pixelsPerMs}px); }
        }
      `}</style>
    </div>
  )
}
