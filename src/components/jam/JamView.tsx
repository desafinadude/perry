import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Zone } from '../../types'
import type { Chart, ChartBar } from '../../jam/model'
import { barBeats, barTimeSigs, emptyChart, timeSigLabel, uid } from '../../jam/model'
import { describeChord, keyPrefersFlats, parseChord, pcName, QUICK_QUALITIES, transposeKey, transposeSymbol } from '../../jam/chords'
import { toIrealbook } from '../../jam/ireal'
import { resolveChords } from '../../jam/unroll'
import { STYLES, styleById, styleForName } from '../../jam/styles'
import type { Track } from '../../jam/arranger'
import { JamPlayer, type PlayerSettings, type TrackSettings } from '../../jam/player'
import { BuiltinBand } from '../../jam/builtin'
import { builtInCharts, loadBandPrefs, loadUserCharts, saveBandPrefs, saveUserCharts } from '../../jam/library'
import { deleteBar, duplicateBar, insertBarAfter, patchBar, setChord, setRepeatMark } from '../../jam/edit'
import { Knob } from '../Knob'
import { Segmented, h1, h2, h3, hero, headText, lbl, outlineBtn } from '../controls'
import { ChartGrid } from './ChartGrid'
import { ChordSymbol } from './ChordSymbol'
import { ImportDialog } from './ImportDialog'

interface Props {
  zones: Zone[]
  /** True while the JAM tab is visible (keyboard shortcuts). */
  active: boolean
  scheduleNote: (zone: Zone, note: number, velocity: number, when: number, duration: number) => void
  stopScheduled: (zones: Zone[]) => void
  /** Mixer strips for the band's built-in parts. */
  getJamOutputs: () => { ctx: AudioContext; drums: AudioNode; bass: AudioNode; keys: AudioNode; click: AudioNode }
  /** Tells the app the current tempo (tempo-synced delay). */
  onTempo?: (bpm: number) => void
  /** Tells the app which band parts play built-in sounds (mixer strips). */
  onBuiltinUse?: (used: Record<'drums' | 'bass' | 'keys', boolean>) => void
}

interface BandPrefs {
  tracks: Record<Track, TrackSettings>
  choruses: number
  ramp: number
  countIn: boolean
  click: boolean
  selectedId: string | null
}

const DEFAULT_PREFS: BandPrefs = {
  tracks: {
    drums: { zoneId: 'builtin', volume: 0.75, mute: false, solo: false },
    bass: { zoneId: 'builtin', volume: 0.85, mute: false, solo: false },
    comp: { zoneId: 'builtin', volume: 0.7, mute: false, solo: false },
  },
  choruses: 3, ramp: 0, countIn: true, click: false, selectedId: null,
}

const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C-', 'C#-', 'D-', 'Eb-', 'E-', 'F-', 'F#-', 'G-', 'G#-', 'A-', 'Bb-', 'B-']
const TIME_SIGS = ['44', '34', '24', '54', '64', '22', '68', '12']
const MARKS = ['', 'D.C. al Coda', 'D.C. al Fine', 'D.S. al Coda', 'D.S. al Fine', 'Fine']
const TRACK_NAMES: Record<Track, string> = { drums: 'DRUMS', bass: 'BASS', comp: 'COMP' }

const keyLabel = (k: string) => k.replace('b', '♭').replace('#', '♯').replace('-', '–')

export function JamView({ zones, active, scheduleNote, stopScheduled, getJamOutputs, onTempo, onBuiltinUse }: Props) {
  // ── library ──
  const [charts, setCharts] = useState<Chart[]>(() => [...builtInCharts(), ...loadUserCharts()])
  const [prefs, setPrefs] = useState<BandPrefs>(() => {
    const p = loadBandPrefs(DEFAULT_PREFS)
    return { ...p, tracks: { ...DEFAULT_PREFS.tracks, ...p.tracks } }
  })
  const [selectedId, setSelectedId] = useState<string>(() => prefs.selectedId && charts.some((c) => c.id === prefs.selectedId) ? prefs.selectedId : charts[0].id)
  const chart = charts.find((c) => c.id === selectedId) ?? charts[0]
  const [storeError, setStoreError] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setStoreError(!saveUserCharts(charts.filter((c) => !c.builtIn))), 400)
    return () => window.clearTimeout(t)
  }, [charts])
  useEffect(() => { saveBandPrefs({ ...prefs, selectedId }) }, [prefs, selectedId])

  // ── modes / UI state ──
  const [mode, setMode] = useState<'play' | 'edit'>('play')
  const [importOpen, setImportOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [loop, setLoop] = useState<[number, number] | null>(null)
  const [loopOn, setLoopOn] = useState(false)
  const [sel, setSel] = useState<{ bar: number; beat: number } | null>(null)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2200) }

  const style = chart.jamStyle ? styleById(chart.jamStyle) : styleForName(chart.style)
  const bpm = chart.bpm ?? style.defaultBpm
  const shownKey = transposeKey(chart.key, chart.transpose)
  const flats = keyPrefersFlats(shownKey)

  /** Replace the current chart. Structural edits to a built-in chart make a copy first. */
  const keepSelRef = useRef(false)
  const update = useCallback((next: Chart, structural = false) => {
    if (next.builtIn && structural) {
      const copy: Chart = { ...next, id: uid(), builtIn: false, playlist: 'My charts', title: next.title }
      setCharts((cs) => [...cs, copy])
      keepSelRef.current = true
      setSelectedId(copy.id)
      flash('EDITING A COPY IN “MY CHARTS”')
      return
    }
    setCharts((cs) => cs.map((c) => (c.id === next.id ? next : c)))
  }, [])

  // ── player ──
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const playerRef = useRef<JamPlayer | null>(null)
  const [playing, setPlaying] = useState(false)

  const settings: PlayerSettings = useMemo(() => ({
    styleId: style.id, bpm, ramp: prefs.ramp, choruses: prefs.choruses,
    countIn: prefs.countIn, click: prefs.click,
    loop: loopOn && loop ? loop : null, tracks: prefs.tracks,
  }), [style.id, bpm, prefs, loopOn, loop])

  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current
    const { ctx, ...outs } = getJamOutputs()
    const band = new BuiltinBand(ctx, outs)
    const p = new JamPlayer({
      ctx, band,
      playZone: (zoneId, midi, vel, when, dur) => {
        const z = zonesRef.current.find((x) => x.id === zoneId)
        if (!z) return false
        scheduleNote(z, midi, vel, when, dur)
        return true
      },
      stopZones: () => stopScheduled(zonesRef.current),
    }, settings)
    p.onEnd = () => setPlaying(false)
    playerRef.current = p
    return p
  }, [getJamOutputs, scheduleNote, stopScheduled, settings])

  useEffect(() => { playerRef.current?.setSettings(settings) }, [settings])
  useEffect(() => { playerRef.current?.setChart(chart) }, [chart])
  useEffect(() => () => playerRef.current?.stop(), [])

  const play = useCallback((fromBar = 0) => {
    const p = ensurePlayer()
    p.setSettings(settings)
    p.start(chart, fromBar)
    setPlaying(true)
  }, [ensurePlayer, settings, chart])
  const stop = useCallback(() => { playerRef.current?.stop(); setPlaying(false) }, [])

  // stop when switching charts
  const prevChart = useRef(chart.id)
  useEffect(() => {
    if (prevChart.current !== chart.id && !keepSelRef.current) { stop(); setLoop(null); setLoopOn(false); setSel(null) }
    keepSelRef.current = false
    prevChart.current = chart.id
  }, [chart.id, stop])

  // ── position polling ──
  const [pos, setPos] = useState({ index: -1, beat: 0, chorus: 0, bpm, countIn: false })
  const [sounding, setSounding] = useState<{ comp: number[]; bass: number[] }>({ comp: [], bass: [] })
  useEffect(() => {
    if (!playing) { setPos((p) => ({ ...p, index: -1 })); setSounding({ comp: [], bass: [] }); return }
    let raf = 0
    let last = ''
    let lastNotes = ''
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn)
      const p = playerRef.current
      if (!p) return
      const q = p.position()
      const beat = Math.floor(q.beat)
      const k = `${q.bar?.index}|${beat}|${q.chorus}|${q.countIn}|${q.bpm}`
      if (k !== last) {
        last = k
        setPos({ index: q.bar?.index ?? -1, beat, chorus: q.chorus, bpm: q.bpm, countIn: q.countIn })
      }
      const s = p.soundingNow()
      const nk = s.comp.join(',') + '|' + s.bass.join(',')
      if (nk !== lastNotes) { lastNotes = nk; setSounding(s) }
    }
    loopFn()
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const liveBpm = playing ? pos.bpm : bpm
  const usesBuiltin = (t: Track) => prefs.tracks[t].zoneId === 'builtin' || !zones.some((z) => z.id === prefs.tracks[t].zoneId)
  const bd = usesBuiltin('drums'), bb = usesBuiltin('bass'), bk = usesBuiltin('comp')
  useEffect(() => { onBuiltinUse?.({ drums: bd, bass: bb, keys: bk }) }, [bd, bb, bk, onBuiltinUse])
  useEffect(() => { onTempo?.(liveBpm) }, [liveBpm, onTempo])

  // ── keyboard shortcut: space = play/stop ──
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || importOpen) return
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      e.preventDefault()
      if (playing) stop(); else play(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, playing, play, stop, importOpen])

  // ── derived display ──
  const resolved = useMemo(() => resolveChords(chart), [chart])
  const nowChord = useMemo(() => {
    if (pos.index < 0) return null
    const r = resolved[pos.index] ?? []
    const cur = [...r].reverse().find((c) => c.beat <= pos.beat + 1e-6) ?? r[0]
    let next: string | null = null
    const after = r.find((c) => c.beat > pos.beat + 1e-6)
    if (after) next = after.text
    else for (let j = pos.index + 1; j < resolved.length && !next; j++) if (resolved[j].length) next = resolved[j][0].text
    const t = (x: string | null | undefined) => (x && x !== 'n' ? transposeSymbol(x, chart.transpose, flats) : x ?? null)
    return { cur: t(cur?.text), next: t(next) }
  }, [pos.index, pos.beat, resolved, chart.transpose, flats])

  const setTrack = (t: Track, patch: Partial<TrackSettings>) =>
    setPrefs((p) => ({ ...p, tracks: { ...p.tracks, [t]: { ...p.tracks[t], ...patch } } }))

  const share = async () => {
    const link = toIrealbook({ ...chart, key: shownKey, bars: transposedBars(chart, flats) })
    try { await navigator.clipboard.writeText(link); flash('iREAL LINK COPIED') } catch { window.prompt('Copy this iReal Pro link:', link) }
  }

  // ── import / new / delete ──
  const doImport = (list: Chart[]) => {
    setCharts((cs) => [...cs, ...list])
    if (list[0]) setSelectedId(list[0].id)
    setImportOpen(false)
    flash(`IMPORTED ${list.length} CHART${list.length === 1 ? '' : 'S'}`)
  }
  const newChart = () => {
    const c = emptyChart()
    setCharts((cs) => [...cs, c])
    setSelectedId(c.id)
    setMode('edit')
    setSel({ bar: 0, beat: 0 })
  }
  const deleteChart = (id: string) => {
    const c = charts.find((x) => x.id === id)
    if (!c || c.builtIn) return
    if (!window.confirm(`Delete “${c.title}”?`)) return
    setCharts((cs) => cs.filter((x) => x.id !== id))
    if (id === selectedId) setSelectedId(charts[0].id)
  }
  const deletePlaylist = (name: string) => {
    const n = charts.filter((c) => c.playlist === name && !c.builtIn).length
    if (!n || !window.confirm(`Delete the playlist “${name}” (${n} charts)?`)) return
    setCharts((cs) => cs.filter((c) => c.builtIn || c.playlist !== name))
    if (chart.playlist === name) setSelectedId(charts[0].id)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Library
          charts={charts} selectedId={chart.id} onSelect={(id) => setSelectedId(id)}
          onImport={() => setImportOpen(true)} onNew={newChart}
          onDelete={deleteChart} onDeletePlaylist={deletePlaylist}
        />

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SongBand
            chart={chart} mode={mode} setMode={(m) => { setMode(m); if (m === 'edit') stop(); setSel(null) }}
            styleName={style.name} shownKey={shownKey}
            onTranspose={(d) => update({ ...chart, transpose: ((chart.transpose + d + 18) % 12) - 6 })}
            onStyle={(id) => update({ ...chart, jamStyle: id })}
            onPatch={(patch) => update({ ...chart, ...patch }, true)}
            onShare={share}
          />

          {mode === 'edit' && (
            <EditToolbar
              bar={chart.bars[sel?.bar ?? 0]}
              barNo={(sel?.bar ?? 0) + 1}
              onPatch={(patch) => update(patchBar(chart, sel?.bar ?? 0, patch), true)}
              onRepeat={(on) => update(setRepeatMark(chart, sel?.bar ?? 0, on ? 'x' : null), true)}
              onAdd={() => { update(insertBarAfter(chart, sel?.bar ?? chart.bars.length - 1), true); setSel({ bar: (sel?.bar ?? chart.bars.length - 1) + 1, beat: 0 }) }}
              onDuplicate={() => update(duplicateBar(chart, sel?.bar ?? 0), true)}
              onDelete={() => { update(deleteBar(chart, sel?.bar ?? 0), true); setSel(null) }}
            />
          )}

          <section aria-label="Chord chart" style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 16px', position: 'relative' }} id="jam-chart">
            <ChartGrid
              chart={chart} flats={flats} mode={mode}
              current={pos.index >= 0 && !pos.countIn ? { index: pos.index, beat: pos.beat } : null}
              loop={loop}
              onPlayFrom={(i) => play(i)}
              onLoopSelect={(a, b) => { setLoop([a, b]); setLoopOn(true); flash(`LOOPING BARS ${a + 1}–${b + 1}`) }}
              selected={sel}
              onSelectSlot={(bar, beat) => setSel({ bar, beat })}
            />
            {mode === 'edit' && sel && (
              <ChordPopover
                key={`${sel.bar}-${sel.beat}-${chart.id}`}
                chart={chart} flats={flats} sel={sel}
                onCommit={(text, move) => {
                  const b = chart.bars[sel.bar]
                  let next: Chart
                  if (text === 'x') next = setRepeatMark(chart, sel.bar, 'x')
                  else {
                    const stored = text && text !== 'n' ? transposeSymbol(text, -chart.transpose, keyPrefersFlats(chart.key)) : text
                    next = setChord(b.repeat ? setRepeatMark(chart, sel.bar, null) : chart, sel.bar, sel.beat, stored || null)
                  }
                  update(next, true)
                  if (move) setSel(moveSel(next, sel, move))
                }}
                onClose={() => setSel(null)}
              />
            )}
            {mode === 'play' && (
              <div style={{ display: 'flex', gap: 18, marginTop: 14, paddingLeft: 44, flexWrap: 'wrap' }}>
                <span style={lbl}>{chart.bars.length} BARS · {timeSigLabel(chart.timeSig)}</span>
                {loop && (
                  <button onClick={() => setLoopOn((v) => !v)} style={{ ...lbl, color: 'var(--accent-1)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    LOOP: BARS {loop[0] + 1} – {loop[1] + 1} {loopOn ? 'ON' : 'OFF'}
                  </button>
                )}
                <span style={lbl}>CLICK A BAR TO PLAY FROM THERE · DRAG ACROSS BARS TO LOOP · SPACE = PLAY / STOP</span>
              </div>
            )}
          </section>

          <VoicingStrip chord={nowChord?.cur ?? null} comp={sounding.comp} bass={sounding.bass} />
        </main>

        <BandPanel
          zones={zones} prefs={prefs} styleLabels={style.labels} styleName={style.name}
          setTrack={setTrack} setPrefs={setPrefs}
          loop={loop} loopOn={loopOn}
          onLoopToggle={() => {
            if (!loop) {
              const from = Math.max(0, pos.index >= 0 ? pos.index : 0)
              setLoop([from, Math.min(chart.bars.length - 1, from + 3)])
            }
            setLoopOn((v) => !v)
          }}
          playing={playing} sounding={sounding}
        />
      </div>

      <Transport
        playing={playing} onPlay={() => play(loopOn && loop ? loop[0] : 0)} onStop={stop}
        chorus={pos.chorus} choruses={prefs.choruses} bar={pos.index} bars={chart.bars.length}
        beat={pos.beat} countIn={pos.countIn}
        bpm={bpm} liveBpm={playing ? pos.bpm : bpm} ramp={prefs.ramp}
        onBpm={(v) => update({ ...chart, bpm: v })}
        next={nowChord?.next ?? null}
      />

      {importOpen && <ImportDialog existing={charts} onClose={() => setImportOpen(false)} onImport={doImport} />}
      {(toast || storeError) && (
        <div role="status" style={toastStyle}>{storeError ? 'LIBRARY TOO BIG TO SAVE IN THIS BROWSER — DELETE A PLAYLIST' : toast}</div>
      )}
    </div>
  )
}

function transposedBars(chart: Chart, flats: boolean): ChartBar[] {
  if (!chart.transpose) return chart.bars
  return chart.bars.map((b) => ({ ...b, chords: b.chords.map((c) => ({ ...c, text: c.text === 'n' ? 'n' : transposeSymbol(c.text, chart.transpose, flats) })) }))
}

function moveSel(chart: Chart, sel: { bar: number; beat: number }, move: 'next' | 'prev' | 'nextBar') {
  const sigs = barTimeSigs(chart)
  const beatsIn = (i: number) => Math.max(1, Math.round(barBeats(sigs[i] ?? chart.timeSig)))
  if (move === 'nextBar') return { bar: Math.min(chart.bars.length - 1, sel.bar + 1), beat: 0 }
  if (move === 'next') {
    if (sel.beat + 1 < beatsIn(sel.bar)) return { bar: sel.bar, beat: sel.beat + 1 }
    return { bar: Math.min(chart.bars.length - 1, sel.bar + 1), beat: 0 }
  }
  if (sel.beat > 0) return { bar: sel.bar, beat: sel.beat - 1 }
  return { bar: Math.max(0, sel.bar - 1), beat: 0 }
}

// ── Library rail ─────────────────────────────────────────────────────────────

function Library({ charts, selectedId, onSelect, onImport, onNew, onDelete, onDeletePlaylist }: {
  charts: Chart[]; selectedId: string
  onSelect: (id: string) => void; onImport: () => void; onNew: () => void
  onDelete: (id: string) => void; onDeletePlaylist: (name: string) => void
}) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const m = new Map<string, Chart[]>()
    for (const c of charts) { if (!m.has(c.playlist)) m.set(c.playlist, []); m.get(c.playlist)!.push(c) }
    return [...m.entries()]
  }, [charts])
  const selectedPlaylist = charts.find((c) => c.id === selectedId)?.playlist
  const [open, setOpen] = useState<Set<string>>(() => new Set([selectedPlaylist ?? '', 'Practice · built-in', 'My charts']))
  useEffect(() => { if (selectedPlaylist) setOpen((s) => (s.has(selectedPlaylist) ? s : new Set(s).add(selectedPlaylist))) }, [selectedPlaylist])

  const ql = q.trim().toLowerCase()
  const results = ql ? charts.filter((c) => c.title.toLowerCase().includes(ql) || c.composer.toLowerCase().includes(ql)).slice(0, 200) : null

  const item = (c: Chart) => {
    const sel = c.id === selectedId
    return (
      <div key={c.id} style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--border)', background: sel ? 'var(--bg)' : 'transparent' }}>
        <button onClick={() => onSelect(c.id)} aria-current={sel} style={libItem}>
          <span style={{ ...h3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title.toUpperCase()}</span>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ ...lbl, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.style.toUpperCase()}</span>
            <span style={{ fontSize: 10, fontWeight: 600 }}>{keyLabel(transposeKey(c.key, c.transpose))}</span>
          </span>
        </button>
        {sel && !c.builtIn && (
          <button aria-label={`Delete ${c.title}`} title="Delete chart" onClick={() => onDelete(c.id)} style={xBtn}>×</button>
        )}
        <span style={{ width: 4, background: sel ? 'var(--ink)' : 'transparent' }} />
      </div>
    )
  }

  return (
    <aside aria-label="Library" style={{ width: 280, flexShrink: 0, background: 'var(--surface)', borderRight: '2px solid var(--ink)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '14px 18px 10px', borderBottom: '2px solid var(--ink)' }}>
        <span style={h1}>LIBRARY</span>
        <span style={lbl}>{charts.length} CHARTS</span>
      </div>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
        <label htmlFor="jam-search" style={srOnly}>Search charts</label>
        <input id="jam-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" style={{ width: '100%', boxSizing: 'border-box', height: 32, border: 'none', borderBottom: '1.5px solid var(--ink)', background: 'transparent', fontSize: 11, outline: 'none', color: 'var(--ink)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 18px' }}>
        <button onClick={onImport} style={{ ...outlineBtn, flex: 1, height: 34, fontSize: 10, background: 'var(--ink)', color: 'var(--bg)' }}>IMPORT</button>
        <button onClick={onNew} style={{ ...outlineBtn, flex: 1, height: 34, fontSize: 10 }}>+ NEW</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {results ? (
          <>
            <div style={{ ...lbl, fontSize: 9, padding: '12px 18px 6px' }}>{results.length} MATCH{results.length === 1 ? '' : 'ES'}</div>
            {results.map(item)}
          </>
        ) : groups.map(([name, list]) => {
          const isOpen = open.has(name)
          const deletable = list.some((c) => !c.builtIn)
          return (
            <div key={name}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button aria-expanded={isOpen} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })}
                  style={{ ...lbl, fontSize: 9, flex: 1, textAlign: 'left', padding: '12px 18px 6px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 6 }}>
                  <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>{name.toUpperCase()} ({list.length})
                </button>
                {deletable && isOpen && <button aria-label={`Delete playlist ${name}`} title="Delete playlist" onClick={() => onDeletePlaylist(name)} style={{ ...xBtn, padding: '8px 14px 2px' }}>×</button>}
              </div>
              {isOpen && list.map(item)}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

// ── Song band ───────────────────────────────────────────────────────────────

function SongBand({ chart, mode, setMode, styleName, shownKey, onTranspose, onStyle, onPatch, onShare }: {
  chart: Chart; mode: 'play' | 'edit'; setMode: (m: 'play' | 'edit') => void
  styleName: string; shownKey: string
  onTranspose: (d: number) => void; onStyle: (id: string) => void
  onPatch: (p: Partial<Chart>) => void; onShare: () => void
}) {
  const styleId = chart.jamStyle ?? styleForName(chart.style).id
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', borderBottom: '2px solid var(--ink)' }}>
      <div style={{ flex: '1 1 320px', padding: '14px 24px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 0, gap: 4 }}>
        {mode === 'edit' ? (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>COMPOSER
                <input value={chart.composer} onChange={(e) => onPatch({ composer: e.target.value })} style={smallInput} /></label>
              <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6 }}>STYLE LABEL
                <input value={chart.style} onChange={(e) => onPatch({ style: e.target.value })} style={smallInput} /></label>
            </div>
            <input aria-label="Title" value={chart.title} onChange={(e) => onPatch({ title: e.target.value })} style={titleInput} />
          </>
        ) : (
          <>
            <span style={lbl}>{chart.playlist.toUpperCase()}{chart.composer ? ` · ${chart.composer.toUpperCase()}` : ''}</span>
            <div style={{ ...hero, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chart.title.toUpperCase()}</div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, padding: '14px 24px', flexWrap: 'wrap' }}>
        <Field label="STYLE">
          <select aria-label="Band style" value={styleId} onChange={(e) => onStyle(e.target.value)} style={bigSelect} title={`Chart says “${chart.style}”`}>
            {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label={chart.transpose ? `KEY · ${chart.transpose > 0 ? '+' : ''}${chart.transpose}` : 'KEY'}>
          {mode === 'edit' ? (
            <select aria-label="Key" value={chart.key} onChange={(e) => onPatch({ key: e.target.value })} style={{ ...bigSelect, width: 84 }}>
              {KEYS.map((k) => <option key={k} value={k}>{keyLabel(k)}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button aria-label="Transpose down" onClick={() => onTranspose(-1)} style={{ ...outlineBtn, width: 40, height: 40, padding: 0 }}>−</button>
              <span style={{ width: 64, height: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1.5px solid var(--ink)', borderBottom: '1.5px solid var(--ink)', fontFamily: 'var(--font-display)', fontSize: 26 }}>{keyLabel(shownKey)}</span>
              <button aria-label="Transpose up" onClick={() => onTranspose(1)} style={{ ...outlineBtn, width: 40, height: 40, padding: 0 }}>+</button>
            </div>
          )}
        </Field>
        <Field label="TIME">
          {mode === 'edit' ? (
            <select aria-label="Time signature" value={chart.timeSig} onChange={(e) => onPatch({ timeSig: e.target.value })} style={{ ...bigSelect, width: 72 }}>
              {TIME_SIGS.map((t) => <option key={t} value={t}>{timeSigLabel(t)}</option>)}
            </select>
          ) : <span style={{ height: 40, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-display)', fontSize: 26 }}>{timeSigLabel(chart.timeSig)}</span>}
        </Field>
        <Field label="CHART">
          <Segmented label="Chart mode" options={[['play', 'PLAY'], ['edit', 'EDIT']] as const} value={mode} onChange={setMode} height={40} />
        </Field>
        <button onClick={onShare} title="Copy an iReal Pro link to this chart" style={{ ...outlineBtn, height: 40 }}>SHARE ↗</button>
        <span style={srOnly}>{styleName}</span>
      </div>
    </div>
  )
}

// ── Edit toolbar ────────────────────────────────────────────────────────────

function EditToolbar({ bar, barNo, onPatch, onRepeat, onAdd, onDuplicate, onDelete }: {
  bar: ChartBar | undefined; barNo: number
  onPatch: (p: Partial<ChartBar>) => void; onRepeat: (on: boolean) => void
  onAdd: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  if (!bar) return null
  const tool = (on: boolean): CSSProperties => ({
    ...outlineBtn, height: 34, minWidth: 40, padding: '0 10px', marginRight: -1.5, fontSize: 11, letterSpacing: '0.06em',
    background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--bg)' : 'var(--ink)', position: 'relative', zIndex: on ? 1 : 0,
  })
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <span style={{ ...headText, alignSelf: 'center' }}>BAR {barNo}</span>
      <Field label="START">
        <div style={{ display: 'flex' }}>
          <button style={tool(!bar.open)} onClick={() => onPatch({ open: undefined })} title="Single barline">|</button>
          <button style={tool(bar.open === '[')} onClick={() => onPatch({ open: '[' })} title="Double barline">‖</button>
          <button style={tool(bar.open === '{')} onClick={() => onPatch({ open: '{' })} title="Repeat start">𝄆</button>
        </div>
      </Field>
      <Field label="END">
        <div style={{ display: 'flex' }}>
          <button style={tool(!bar.close)} onClick={() => onPatch({ close: undefined })} title="Single barline">|</button>
          <button style={tool(bar.close === ']')} onClick={() => onPatch({ close: ']' })} title="Double barline">‖</button>
          <button style={tool(bar.close === '}')} onClick={() => onPatch({ close: '}' })} title="Repeat end">𝄇</button>
          <button style={tool(bar.close === 'Z')} onClick={() => onPatch({ close: 'Z' })} title="Final barline">𝄂</button>
        </div>
      </Field>
      <Field label="SECTION">
        <div style={{ display: 'flex' }}>
          {['A', 'B', 'C', 'D', 'i', 'V'].map((s) => (
            <button key={s} style={tool(bar.section === s)} onClick={() => onPatch({ section: bar.section === s ? undefined : s })}>{s}</button>
          ))}
        </div>
      </Field>
      <Field label="ENDING">
        <div style={{ display: 'flex' }}>
          <button style={tool(bar.ending === undefined)} onClick={() => onPatch({ ending: undefined })}>—</button>
          {[1, 2, 3].map((n) => <button key={n} style={tool(bar.ending === n)} onClick={() => onPatch({ ending: n })}>{n}.</button>)}
        </div>
      </Field>
      <Field label="MARK">
        <div style={{ display: 'flex', gap: 6 }}>
          <select aria-label="Staff text" value={MARKS.includes(bar.text ?? '') ? bar.text ?? '' : ''} onChange={(e) => onPatch({ text: e.target.value || undefined })} style={{ ...bigSelect, height: 34, fontSize: 11 }}>
            {MARKS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}
          </select>
          <button style={tool(!!bar.segno)} onClick={() => onPatch({ segno: bar.segno ? undefined : true })} title="Segno">𝄋</button>
          <button style={tool(!!bar.coda)} onClick={() => onPatch({ coda: bar.coda ? undefined : true })} title="Coda">𝄌</button>
          <button style={tool(bar.repeat === 'x')} onClick={() => onRepeat(bar.repeat !== 'x')} title="Repeat the previous bar">%</button>
        </div>
      </Field>
      <Field label="BAR">
        <div style={{ display: 'flex' }}>
          <button style={tool(false)} onClick={onAdd}>+ AFTER</button>
          <button style={tool(false)} onClick={onDuplicate}>DUPLICATE</button>
          <button style={tool(false)} onClick={onDelete}>DELETE</button>
        </div>
      </Field>
    </div>
  )
}

// ── Chord popover ───────────────────────────────────────────────────────────

function ChordPopover({ chart, flats, sel, onCommit, onClose }: {
  chart: Chart; flats: boolean; sel: { bar: number; beat: number }
  onCommit: (text: string, move?: 'next' | 'prev' | 'nextBar') => void
  onClose: () => void
}) {
  const bar = chart.bars[sel.bar]
  const existing = bar?.chords.find((c) => Math.floor(c.beat) === sel.beat)
  const initial = bar?.repeat && sel.beat === 0 ? '%' : existing ? (existing.text === 'n' ? 'N.C.' : transposeSymbol(existing.text, chart.transpose, flats)) : ''
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const host = document.getElementById('jam-chart')
    const el = host?.querySelector(`[data-slot="${sel.bar}-${sel.beat}"]`) as HTMLElement | null
    if (!host || !el) return
    const h = host.getBoundingClientRect(), r = el.getBoundingClientRect()
    setAt({ left: Math.min(r.left - h.left + host.scrollLeft, h.width - 500), top: r.bottom - h.top + host.scrollTop + 12 })
  }, [sel.bar, sel.beat])
  // focus once visible (a hidden input can't take focus)
  const placed = at !== null
  useEffect(() => {
    if (!placed) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [placed])

  const t = draft.trim()
  const special = t === '' ? 'clear' : /^(n|n\.?c\.?)$/i.test(t) ? 'nc' : /^(%|x)$/i.test(t) ? 'repeat' : null
  const parsed = special ? null : parseChord(t)
  const valid = special !== null || !!parsed?.ok
  const out = special === 'clear' ? '' : special === 'nc' ? 'n' : special === 'repeat' ? 'x' : parsed?.text ?? ''

  const commit = (move?: 'next' | 'prev' | 'nextBar') => { if (valid) onCommit(out, move) }
  const quick = (q: string) => {
    const root = (parsed?.ok ? parsed.text.match(/^[A-G][b#]?/)?.[0] : t.match(/^[A-Ga-g][b#]?/)?.[0]) ?? 'C'
    setDraft(root[0].toUpperCase() + root.slice(1) + q)
    inputRef.current?.focus()
  }

  return (
    <div role="dialog" aria-label={`Edit bar ${sel.bar + 1} beat ${sel.beat + 1}`} style={{
      position: 'absolute', left: Math.max(8, at?.left ?? 60), top: at?.top ?? 80, width: 470, zIndex: 50,
      background: '#fff', border: '2px solid var(--ink)', boxShadow: '6px 6px 0 var(--ink)', padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12, visibility: at ? 'visible' : 'hidden',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label htmlFor="jam-chord-in" style={{ ...lbl, fontSize: 9, whiteSpace: 'nowrap' }}>BAR {sel.bar + 1} · BEAT {sel.beat + 1}</label>
        <input
          id="jam-chord-in" ref={inputRef} value={draft} spellCheck={false} autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit('nextBar') }
            else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'prev' : 'next') }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
          aria-invalid={!valid}
          style={{ flex: 1, height: 40, border: `1.5px solid ${valid ? 'var(--accent-1)' : 'var(--accent-2)'}`, outline: 'none', fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, padding: '0 10px', background: '#fff', color: 'var(--ink)', borderRadius: 0 }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, minHeight: 34 }}>
        {special === 'clear' ? <span style={lbl}>EMPTY · ENTER CLEARS THIS BEAT</span>
          : special === 'nc' ? <><ChordSymbol text="n" size="md" /><span style={{ ...lbl, color: 'var(--accent-1)' }}>✓ NO CHORD</span></>
          : special === 'repeat' ? <><ChordSymbol text="x" size="md" /><span style={{ ...lbl, color: 'var(--accent-1)' }}>✓ REPEAT PREVIOUS BAR</span></>
          : parsed?.ok && parsed.chord ? (
            <>
              <ChordSymbol text={parsed.text} size="md" />
              <span style={{ ...lbl, color: 'var(--accent-1)', textAlign: 'right', whiteSpace: 'normal', lineHeight: 1.5 }}>
                ✓ {describeChord(parsed.chord, flats).toUpperCase()} · {parsed.chord.intervals.filter((i) => i < 12).map((i) => pcName(parsed.chord!.root + i, flats)).join(' ').replace(/b/g, '♭')}
              </span>
            </>
          ) : <span style={{ ...lbl, color: '#B3281B', whiteSpace: 'normal', lineHeight: 1.5 }}>{(parsed?.error ?? 'INVALID').toUpperCase()}. COMMON SPELLINGS LIKE MAJ7, M7, Ø, DIM ARE FINE.</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...lbl, fontSize: 9 }}>QUICK QUALITY</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
          {QUICK_QUALITIES.map(([label, q]) => (
            <button key={q} onClick={() => quick(q)} style={{ height: 32, margin: '0 -1.5px -1.5px 0', border: '1.5px solid var(--ink)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 0, color: 'var(--ink)' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...lbl, fontSize: 9 }}>N = NO CHORD · % = REPEAT BAR · TAB = NEXT BEAT</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...outlineBtn, height: 30 }} onClick={() => onCommit('', undefined)}>CLEAR</button>
          <button disabled={!valid} style={{ ...outlineBtn, height: 30, background: valid ? 'var(--accent-1)' : 'transparent', color: valid ? '#fff' : 'var(--label)', borderColor: valid ? 'var(--accent-1)' : 'var(--border)' }} onClick={() => commit('nextBar')}>OK ↵</button>
        </div>
      </div>
    </div>
  )
}

// ── Band panel ──────────────────────────────────────────────────────────────

function BandPanel({ zones, prefs, styleLabels, styleName, setTrack, setPrefs, loop, loopOn, onLoopToggle, playing, sounding }: {
  zones: Zone[]; prefs: BandPrefs; styleLabels: Record<Track, string>; styleName: string
  setTrack: (t: Track, p: Partial<TrackSettings>) => void
  setPrefs: (fn: (p: BandPrefs) => BandPrefs) => void
  loop: [number, number] | null; loopOn: boolean; onLoopToggle: () => void
  playing: boolean; sounding: { comp: number[]; bass: number[] }
}) {
  const anySolo = (Object.keys(prefs.tracks) as Track[]).some((k) => prefs.tracks[k].solo)
  return (
    <aside aria-label="Band" style={{ width: 330, flexShrink: 0, borderLeft: '2px solid var(--ink)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '14px 18px 10px', borderBottom: '2px solid var(--ink)' }}>
        <span style={h1}>BAND</span>
        <span style={lbl}>{styleName.toUpperCase()}</span>
      </div>
      {(['drums', 'bass', 'comp'] as Track[]).map((t) => {
        const tr = prefs.tracks[t]
        const zone = zones.find((z) => z.id === tr.zoneId)
        const silent = tr.mute || (anySolo && !tr.solo)
        const level = !playing || silent ? 0 : t === 'drums' ? 70 : t === 'bass' ? (sounding.bass.length ? 60 : 8) : (sounding.comp.length ? 75 : 8)
        return (
          <div key={t} style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: silent ? 'var(--bypass)' : 'transparent' }}>
            <span style={{ width: 6, flexShrink: 0, background: zone?.color ?? 'var(--ink)' }} />
            <div style={{ flex: 1, minWidth: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28 }}>
                <span style={{ ...h2, color: silent ? 'var(--label)' : 'var(--ink)' }}>{TRACK_NAMES[t]}</span>
                <div style={{ display: 'flex' }}>
                  <button aria-pressed={tr.mute} aria-label={`Mute ${t}`} onClick={() => setTrack(t, { mute: !tr.mute })} style={msBtn(tr.mute, 'var(--ink)')}>M</button>
                  <button aria-pressed={tr.solo} aria-label={`Solo ${t}`} onClick={() => setTrack(t, { solo: !tr.solo })} style={msBtn(tr.solo, 'var(--accent-1)')}>S</button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={`jam-zone-${t}`} style={{ ...lbl, fontSize: 9 }}>SOUND</label>
                  <select id={`jam-zone-${t}`} value={zone ? tr.zoneId : 'builtin'} onChange={(e) => setTrack(t, { zoneId: e.target.value })} style={{ ...bigSelect, height: 32, fontSize: 10, width: '100%' }}>
                    <option value="builtin">BUILT-IN {t === 'drums' ? 'KIT' : t === 'bass' ? 'BASS' : 'KEYS'}</option>
                    {[...zones].sort((a, b) => (t === 'drums' ? Number(!!b.drums) - Number(!!a.drums) : 0)).map((z) => (
                      <option key={z.id} value={z.id}>
                        ZONE · {z.name.toUpperCase()} ({(z.engine ?? 'soundfont') === 'soundfont' ? `SF2${z.drums ? ' DRUM KIT' : ''} CH ${z.channel + 1}` : (z.engine ?? '').toUpperCase()})
                      </option>
                    ))}
                  </select>
                  {t === 'drums' && zone && (zone.engine ?? 'soundfont') === 'soundfont' && !zone.drums
                    ? <span style={{ ...lbl, fontSize: 9, color: '#B3281B', whiteSpace: 'normal' }}>THIS ZONE HAS A MELODIC PRESET — PICK A DRUM KIT IN ZONES</span>
                    : <span style={{ ...lbl, fontSize: 9 }}>PATTERN · <span style={{ color: 'var(--ink)' }}>{styleLabels[t]}</span></span>}
                </div>
                <Knob label="VOL" size={46} value={tr.volume} min={0} max={1} defaultValue={DEFAULT_PREFS.tracks[t].volume}
                  dimmed={silent} onChange={(v) => setTrack(t, { volume: v })} display={(v) => `${Math.round(v * 100)}`} />
                <div aria-hidden="true" style={{ width: 6, height: 64, background: '#fff', border: '1px solid var(--ink)', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${level}%`, background: 'var(--accent-1)', transition: 'height 80ms ease-out' }} />
                </div>
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 28, borderBottom: '2px solid var(--ink)', paddingBottom: 6 }}>
          <span style={headText}>PRACTICE</span><span style={lbl}>YOU PLAY ON ZONES · IN / BOTH</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px' }}>
          <Stepper label="CHORUSES" value={prefs.choruses === 0 ? '∞' : String(prefs.choruses)}
            onDec={() => setPrefs((p) => ({ ...p, choruses: p.choruses === 0 ? 20 : Math.max(1, p.choruses - 1) }))}
            onInc={() => setPrefs((p) => ({ ...p, choruses: p.choruses === 0 ? 0 : p.choruses >= 20 ? 0 : p.choruses + 1 }))} />
          <Stepper label="TEMPO RAMP" value={prefs.ramp === 0 ? 'OFF' : `${prefs.ramp > 0 ? '+' : ''}${prefs.ramp} / CH`}
            onDec={() => setPrefs((p) => ({ ...p, ramp: Math.max(-10, p.ramp - 2) }))}
            onInc={() => setPrefs((p) => ({ ...p, ramp: Math.min(20, p.ramp + 2) }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Toggle on={prefs.countIn} onClick={() => setPrefs((p) => ({ ...p, countIn: !p.countIn }))}>COUNT-IN</Toggle>
          <Toggle on={prefs.click} onClick={() => setPrefs((p) => ({ ...p, click: !p.click }))}>CLICK</Toggle>
          <Toggle on={loopOn} onClick={onLoopToggle}>{loop ? `LOOP ${loop[0] + 1}–${loop[1] + 1}` : 'LOOP BARS'}</Toggle>
        </div>
      </div>
    </aside>
  )
}

// ── Transport ───────────────────────────────────────────────────────────────

function Transport({ playing, onPlay, onStop, chorus, choruses, bar, bars, beat, countIn, bpm, liveBpm, ramp, onBpm, next }: {
  playing: boolean; onPlay: () => void; onStop: () => void
  chorus: number; choruses: number; bar: number; bars: number; beat: number; countIn: boolean
  bpm: number; liveBpm: number; ramp: number; onBpm: (v: number) => void; next: string | null
}) {
  const big: CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 34, lineHeight: 0.95 }
  const dim: CSSProperties = { fontSize: 20, color: 'var(--label)' }
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '2px solid var(--ink)', background: 'var(--bg)', flexWrap: 'wrap', minHeight: 76, flexShrink: 0 }}>
      <button
        onClick={playing ? onStop : onPlay}
        aria-label={playing ? 'Stop' : 'Play'}
        style={{ width: 160, background: playing ? 'var(--accent-1)' : 'var(--ink)', color: '#fff', border: 'none', borderRight: '2px solid var(--ink)', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '0.04em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">{playing ? <rect x={1} y={1} width={14} height={14} fill="#fff" /> : <path d="M2 1 L15 8 L2 15 Z" fill="#fff" />}</svg>
        {playing ? 'STOP' : 'PLAY'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '0 24px', borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ ...lbl, fontSize: 9 }}>CHORUS</span>
          <span style={big}>{playing && !countIn ? chorus : '–'}<span style={dim}> / {choruses === 0 ? '∞' : choruses}</span></span></div>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ ...lbl, fontSize: 9 }}>BAR</span>
          <span style={big}>{playing && bar >= 0 ? String(bar + 1).padStart(2, '0') : '––'}<span style={dim}> / {bars}</span></span></div>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ ...lbl, fontSize: 9 }}>{countIn ? 'COUNT' : 'BEAT'}</span>
          <span style={{ ...big, color: countIn ? 'var(--accent-1)' : 'var(--ink)' }}>{playing ? beat + 1 : '–'}</span></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', borderRight: '1px solid var(--border)' }}>
        <Knob label="TEMPO" size={52} value={bpm} min={40} max={320} step={1} defaultValue={120} onChange={(v) => onBpm(Math.round(v))} display={() => ''} />
        <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ ...lbl, fontSize: 9 }}>TEMPO</span>
          <span style={big}>{Math.round(liveBpm)}<span style={{ fontSize: 16, color: 'var(--label)' }}> BPM</span></span>
          {ramp !== 0 && <span style={{ ...lbl, fontSize: 9, color: 'var(--accent-1)' }}>{bpm} → {ramp > 0 ? '+' : ''}{ramp} / CHORUS</span>}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px' }}>
        <span style={lbl}>NEXT</span>
        {next ? <ChordSymbol text={next} size="md" /> : <span style={lbl}>—</span>}
      </div>
    </div>
  )
}

// ── Voicing strip ───────────────────────────────────────────────────────────

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12)
const WHITES: number[] = []
for (let m = 21; m <= 108; m++) if (!isBlack(m)) WHITES.push(m)

function VoicingStrip({ chord, comp, bass }: { chord: string | null; comp: number[]; bass: number[] }) {
  const colour = (m: number) => (comp.includes(m) ? 'var(--accent-1)' : bass.includes(m) ? '#fb923c' : null)
  let wi = 0
  const blacks: { m: number; left: number }[] = []
  for (let m = 21; m <= 108; m++) {
    if (!isBlack(m)) wi++
    else blacks.push({ m, left: (wi / WHITES.length) * 100 - 0.575 })
  }
  return (
    <div style={{ borderTop: '2px solid var(--ink)', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
      <div style={{ width: 160, flexShrink: 0, padding: '8px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, borderRight: '1px solid var(--border)' }}>
        <span style={{ ...lbl, fontSize: 9 }}>NOW</span>
        {chord ? <ChordSymbol text={chord} size="md" /> : <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1, color: 'var(--label)' }}>—</span>}
        <span style={{ display: 'flex', gap: 10 }}>
          <span style={{ ...lbl, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--accent-1)' }} />COMP</span>
          <span style={{ ...lbl, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: '#fb923c' }} />BASS</span>
        </span>
      </div>
      <div aria-hidden="true" style={{ flex: 1, position: 'relative', height: 70, background: '#fff', overflow: 'hidden' }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {WHITES.map((m) => <div key={m} style={{ flex: '1 1 0', borderRight: '1px solid #D8D5CC', background: colour(m) ?? '#fff' }} />)}
        </div>
        {blacks.map((b) => <div key={b.m} style={{ position: 'absolute', top: 0, height: '58%', width: '1.15%', left: `${b.left}%`, background: colour(b.m) ?? 'var(--ink)' }} />)}
      </div>
    </div>
  )
}

// ── small parts ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={lbl}>{label}</span>{children}</div>
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...lbl, fontSize: 9 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button aria-label={`${label} down`} onClick={onDec} style={{ ...outlineBtn, width: 32, height: 32, padding: 0 }}>−</button>
        <span style={{ flex: 1, height: 32, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1.5px solid var(--ink)', borderBottom: '1.5px solid var(--ink)', fontWeight: 600, fontSize: 11 }}>{value}</span>
        <button aria-label={`${label} up`} onClick={onInc} style={{ ...outlineBtn, width: 32, height: 32, padding: 0 }}>+</button>
      </div>
    </div>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-pressed={on} onClick={onClick} style={{
      ...outlineBtn, height: 30, padding: '0 10px', fontSize: 10,
      background: on ? 'var(--accent-1)' : 'transparent', color: on ? '#fff' : 'var(--ink)', borderColor: on ? 'var(--accent-1)' : 'var(--ink)',
    }}>{children}</button>
  )
}

const msBtn = (on: boolean, c: string): CSSProperties => ({
  height: 26, minWidth: 30, marginLeft: -1.5, border: '1.5px solid var(--ink)', borderRadius: 0, cursor: 'pointer',
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
  background: on ? c : 'transparent', color: on ? '#fff' : 'var(--ink)',
})
const libItem: CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 18px', textAlign: 'left',
  border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', color: 'var(--ink)', borderRadius: 0,
}
const xBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--label)', fontSize: 16, padding: '0 10px' }
const bigSelect: CSSProperties = {
  height: 40, background: '#fff', border: '1.5px solid var(--ink)', borderRadius: 0, color: 'var(--ink)',
  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', padding: '0 8px',
}
const smallInput: CSSProperties = {
  height: 26, border: 'none', borderBottom: '1.5px solid var(--ink)', background: 'transparent', fontSize: 11, color: 'var(--ink)', outline: 'none', width: 150,
}
const titleInput: CSSProperties = {
  ...hero, background: 'transparent', border: 'none',
  borderBottom: '1.5px dashed var(--label)', outline: 'none', color: 'var(--ink)', padding: 0, width: '100%', minWidth: 0, textTransform: 'uppercase',
}
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
  background: 'var(--ink)', color: 'var(--bg)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em',
  padding: '10px 16px', boxShadow: '4px 4px 0 var(--accent-1)',
}
const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
