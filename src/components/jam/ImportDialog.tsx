import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Chart } from '../../jam/model'
import { importText } from '../../jam/ireal'
import { styleForName } from '../../jam/styles'
import { h1, h3, headText, lbl, outlineBtn } from '../controls'

interface Props {
  existing: Chart[]
  onClose: () => void
  onImport: (charts: Chart[]) => void
}

const key = (c: Chart) => `${c.title.toLowerCase()}|${c.composer.toLowerCase()}`
const SHOW = 200

/** Paste an iReal link / playlist or drop an exported HTML file. */
export function ImportDialog({ existing, onClose, onImport }: Props) {
  const [text, setText] = useState('')
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { areaRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const result = useMemo(() => (text.trim() ? importText(text) : null), [text])
  const charts = result?.charts ?? []
  const have = useMemo(() => new Set(existing.map(key)), [existing])
  const dup = (c: Chart) => have.has(key(c))
  const isChecked = (c: Chart) => !unchecked.has(c.id) && !dup(c)
  const selected = charts.filter(isChecked)
  const playlists = [...new Set(charts.map((c) => c.playlist))]
  const styleMap = [...new Set(charts.map((c) => c.style))].slice(0, 6).map((s) => `${s.toUpperCase()} → ${styleForName(s).name.toUpperCase()}`)

  const readFile = async (f: File | undefined) => {
    if (!f) return
    setText(await f.text())
    setUnchecked(new Set())
  }

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="jam-import-title" style={dialog}>
        <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '2px solid var(--ink)' }}>
          <div style={{ width: 6, background: 'var(--accent-1)' }} />
          <div style={{ flex: 1, padding: '14px 20px 10px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div id="jam-import-title" style={h1}>IMPORT CHARTS</div>
            <span style={lbl}>iREAL PRO · irealb:// · irealbook://</span>
          </div>
          <button aria-label="Close" onClick={onClose} style={{ width: 56, border: 'none', borderLeft: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
            <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1 L13 13 M13 1 L1 13" stroke="var(--ink)" strokeWidth={1.8} /></svg>
          </button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="jam-import-text" style={{ ...lbl, fontSize: 9 }}>PASTE A LINK OR PLAYLIST</label>
              <textarea
                id="jam-import-text" ref={areaRef} value={text}
                onChange={(e) => { setText(e.target.value); setUnchecked(new Set()) }}
                placeholder="irealb://… or irealbook://…"
                style={{ height: 74, resize: 'none', border: '1.5px solid var(--ink)', background: '#fff', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, padding: '8px 10px', color: '#3E3D38', borderRadius: 0 }}
              />
            </div>
            <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ ...lbl, fontSize: 9 }}>OR A FILE</span>
              <input ref={fileRef} type="file" accept=".html,.htm,.txt" style={{ display: 'none' }}
                onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }} />
              <button
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files?.[0]) }}
                style={{ flex: 1, border: `1.5px dashed ${dragOver ? 'var(--accent-1)' : 'var(--label)'}`, background: dragOver ? 'rgba(26,107,181,.08)' : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--accent-1)', cursor: 'pointer', lineHeight: 1.6, borderRadius: 0 }}
              >DROP .HTML EXPORT<br />OR CLICK TO BROWSE</button>
            </div>
          </div>

          {result && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, height: 28, borderBottom: '2px solid var(--ink)', paddingBottom: 6 }}>
                <span style={headText}>
                  {charts.length === 0 ? 'NO CHARTS FOUND' : `FOUND · ${playlists.length === 1 ? `“${playlists[0].toUpperCase()}” · ` : `${playlists.length} PLAYLISTS · `}${charts.length} CHART${charts.length === 1 ? '' : 'S'}`}
                </span>
                {charts.length > 0 && (
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...outlineBtn, height: 24, fontSize: 9, padding: '0 8px' }} onClick={() => setUnchecked(new Set())}>ALL</button>
                    <button style={{ ...outlineBtn, height: 24, fontSize: 9, padding: '0 8px' }} onClick={() => setUnchecked(new Set(charts.map((c) => c.id)))}>NONE</button>
                  </span>
                )}
              </div>
              <div role="list" style={{ overflowY: 'auto', maxHeight: 260, minHeight: 0 }}>
                {charts.slice(0, SHOW).map((c) => {
                  const d = dup(c)
                  const on = isChecked(c)
                  return (
                    <label key={c.id} role="listitem" style={{ ...row, background: on ? 'transparent' : 'var(--bypass)', cursor: d ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={on} disabled={d} aria-label={`Import ${c.title}`}
                        onChange={() => setUnchecked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent-1)', margin: '0 0 0 6px' }} />
                      <span style={{ ...h3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title.toUpperCase()}</span>
                      <span style={{ ...lbl, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.composer.toUpperCase()}</span>
                      <span style={{ ...lbl, fontSize: 9 }}>{c.style.toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{c.key.replace('b', '♭').replace('-', '–')}</span>
                      <span style={{ ...lbl, fontSize: 9, color: d ? '#B3281B' : 'var(--label)' }}>{d ? 'ALREADY IN LIBRARY' : `${c.bars.length} BARS`}</span>
                    </label>
                  )
                })}
                {charts.length > SHOW && <div style={{ ...lbl, padding: '10px 6px' }}>…AND {charts.length - SHOW} MORE (ALL IMPORTED UNLESS UNTICKED ABOVE)</div>}
              </div>
              {styleMap.length > 0 && (
                <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ ...lbl, fontSize: 9 }}>STYLE MAPPING</span>
                  <span style={{ ...lbl, fontSize: 9, color: 'var(--ink)', whiteSpace: 'normal', lineHeight: 1.6 }}>{styleMap.join(' · ')}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: '2px solid var(--ink)', background: 'var(--surface)', flexWrap: 'wrap' }}>
          <span style={{ ...lbl, fontSize: 9 }}>IN iREAL PRO: SHARE › EXPORT AS iREAL PRO LINK, OR EMAIL THE PLAYLIST AS HTML</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ ...outlineBtn, height: 40 }} onClick={onClose}>CANCEL</button>
            <button
              disabled={selected.length === 0}
              onClick={() => onImport(selected)}
              style={{ ...outlineBtn, height: 40, background: selected.length ? 'var(--accent-1)' : 'transparent', color: selected.length ? '#fff' : 'var(--label)', borderColor: selected.length ? 'var(--accent-1)' : 'var(--border)', cursor: selected.length ? 'pointer' : 'default' }}
            >IMPORT {selected.length} CHART{selected.length === 1 ? '' : 'S'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const backdrop: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(17,17,17,.45)', zIndex: 200,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}
const dialog: CSSProperties = {
  width: 'min(760px, 100%)', maxHeight: 'calc(100vh - 32px)', background: 'var(--bg)', border: '2px solid var(--ink)',
  boxShadow: '8px 8px 0 var(--ink)', display: 'flex', flexDirection: 'column', color: 'var(--ink)',
}
const row: CSSProperties = {
  display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) 150px 120px 44px 130px', alignItems: 'center',
  gap: 10, height: 44, borderBottom: '1px solid var(--border)',
}
