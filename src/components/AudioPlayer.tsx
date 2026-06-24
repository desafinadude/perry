import { useState, useRef, useCallback, useEffect } from 'react'

interface ChannelState {
  muted: boolean
  volume: number
  pan: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioPlayer() {
  const [ctx, setCtx] = useState<AudioContext | null>(null)
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [fileName, setFileName] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [loop, setLoop] = useState(false)
  const [numChannels, setNumChannels] = useState(0)
  const [channels, setChannels] = useState<ChannelState[]>([
    { muted: false, volume: 100, pan: -1 },
    { muted: false, volume: 100, pan: 1 },
  ])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([])
  const gainNodesRef = useRef<GainNode[]>([])
  const pannerNodesRef = useRef<StereoPannerNode[]>([])
  const animFrameRef = useRef<number>(0)
  const startedAtRef = useRef(0)
  const startedOffsetRef = useRef(0)
  const currentAudioCtx = useRef<AudioContext | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop

  const getAudioContext = useCallback(() => {
    if (!currentAudioCtx.current) {
      currentAudioCtx.current = new AudioContext()
      setCtx(currentAudioCtx.current)
    }
    if (currentAudioCtx.current.state === 'suspended') {
      currentAudioCtx.current.resume()
    }
    return currentAudioCtx.current
  }, [])

  const cleanupSources = useCallback(() => {
    sourceNodesRef.current.forEach((s) => {
      try { s.stop(); s.disconnect() } catch { /* already stopped */ }
    })
    sourceNodesRef.current = []
    gainNodesRef.current.forEach((g) => g.disconnect())
    gainNodesRef.current = []
    pannerNodesRef.current.forEach((p) => p.disconnect())
    pannerNodesRef.current = []
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
  }, [])

  const stopPlayback = useCallback(() => {
    cleanupSources()
    setIsPlaying(false)
  }, [cleanupSources])

  const startPlayback = useCallback((offset: number) => {
    if (!audioBuffer) return
    const ac = getAudioContext()
    const buf = audioBuffer
    const numCh = buf.numberOfChannels

    cleanupSources()

    const sources: AudioBufferSourceNode[] = []
    const gains: GainNode[] = []
    const panners: StereoPannerNode[] = []

    for (let ch = 0; ch < numCh; ch++) {
      const chData = buf.getChannelData(ch)
      const monoBuffer = ac.createBuffer(1, buf.length, buf.sampleRate)
      monoBuffer.copyToChannel(chData, 0)

      const source = ac.createBufferSource()
      source.buffer = monoBuffer
      source.loop = loopRef.current
      source.playbackRate.value = speed
      source.detune.value = pitch * 100

      const gain = ac.createGain()
      const chState = channels[ch]
      gain.gain.value = chState.muted ? 0 : chState.volume / 100

      const panner = ac.createStereoPanner()
      panner.pan.value = chState.pan

      source.connect(gain)
      gain.connect(panner)
      panner.connect(ac.destination)

      source.start(0, offset)
      sources.push(source)
      gains.push(gain)
      panners.push(panner)
    }

    sourceNodesRef.current = sources
    gainNodesRef.current = gains
    pannerNodesRef.current = panners
    startedAtRef.current = ac.currentTime
    startedOffsetRef.current = offset
    setIsPlaying(true)
  }, [audioBuffer, getAudioContext, cleanupSources, speed, pitch, channels])

  useEffect(() => {
    if (!isPlaying || !ctx) return
    const tick = () => {
      if (!ctx || !sourceNodesRef.current.length) return
      const elapsed = ctx.currentTime - startedAtRef.current
      const newTime = startedOffsetRef.current + elapsed
      if (!loop && newTime >= duration) {
        stopPlayback()
        setCurrentTime(duration)
        return
      }
      setCurrentTime(newTime)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying, ctx, duration, loop, stopPlayback])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    startedOffsetRef.current = newTime
    if (isPlaying) {
      stopPlayback()
      startPlayback(newTime)
    }
  }, [isPlaying, stopPlayback, startPlayback])

  const handleLoadFile = useCallback(() => fileInputRef.current?.click(), [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const ac = getAudioContext()
      const buf = await file.arrayBuffer()
      const decoded = await ac.decodeAudioData(buf)
      setAudioBuffer(decoded)
      setFileName(file.name)
      setDuration(decoded.duration)
      setNumChannels(decoded.numberOfChannels)
      setCurrentTime(0)
      stopPlayback()

      if (decoded.numberOfChannels >= 2) {
        setChannels([
          { muted: false, volume: 100, pan: -1 },
          { muted: false, volume: 100, pan: 1 },
        ])
      } else {
        setChannels([
          { muted: false, volume: 100, pan: 0 },
        ])
      }
    } catch (err) {
      console.error('Failed to decode audio file:', err)
      alert('Could not decode audio file.')
    }
  }, [getAudioContext, stopPlayback])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
    } else {
      startPlayback(currentTime)
    }
  }, [isPlaying, stopPlayback, startPlayback, currentTime])

  const handleStop = useCallback(() => {
    stopPlayback()
    setCurrentTime(0)
    startedOffsetRef.current = 0
  }, [stopPlayback])

  const updateChannel = useCallback((idx: number, upd: Partial<ChannelState>) => {
    setChannels((prev) => {
      const next = prev.map((c, i) => i === idx ? { ...c, ...upd } : c)
      if (isPlaying && gainNodesRef.current[idx] && pannerNodesRef.current[idx]) {
        const ch = next[idx]
        gainNodesRef.current[idx].gain.value = ch.muted ? 0 : ch.volume / 100
        pannerNodesRef.current[idx].pan.value = ch.pan
      }
      return next
    })
  }, [isPlaying])

  const handleSpeedChange = useCallback((val: number) => {
    setSpeed(val)
    sourceNodesRef.current.forEach((s) => {
      s.playbackRate.value = val
    })
  }, [])

  const handlePitchChange = useCallback((val: number) => {
    setPitch(val)
    sourceNodesRef.current.forEach((s) => {
      s.detune.value = val * 100
    })
  }, [])

  const displayTime = loop && duration > 0 ? currentTime % duration : Math.min(currentTime, duration)
  const seekMax = Math.max(duration, 0.01)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: '2px solid var(--ink)',
        background: 'var(--surface)', minHeight: 42, padding: '0 0 0 11px', flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, letterSpacing: '0.1em', paddingRight: 16, borderRight: '1px solid var(--border)' }}>
          AUDIO
        </span>
        <button onClick={handleLoadFile} style={{
          marginLeft: 16,
          background: 'transparent', border: '1.5px solid var(--ink)',
          color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
          fontSize: 11, letterSpacing: '0.12em', padding: '6px 12px',
        }}>
          + LOAD WAV
        </button>
        <input ref={fileInputRef} type="file" accept=".wav,.mp3,.ogg,.flac,.aiff,.m4a"
          onChange={handleFileChange} style={{ display: 'none' }} />
        {fileName && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
            letterSpacing: '0.08em', marginLeft: 12, padding: '3px 8px',
            background: 'var(--bg)', border: '1px solid var(--border)',
            maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {fileName}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16, gap: 16 }}>
        {/* Empty state */}
        {!audioBuffer && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, color: 'var(--muted)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--border)', letterSpacing: '0.1em' }}>
              ~
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em' }}>
              LOAD A WAV FILE TO BEGIN
            </div>
          </div>
        )}

        {/* Progress bar */}
        {audioBuffer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)',
              fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em',
            }}>
              {formatTime(displayTime)}
              <input type="range" min={0} max={seekMax} step={0.01} value={displayTime}
                onChange={handleSeek}
                style={{ flex: 1 }} />
              {formatTime(duration)}
            </div>
          </div>
        )}
      </div>

      {/* Transport bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: 'var(--surface)',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      }}>
        <button onClick={togglePlay} disabled={!audioBuffer} style={{
          background: isPlaying ? 'var(--accent-1)' : 'transparent',
          border: `1.5px solid ${isPlaying ? 'var(--accent-1)' : 'var(--ink)'}`,
          color: isPlaying ? '#fff' : 'var(--ink)',
          cursor: audioBuffer ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
          letterSpacing: '0.1em', padding: '8px 20px', minWidth: 90,
          opacity: audioBuffer ? 1 : 0.5,
        }}>
          {isPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
        </button>
        <button onClick={handleStop} disabled={!audioBuffer} style={{
          background: 'transparent',
          border: '1.5px solid var(--border)',
          color: 'var(--ink)',
          cursor: audioBuffer ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.1em', padding: '8px 14px',
          opacity: audioBuffer ? 1 : 0.5,
        }}>
          ■ STOP
        </button>

        {/* Loop toggle */}
        <button onClick={() => {
          const next = !loop
          setLoop(next)
          loopRef.current = next
          if (isPlaying) {
            stopPlayback()
            startPlayback(currentTime)
          }
        }} disabled={!audioBuffer}
          style={{
            background: loop ? 'var(--accent-1)' : 'transparent',
            border: `1.5px solid ${loop ? 'var(--accent-1)' : 'var(--border)'}`,
            color: loop ? '#fff' : 'var(--ink)',
            cursor: audioBuffer ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: loop ? 600 : 400,
            letterSpacing: '0.1em', padding: '8px 14px',
            opacity: audioBuffer ? 1 : 0.5,
          }}>
          ⟳ LOOP
        </button>

        <div style={{ flex: 1 }} />

        {/* Speed control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Speed
          </span>
          <input type="range" min={0.25} max={2} step={0.05} value={speed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            style={{ width: 80 }} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink)',
            letterSpacing: '0.05em', width: 42, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {speed.toFixed(2)}x
          </span>
        </div>

        <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

        {/* Center All */}
        <button onClick={() => {
          channels.forEach((_, idx) => updateChannel(idx, { pan: 0 }))
        }} disabled={!audioBuffer} style={{
          background: 'transparent',
          border: '1.5px solid var(--border)',
          color: 'var(--ink)', cursor: audioBuffer ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.08em', padding: '7px 12px',
          opacity: audioBuffer ? 1 : 0.5,
        }}>
          Center All
        </button>

        <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

        {/* Pitch control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Pitch
          </span>
          <input type="range" min={-12} max={12} step={1} value={pitch}
            onChange={(e) => handlePitchChange(parseInt(e.target.value))}
            style={{ width: 80 }} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink)',
            letterSpacing: '0.05em', width: 36, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {pitch > 0 ? '+' : ''}{pitch}st
          </span>
        </div>
      </div>

      {/* Channel controls */}
      {audioBuffer && (
        <div style={{
          flexShrink: 0, padding: '12px 16px', background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
        }}>
          {channels.map((ch, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 0',
              borderBottom: idx < channels.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 18,
                letterSpacing: '0.08em', minWidth: 30,
                color: idx === 0 ? '#1A6BB5' : '#D93B2B',
              }}>
                {numChannels >= 2 ? (idx === 0 ? 'L' : 'R') : `CH${idx + 1}`}
              </span>

              <button onClick={() => updateChannel(idx, { muted: !ch.muted })}
                style={{
                  background: ch.muted ? 'var(--accent-2)' : 'transparent',
                  border: `1.5px solid ${ch.muted ? 'var(--accent-2)' : 'var(--border)'}`,
                  color: ch.muted ? '#fff' : 'var(--ink)',
                  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10,
                  letterSpacing: '0.1em', padding: '4px 10px', minWidth: 44,
                }}>
                {ch.muted ? 'MUTED' : 'MUTE'}
              </button>

              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
                letterSpacing: '0.08em', minWidth: 44,
              }}>
                VOL {ch.volume}
              </span>
              <input type="range" min={0} max={100} value={ch.volume}
                onChange={(e) => updateChannel(idx, { volume: parseInt(e.target.value) })}
                style={{ width: 100 }} />

              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
                letterSpacing: '0.08em', minWidth: 36,
              }}>
                PAN
              </span>
              <input type="range" min={-1} max={1} step={0.05} value={ch.pan}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value)
                  const snapped = Math.abs(raw) < 0.1 ? 0 : raw
                  updateChannel(idx, { pan: snapped })
                }}
                style={{ width: 100 }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink)',
                letterSpacing: '0.05em', minWidth: 48, fontVariantNumeric: 'tabular-nums',
              }}>
                {ch.pan === -1 ? 'L' : ch.pan === 1 ? 'R' : ch.pan === 0 ? 'C' : `${((ch.pan + 1) / 2 * 100).toFixed(0)}% ${ch.pan < 0 ? 'L' : 'R'}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
