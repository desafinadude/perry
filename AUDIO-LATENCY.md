# Audio Latency & Performance

## Improvements Made

### 1. Low Latency AudioContext
```typescript
new AudioContext({
  latencyHint: 'interactive', // Optimized for low latency
  sampleRate: 44100,          // Standard rate
})
```

This configures the browser's audio system for minimal latency rather than power efficiency.

### 2. Gain Boost
Added a 1.2x gain stage to make notes feel punchier and more present, compensating for SpessaSynth's conservative default volume.

## Expected Latency

- **Native FluidSynth (qsynth)**: ~3-5ms
- **Perry (Web Audio)**: ~10-30ms depending on browser and system

### Browser Differences:
- **Chrome/Edge**: ~10-20ms (best Web Audio performance)
- **Firefox**: ~15-30ms
- **Safari**: ~20-40ms

## Why Browser Audio Has More Latency

1. **Additional Audio Pipeline**: Browser → OS → Hardware (extra layer)
2. **JavaScript → Audio Worklet**: Small overhead for message passing
3. **Buffer Size**: Browsers use slightly larger buffers for stability
4. **Security Sandboxing**: Audio isolation adds microseconds

## Tips for Lowest Latency

1. **Use Chrome/Chromium** - has the best Web Audio implementation
2. **Close other audio apps** - reduces system audio contention
3. **Use ASIO/JACK** on the system level if available
4. **Reduce browser tab count** - less CPU competition
5. **Check AudioContext metrics** in browser console:
   ```
   AudioContext latency: {
     baseLatency: 0.005,    // ~5ms (good!)
     outputLatency: 0.015,  // ~15ms total
   }
   ```

## When Native Performance Matters

If you need absolutely minimal latency (<5ms) for professional performance:
- Use **qsynth** or **FluidSynth** directly
- Route MIDI to native synthesizer
- Perry is excellent for composition/playback, but native tools are better for live performance where every millisecond counts

## SpessaSynth vs FluidSynth

Both use the same SoundFont format, but:

**SpessaSynth (Perry)**:
- JavaScript-based, runs in browser
- ~10-30ms latency
- No installation needed
- Portable, works anywhere

**FluidSynth (qsynth)**:
- Native C code
- ~3-5ms latency
- Requires installation
- Platform-specific

The slight "softer attack" you feel is real - it's the 5-25ms difference between the two!
