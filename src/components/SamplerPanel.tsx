import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { SamplerSettings } from '../types'
import { noteName } from '../types'
import { Knob } from './Knob'
import { Module, KnobRow, Segmented, EnvelopeGraph, headText, lbl, outlineBtn } from './controls'
import { fmtMs, fmtPct, fmtSec } from './format'

interface Props {
  settings: SamplerSettings
  onChange: (s: SamplerSettings) => void
  /** True when a decoded buffer is available for this zone's file name. */
  loaded: boolean
  /** Duration of the loaded buffer in seconds, if any. */
  duration: number | null
  /** The decoded sample, for the waveform display. */
  buffer?: AudioBuffer
  onLoad: (file: File) => Promise<void>
  /** Zone key range + colour, for the root-note strip. */
  minNote: number
  maxNote: number
  color: string
  /** True while waiting for a key press to set the root note. */
  learningRoot: boolean
  onLearnRoot: () => void
}

type Mode = 'gate' | 'loop' | 'oneshot'
const MODES = [
  { value: 'gate', label: 'GATE', title: 'Plays while the key is held' },
  { value: 'loop', label: 'LOOP', title: 'Loops between the start and end markers while held' },
  { value: 'oneshot', label: 'ONE-SHOT', title: 'Drum mode: plays to the end, key release ignored' },
] as const

const COLS = 480

/**
 * Sampler faceplate: full-width waveform with draggable loop markers, then
 * ROOT NOTE | PLAYBACK | AMP ENVELOPE on a 3-column grid.
 */
export function SamplerPanel({
  settings, onChange, loaded, duration, buffer, onLoad,
  minNote, maxNote, color, learningRoot, onLearnRoot,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  // After a load, default the loop end to the full buffer once.
  useEffect(() => {
    if (duration && settings.loop && settings.loopEnd === 0) {
      onChange({ ...settings, loopEnd: Math.round(duration * 1000) / 1000 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, settings.loop])

  const set = <K extends keyof SamplerSettings>(key: K, value: SamplerSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const mode: Mode = settings.oneShot ? 'oneshot' : settings.loop ? 'loop' : 'gate'
  const setMode = (m: Mode) => {
    const next = { ...settings, loop: m === 'loop', oneShot: m === 'oneshot' }
    if (m === 'loop' && duration && next.loopEnd === 0) next.loopEnd = Math.round(duration * 1000) / 1000
    onChange(next)
  }

  const handleFile = async (file: File | undefined) => { if (file) await onLoad(file) }

  // Waveform as min/max columns
  const wavePath = useMemo(() => {
    if (!buffer) return ''
    const data = buffer.getChannelData(0)
    const per = Math.max(1, Math.floor(data.length / COLS))
    let peak = 0
    const cols: [number, number][] = []
    for (let c = 0; c < COLS; c++) {
      let lo = 0, hi = 0
      const end = Math.min(data.length, (c + 1) * per)
      for (let i = c * per; i < end; i++) {
        const v = data[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      cols.push([lo, hi])
      peak = Math.max(peak, -lo, hi)
    }
    const k = peak > 0 ? 36 / peak : 0
    return cols.map(([lo, hi], c) => `M${c + 0.5} ${(40 - hi * k).toFixed(1)}V${(40 - lo * k + 0.3).toFixed(1)}`).join('')
  }, [buffer])

  const dur = duration ?? 0
  const loopMax = Math.max(dur, 1)
  const pct = (t: number) => (dur > 0 ? Math.max(0, Math.min(100, (t / dur) * 100)) : 0)
  const loopEnd = settings.loopEnd || dur

  const onWaveMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !waveRef.current || dur <= 0) return
    const r = waveRef.current.getBoundingClientRect()
    const t = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur * 1000) / 1000
    if (dragging === 'start') set('loopStart', Math.min(t, loopEnd - 0.01))
    else set('loopEnd', Math.max(t, settings.loopStart + 0.01))
  }

  const ruler = dur > 0 ? rulerTicks(dur) : []
  const rootPos = maxNote > minNote ? ((settings.rootNote - minNote) / (maxNote - minNote)) * 100 : 50

  return (
    <div>
      {/* ── SAMPLE ── */}
      <section
        aria-label="Sample"
        style={{ ...sampleSection, outline: dragOver ? '2px dashed var(--accent-1)' : 'none', outlineOffset: -6 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
      >
        <div style={sampleHead}>
          <span style={headText}>SAMPLE</span>
          {settings.fileName && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: loaded ? 'var(--ink)' : 'var(--accent-2)' }}>
              {settings.fileName.toUpperCase()}{loaded ? '' : ' — NOT LOADED'}
            </span>
          )}
          {loaded && buffer && (
            <span style={lbl}>{fmtSec(buffer.duration)} · {buffer.numberOfChannels === 1 ? 'MONO' : 'STEREO'}</span>
          )}
          <span style={{ flex: 1 }} />
          <span style={lbl}>OR DROP AN AUDIO FILE</span>
          <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; handleFile(f) }}
            style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...outlineBtn, height: 30, fontSize: 10 }}>
            {settings.fileName ? 'REPLACE…' : 'LOAD FILE…'}
          </button>
        </div>

        <div
          ref={waveRef}
          onPointerMove={onWaveMove}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
          style={{ position: 'relative', height: 150, background: '#fff', border: '1.5px solid var(--ink)', touchAction: 'none' }}
        >
          {loaded && buffer ? (
            <>
              {mode === 'loop' && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(settings.loopStart)}%`, width: `${pct(loopEnd) - pct(settings.loopStart)}%`, background: 'rgba(26,107,181,.10)' }} />
              )}
              <svg width="100%" height="100%" viewBox={`0 0 ${COLS} 80`} preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
                <path d={`M0 40 H${COLS}`} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <path d={wavePath} stroke="var(--ink)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" fill="none" />
              </svg>
              {mode === 'loop' && (
                <>
                  <LoopHandle which="start" left={pct(settings.loopStart)} time={settings.loopStart} onGrab={setDragging} />
                  <LoopHandle which="end" left={pct(loopEnd)} time={loopEnd} onGrab={setDragging} />
                </>
              )}
            </>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={emptyWave}>
              {settings.fileName ? 'SAMPLE NOT IN MEMORY — LOAD IT AGAIN' : 'NO SAMPLE — LOAD OR DROP AN AUDIO FILE'}
            </button>
          )}
        </div>
        <div style={{ position: 'relative', height: 14 }}>
          {ruler.map((t) => (
            <span key={t} style={{ ...lbl, position: 'absolute', left: `${pct(t)}%`, fontSize: 9, letterSpacing: '0.06em', borderLeft: '1px solid var(--ink)', paddingLeft: 4 }}>
              {t}s
            </span>
          ))}
        </div>
      </section>

      {/* ── ROOT · PLAYBACK · ENVELOPE ── */}
      <section aria-label="Sampler controls" style={grid}>
        <Module title="ROOT NOTE" aside={<span style={lbl}>KEYS PITCH AROUND IT</span>} style={{ borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button aria-label="Root note down" onClick={() => set('rootNote', Math.max(0, settings.rootNote - 1))} style={arrowBtn}>
              <svg width={10} height={12} viewBox="0 0 10 12" aria-hidden="true"><path d="M9 1 L1 6 L9 11 Z" fill="var(--ink)" /></svg>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 76 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 0.85 }}>{noteName(settings.rootNote)}</span>
              <span style={{ ...lbl, fontSize: 9 }}>MIDI {settings.rootNote}</span>
            </div>
            <button aria-label="Root note up" onClick={() => set('rootNote', Math.min(127, settings.rootNote + 1))} style={arrowBtn}>
              <svg width={10} height={12} viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1 L9 6 L1 11 Z" fill="var(--ink)" /></svg>
            </button>
            <button
              onClick={onLearnRoot}
              aria-pressed={learningRoot}
              title="Click, then play a key (or click one on the keyboard above)"
              style={{ ...outlineBtn, height: 44, fontSize: 10, padding: '0 12px', background: learningRoot ? '#fbbf24' : 'transparent', borderColor: learningRoot ? '#fbbf24' : 'var(--ink)' }}
            >
              {learningRoot ? 'PLAY A KEY…' : 'LEARN'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ position: 'relative', height: 10, background: 'var(--surface)', border: '1px solid var(--ink)' }}>
              <div style={{ position: 'absolute', inset: 0, background: color, opacity: 0.35 }} />
              <div style={{ position: 'absolute', top: -4, bottom: -4, left: `calc(${Math.max(0, Math.min(100, rootPos))}% - 1.5px)`, width: 3, background: 'var(--ink)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ ...lbl, fontSize: 9 }}>{noteName(minNote)}</span>
              <span style={{ ...lbl, fontSize: 9 }}>ZONE RANGE</span>
              <span style={{ ...lbl, fontSize: 9 }}>{noteName(maxNote)}</span>
            </div>
          </div>
        </Module>

        <Module title="PLAYBACK" style={{ borderRight: '1px solid var(--border)' }}>
          <Segmented label="Playback mode" tone="blue" options={MODES} value={mode} onChange={setMode} height={36} />
          <KnobRow>
            <Knob label="LOOP START" dimmed={mode !== 'loop' || !loaded} value={settings.loopStart} min={0} max={loopMax} step={0.001}
              defaultValue={0} onChange={(v) => set('loopStart', Math.min(v, Math.max(0, loopEnd - 0.01)))} display={fmtSec} />
            <Knob label="LOOP END" dimmed={mode !== 'loop' || !loaded} value={loopEnd} min={0} max={loopMax} step={0.001}
              defaultValue={dur || undefined} onChange={(v) => set('loopEnd', Math.max(v, settings.loopStart + 0.01))} display={fmtSec} />
          </KnobRow>
        </Module>

        <Module title="AMP ENVELOPE" aside={<span style={lbl}>ADSR</span>}>
          <KnobRow gap={12}>
            <EnvelopeGraph attack={settings.ampAttack} decay={settings.ampDecay} sustain={settings.ampSustain} release={settings.ampRelease} width={120} height={64} />
            <KnobRow gap={0}>
              <Knob size={50} label="A" value={settings.ampAttack} min={0.001} max={3} curve="log" defaultValue={0.005}
                onChange={(v) => set('ampAttack', v)} display={fmtMs} />
              <Knob size={50} label="D" value={settings.ampDecay} min={0.001} max={3} curve="log" defaultValue={0.1}
                onChange={(v) => set('ampDecay', v)} display={fmtMs} />
              <Knob size={50} label="S" value={settings.ampSustain} min={0} max={1} defaultValue={1}
                onChange={(v) => set('ampSustain', v)} display={fmtPct} />
              <Knob size={50} label="R" value={settings.ampRelease} min={0.01} max={5} curve="log" defaultValue={0.15}
                onChange={(v) => set('ampRelease', v)} display={fmtMs} />
            </KnobRow>
          </KnobRow>
        </Module>
      </section>
    </div>
  )
}

function LoopHandle({ which, left, time, onGrab }: {
  which: 'start' | 'end'; left: number; time: number; onGrab: (w: 'start' | 'end') => void
}) {
  return (
    <button
      aria-label={`Loop ${which}, ${time.toFixed(2)} seconds — drag to move`}
      onPointerDown={(e) => { e.preventDefault(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); onGrab(which) }}
      style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${left}% - 5px)`, width: 10, padding: 0, border: 'none', background: 'transparent', cursor: 'ew-resize' }}
    >
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: 4, width: 2, background: 'var(--accent-1)' }} />
      <span style={{
        position: 'absolute', [which === 'start' ? 'top' : 'bottom']: 0, [which === 'start' ? 'left' : 'right']: which === 'start' ? 4 : 4,
        background: 'var(--accent-1)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.1em', padding: '3px 6px', whiteSpace: 'nowrap',
      }}>
        {which === 'start' ? 'START' : 'END'}
      </span>
    </button>
  )
}

function rulerTicks(dur: number): number[] {
  const step = dur > 20 ? 5 : dur > 8 ? 2 : dur > 3 ? 1 : 0.5
  const out: number[] = []
  for (let t = 0; t < dur - step * 0.3; t += step) out.push(Math.round(t * 10) / 10)
  return out
}

const sampleSection: CSSProperties = {
  padding: '14px 20px 16px', borderBottom: '1px solid var(--border)',
  display: 'flex', flexDirection: 'column', gap: 10,
}
const sampleHead: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16, height: 30, flexWrap: 'wrap',
  borderBottom: '2px solid var(--ink)', paddingBottom: 6,
}
const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  borderBottom: '2px solid var(--ink)',
}
const arrowBtn: CSSProperties = {
  width: 44, height: 44, border: '1.5px solid var(--ink)', background: 'transparent',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0, flexShrink: 0,
}
const emptyWave: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', background: 'transparent', border: 'none',
  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', color: 'var(--label)',
}
