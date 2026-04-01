import { useState, useRef, useCallback, useEffect } from 'react'

export function useMetronome() {
  const [isEnabled, setIsEnabled] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [isPlaying, setIsPlaying] = useState(false)
  
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nextBeatTimeRef = useRef(0)
  const startTimeRef = useRef(0) // AudioContext.currentTime when started
  const performanceStartRef = useRef(0) // performance.now() when started
  const schedulerIdRef = useRef<number | null>(null)
  const beatCountRef = useRef(0)
  const callbacksRef = useRef<Array<(beatNumber: number, time: number) => void>>([])

  // Ensure audio context
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }, [])

  // Play metronome click sound
  const playClick = useCallback((time: number, isDownbeat: boolean) => {
    const ctx = ensureAudioContext()
    
    // Log for debugging
    if (ctx.state !== 'running') {
      console.warn('AudioContext not running, state:', ctx.state)
    }
    
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.connect(gain)
    gain.connect(ctx.destination)
    
    // Downbeat (beat 1) is higher pitch and louder
    osc.frequency.value = isDownbeat ? 1200 : 800
    gain.gain.value = isDownbeat ? 0.3 : 0.15
    
    osc.start(time)
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05)
    osc.stop(time + 0.05)
  }, [ensureAudioContext])

  // Schedule beats ahead of time
  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    const scheduleAheadTime = 0.1 // seconds
    const currentTime = ctx.currentTime

    while (nextBeatTimeRef.current < currentTime + scheduleAheadTime) {
      const beatTime = nextBeatTimeRef.current
      
      // Play click if enabled
      if (isEnabled) {
        playClick(beatTime, beatCountRef.current % 4 === 0)
      }
      
      // Notify callbacks (for visual sync)
      callbacksRef.current.forEach(cb => cb(beatCountRef.current % 4, beatTime))
      
      // Calculate next beat
      beatCountRef.current++
      nextBeatTimeRef.current += 60 / bpm
    }
  }, [bpm, isEnabled, playClick])

  // Start/stop playback
  const start = useCallback(async (offsetBeats: number = 0) => {
    const ctx = ensureAudioContext()
    if (ctx.state === 'suspended') {
      console.log('Resuming suspended AudioContext...')
      await ctx.resume()
      console.log('AudioContext resumed, state:', ctx.state)
    }
    
    // Store timing references for sync
    startTimeRef.current = ctx.currentTime
    performanceStartRef.current = performance.now()
    beatCountRef.current = offsetBeats // Start from the offset beat
    
    // Start from current audio context time
    nextBeatTimeRef.current = ctx.currentTime
    setIsPlaying(true)
    
    console.log('Metronome scheduler starting at', ctx.currentTime, 'beat offset:', offsetBeats)
    
    // Schedule every 25ms
    schedulerIdRef.current = window.setInterval(scheduler, 25)
  }, [ensureAudioContext, scheduler])

  const stop = useCallback(() => {
    setIsPlaying(false)
    beatCountRef.current = 0
    if (schedulerIdRef.current !== null) {
      clearInterval(schedulerIdRef.current)
      schedulerIdRef.current = null
    }
  }, [])

  // Get the performance.now() time when metronome started (for sync)
  const getStartTime = useCallback(() => {
    return performanceStartRef.current
  }, [])

  // Register callback for beat notifications
  const onBeat = useCallback((callback: (beatNumber: number, time: number) => void) => {
    callbacksRef.current.push(callback)
    return () => {
      callbacksRef.current = callbacksRef.current.filter(cb => cb !== callback)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    isEnabled,
    setIsEnabled,
    bpm,
    setBpm,
    isPlaying,
    start,
    stop,
    getStartTime,
    onBeat,
  }
}
