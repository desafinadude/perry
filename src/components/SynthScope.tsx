import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SynthSettings } from '../types'
import { biquad, magnitude, patchPartials, renderPreview, PREVIEW_FREQ } from '../audio/preview'
import { Module, Segmented, lbl } from './controls'

interface Props {
  synth: SynthSettings
  /** Analyser on this zone's output; null until audio has started. */
  getAnalyser: () => AnalyserNode | null
}

type Mode = 'preview' | 'live'

const INK = '#111111'
const BLUE = '#1A6BB5'
const GREY = '#A9A69C'
const GRID = '#E5E2D9'
const HEIGHT = 128

const F_MIN = 20
const F_MAX = 20000
const DB_TOP = 12
const DB_BOTTOM = -66

/**
 * SCOPE strip for the synth: an oscilloscope (waveform over time) and a
 * spectrum analyser with the filter's response curve drawn on top.
 * PREVIEW draws what the knobs will produce at C4 without playing anything;
 * LIVE reads the zone's real output (post effects).
 */
export function SynthScope({ synth, getAnalyser }: Props) {
  const [mode, setMode] = useState<Mode>('preview')
  const [live, setLive] = useState({ signal: false })
  const waveRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  const size = useCanvasSize(waveRef)
  const specSize = useCanvasSize(specRef)

  const preview = useMemo(() => renderPreview(synth), [synth])
  const partials = useMemo(() => patchPartials(synth), [synth])
  const coeffs = useMemo(
    () => biquad(synth.filterType, Math.max(20, Math.min(18000, synth.cutoff)), synth.resonance),
    [synth.filterType, synth.cutoff, synth.resonance],
  )

  // ── PREVIEW: redraw when settings or size change ──
  useEffect(() => {
    if (mode !== 'preview') return
    const w = prep(waveRef.current, size.w)
    if (w) drawPreviewWave(w, size.w, preview.mix, preview.filtered)
    const s = prep(specRef.current, specSize.w)
    if (s) drawPreviewSpectrum(s, specSize.w, partials, (f) => magnitude(coeffs, f))
  }, [mode, preview, partials, coeffs, size.w, specSize.w])

  // ── LIVE: animation loop reading the analyser ──
  const coeffsRef = useRef(coeffs)
  coeffsRef.current = coeffs
  useEffect(() => {
    if (mode !== 'live') return
    let raf = 0
    let time: Float32Array<ArrayBuffer> | null = null
    let freq: Float32Array<ArrayBuffer> | null = null
    let lastSignal = false
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const a = getAnalyser()
      const w = prep(waveRef.current, size.w)
      const s = prep(specRef.current, specSize.w)
      if (!w || !s) return
      let peak = 0
      if (a) {
        if (!time || time.length !== a.fftSize) time = new Float32Array(a.fftSize)
        if (!freq || freq.length !== a.frequencyBinCount) freq = new Float32Array(a.frequencyBinCount)
        a.getFloatTimeDomainData(time)
        a.getFloatFrequencyData(freq)
        for (let i = 0; i < time.length; i++) peak = Math.max(peak, Math.abs(time[i]))
      }
      const signal = peak > 0.002
      drawLiveWave(w, size.w, signal && time ? time : null, peak)
      drawLiveSpectrum(s, specSize.w, signal && freq && a ? freq : null, a?.context.sampleRate ?? 44100, (f) => magnitude(coeffsRef.current, f))
      if (signal !== lastSignal) { lastSignal = signal; setLive({ signal }) }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [mode, getAnalyser, size.w, specSize.w])

  return (
    <Module
      title="SCOPE"
      style={{ gridColumn: '1 / -1', borderBottom: '1px solid var(--border)' }}
      aside={
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {mode === 'live' && !live.signal && <span style={lbl}>PLAY A NOTE</span>}
          <Segmented
            label="Scope source"
            tone="blue"
            height={24}
            options={[
              { value: 'preview', label: 'PREVIEW', title: 'Drawn from the knobs at C4 — no need to play' },
              { value: 'live', label: 'LIVE', title: "This zone's real output, after effects" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
        <figure style={fig}>
          <canvas ref={waveRef} role="img" aria-label="Oscilloscope: waveform over time" style={canvasStyle} />
          <figcaption style={caption}>
            <span style={lbl}>OSCILLOSCOPE</span>
            {mode === 'preview'
              ? <Legend items={[[GREY, 'OSC MIX'], [BLUE, 'AFTER FILTER']]} note={`C4 · ${PREVIEW_FREQ.toFixed(0)}HZ`} />
              : <Legend items={[[BLUE, 'OUTPUT']]} note="POST FX" />}
          </figcaption>
        </figure>
        <figure style={fig}>
          <canvas ref={specRef} role="img" aria-label="Spectrum analyser with filter response curve" style={canvasStyle} />
          <figcaption style={caption}>
            <span style={lbl}>SPECTRUM</span>
            {mode === 'preview'
              ? <Legend items={[[GREY, 'HARMONICS'], [BLUE, 'AFTER FILTER'], [INK, 'FILTER']]} note="20HZ – 20KHZ" />
              : <Legend items={[[BLUE, 'OUTPUT'], [INK, 'FILTER']]} note="20HZ – 20KHZ" />}
          </figcaption>
        </figure>
      </div>
    </Module>
  )
}

function Legend({ items, note }: { items: [string, string][]; note: string }) {
  return (
    <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {items.map(([c, t]) => (
        <span key={t} style={{ ...lbl, fontSize: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 2, background: c }} />{t}
        </span>
      ))}
      <span style={{ ...lbl, fontSize: 9 }}>{note}</span>
    </span>
  )
}

// ── canvas plumbing ─────────────────────────────────────────────────────────

function useCanvasSize(ref: React.RefObject<HTMLCanvasElement>) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return { w }
}

function prep(c: HTMLCanvasElement | null, w: number): CanvasRenderingContext2D | null {
  if (!c || w <= 0) return null
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(w * dpr), ph = Math.round(HEIGHT * dpr)
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph }
  const g = c.getContext('2d')
  if (!g) return null
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, HEIGHT)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, HEIGHT)
  return g
}

function waveGrid(g: CanvasRenderingContext2D, w: number) {
  g.strokeStyle = GRID
  g.lineWidth = 1
  g.beginPath()
  for (let i = 1; i < 8; i++) { const x = Math.round((w * i) / 8) + 0.5; g.moveTo(x, 0); g.lineTo(x, HEIGHT) }
  for (let i = 1; i < 4; i++) { const y = Math.round((HEIGHT * i) / 4) + 0.5; g.moveTo(0, y); g.lineTo(w, y) }
  g.stroke()
  g.strokeStyle = '#C8C5BB'
  g.beginPath(); g.moveTo(0, HEIGHT / 2 + 0.5); g.lineTo(w, HEIGHT / 2 + 0.5); g.stroke()
}

function trace(g: CanvasRenderingContext2D, w: number, data: ArrayLike<number>, from: number, count: number, scale: number, color: string, width: number) {
  g.strokeStyle = color
  g.lineWidth = width
  g.lineJoin = 'miter'
  g.beginPath()
  const mid = HEIGHT / 2
  const amp = (HEIGHT / 2 - 8) * scale
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * w
    const y = mid - data[from + i] * amp
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
}

function drawPreviewWave(g: CanvasRenderingContext2D, w: number, mix: Float32Array, filtered: Float32Array) {
  waveGrid(g, w)
  let peak = 0
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]), Math.abs(filtered[i]))
  const scale = peak > 0 ? 1 / peak : 1
  trace(g, w, mix, 0, mix.length, scale, GREY, 1.5)
  trace(g, w, filtered, 0, filtered.length, scale, BLUE, 2.25)
}

function drawLiveWave(g: CanvasRenderingContext2D, w: number, data: Float32Array | null, peak: number) {
  waveGrid(g, w)
  if (!data) return
  // rising zero-crossing trigger so periodic waves stand still
  const count = 1024
  let start = 0
  for (let i = 1; i < data.length - count; i++) {
    if (data[i - 1] < 0 && data[i] >= 0) { start = i; break }
  }
  trace(g, w, data, start, count, Math.min(8, 0.9 / Math.max(peak, 0.01)), BLUE, 2)
}

const fx = (f: number, w: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w
const dby = (db: number) => ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * HEIGHT

function specGrid(g: CanvasRenderingContext2D, w: number) {
  g.strokeStyle = GRID
  g.lineWidth = 1
  g.beginPath()
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(fx(f, w)) + 0.5; g.moveTo(x, 0); g.lineTo(x, HEIGHT) }
  for (const db of [0, -24, -48]) { const y = Math.round(dby(db)) + 0.5; g.moveTo(0, y); g.lineTo(w, y) }
  g.stroke()
  g.fillStyle = '#6E6C64'
  g.font = '9px "IBM Plex Mono", monospace'
  for (const [f, t] of [[100, '100'], [1000, '1K'], [10000, '10K']] as const) g.fillText(t, fx(f, w) + 3, HEIGHT - 4)
}

function filterCurve(g: CanvasRenderingContext2D, w: number, mag: (f: number) => number) {
  g.strokeStyle = INK
  g.lineWidth = 1.75
  g.beginPath()
  for (let x = 0; x <= w; x += 2) {
    const f = F_MIN * Math.pow(F_MAX / F_MIN, x / w)
    const y = dby(20 * Math.log10(Math.max(mag(f), 1e-6)))
    if (x === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
}

function drawPreviewSpectrum(g: CanvasRenderingContext2D, w: number, partials: { freq: number; amp: number }[], mag: (f: number) => number) {
  specGrid(g, w)
  const base = HEIGHT
  for (const p of partials) {
    const x = Math.round(fx(p.freq, w)) + 0.5
    const dbRaw = 20 * Math.log10(Math.max(p.amp, 1e-6)) + 6
    const dbOut = dbRaw + 20 * Math.log10(Math.max(mag(p.freq), 1e-6))
    g.strokeStyle = GREY; g.lineWidth = 1
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, dby(dbRaw)); g.stroke()
    g.strokeStyle = BLUE; g.lineWidth = 2
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, dby(dbOut)); g.stroke()
  }
  filterCurve(g, w, mag)
}

function drawLiveSpectrum(g: CanvasRenderingContext2D, w: number, data: Float32Array | null, rate: number, mag: (f: number) => number) {
  specGrid(g, w)
  if (data) {
    const binHz = rate / 2 / data.length
    g.fillStyle = 'rgba(26,107,181,.18)'
    g.strokeStyle = BLUE
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(0, HEIGHT)
    for (let x = 0; x <= w; x += 2) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, x / w)
      const bin = Math.min(data.length - 1, Math.round(f / binHz))
      // analyser dBFS sits around -100..-10; shift so loud partials reach ~0 dB
      g.lineTo(x, dby(data[bin] + 24))
    }
    g.lineTo(w, HEIGHT)
    g.closePath()
    g.fill()
    g.stroke()
  }
  filterCurve(g, w, mag)
}

const fig: CSSProperties = { margin: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const canvasStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', height: HEIGHT + 3, display: 'block', border: '1.5px solid var(--ink)', background: '#fff' }
const caption: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
