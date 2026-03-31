import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'

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
  // No props needed - fully self-contained
}

export const Recorder = forwardRef<RecorderHandle, Props>((_props, ref) => {
  const [isArmed, setIsArmed] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([])
  const startTimeRef = useRef<number>(0)
  const activeNotesRef = useRef<Map<number, number>>(new Map()) // note -> start timestamp

  const handleArm = useCallback(() => {
    setIsArmed(!isArmed)
    if (isRecording) {
      setIsRecording(false)
    }
  }, [isArmed, isRecording])

  const handleRecord = useCallback(() => {
    if (!isArmed) return
    
    if (!isRecording) {
      // Start recording
      setIsRecording(true)
      startTimeRef.current = performance.now()
      setRecordedNotes([])
      activeNotesRef.current.clear()
    } else {
      // Stop recording
      setIsRecording(false)
      // Finalize any still-active notes
      const now = performance.now()
      activeNotesRef.current.forEach((startTime, note) => {
        setRecordedNotes(prev => prev.map(n => 
          n.note === note && !n.duration 
            ? { ...n, duration: now - startTime }
            : n
        ))
      })
      activeNotesRef.current.clear()
    }
  }, [isArmed, isRecording])

  const handleClear = useCallback(() => {
    setRecordedNotes([])
    setIsRecording(false)
    activeNotesRef.current.clear()
  }, [])

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
    activeNotesRef.current.set(note, timestamp)
    setRecordedNotes(prev => [...prev, { note, velocity, timestamp }])
  }, [isRecording])

  const recordNoteOff = useCallback((note: number) => {
    if (!isRecording) return
    const startTime = activeNotesRef.current.get(note)
    if (startTime !== undefined) {
      const duration = performance.now() - startTimeRef.current - startTime
      setRecordedNotes(prev => prev.map(n => 
        n.note === note && n.timestamp === startTime
          ? { ...n, duration }
          : n
      ))
      activeNotesRef.current.delete(note)
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

        {/* ARM button */}
        <button
          onClick={handleArm}
          style={{
            background: isArmed ? 'var(--accent-2)' : 'transparent',
            border: `2px solid ${isArmed ? 'var(--accent-2)' : 'var(--border)'}`,
            color: isArmed ? '#fff' : 'var(--ink)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.1em',
            padding: '10px 20px',
            minWidth: 80,
          }}
        >
          {isArmed ? '● ARM' : 'ARM'}
        </button>

        {/* RECORD button */}
        <button
          onClick={handleRecord}
          disabled={!isArmed}
          style={{
            background: isRecording ? 'var(--accent-2)' : isArmed ? 'var(--accent-1)' : '#ccc',
            border: 'none',
            color: '#fff',
            cursor: isArmed ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.1em',
            padding: '10px 20px',
            minWidth: 100,
            opacity: isArmed ? 1 : 0.5,
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
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
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
              {isArmed ? (isRecording ? '●' : '○') : '—'}
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
                : isArmed 
                ? 'ARMED - PRESS RECORD TO START'
                : 'ARM RECORDER TO BEGIN'}
            </div>
          </div>
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
