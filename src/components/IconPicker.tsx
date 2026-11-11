import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ClipboardEvent, DragEvent } from 'react'
import type { Zone, ZoneIcon } from '../types'
import { BUILTIN_ICONS } from '../icons/builtin'
import { importSvg, nameFromFile } from '../icons/svg'
import { iconId, loadIconLibrary, saveIconLibrary } from '../icons/library'
import { IconGlyph, resolveZoneIcon } from './ZoneIconView'
import { h3, lbl, outlineBtn } from './controls'

interface Props {
  zone: Zone
  /** The button that opened the picker; the popover is placed under it. */
  anchor: HTMLElement | null
  /** undefined → back to auto (guessed from the name). */
  onChange: (icon: ZoneIcon | undefined) => void
  onClose: () => void
}

const nounSearch = (q: string) => `https://thenounproject.com/search/icons/?q=${encodeURIComponent(q.trim() || 'musical instrument')}`

/** Popover for choosing a zone's icon: Perry's set, or an SVG from the Noun Project. */
export function IconPicker({ zone, anchor, onChange, onClose }: Props) {
  const [library, setLibrary] = useState<ZoneIcon[]>(loadIconLibrary)
  const [term, setTerm] = useState(zone.name)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const current = resolveZoneIcon(zone)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!rootRef.current?.contains(t) && !t.closest('[data-icon-trigger]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [onClose])

  useEffect(() => { rootRef.current?.focus({ preventScroll: true }) }, [])

  // fixed to the viewport so the zone page's scroll area can't clip it
  const [place, setPlace] = useState<CSSProperties>({})
  useEffect(() => {
    const update = () => {
      const r = anchor?.getBoundingClientRect()
      if (!r) return
      const top = r.bottom + 8
      setPlace({ top, left: Math.max(16, Math.min(r.left, window.innerWidth - 416)), maxHeight: Math.max(240, window.innerHeight - top - 16) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [anchor])

  const addSvg = (text: string, fileName?: string) => {
    const res = importSvg(text)
    if (!res) { setError("THAT DOESN'T LOOK LIKE AN SVG ICON — DOWNLOAD IT AS SVG AND TRY AGAIN"); return }
    setError(null)
    const icon: ZoneIcon = { id: iconId(res.svg), svg: res.svg, name: fileName ? nameFromFile(fileName) : zone.name || 'Icon', credit: res.credit ?? undefined }
    const next = [icon, ...library.filter((i) => i.id !== icon.id)].slice(0, 60)
    setLibrary(next)
    saveIconLibrary(next)
    onChange(icon)
  }

  const readFile = async (f: File | undefined | null) => {
    if (!f) return
    if (!/svg/i.test(f.type) && !/\.svg$/i.test(f.name)) { setError('PNG ICONS CAN’T BE RECOLOURED — CHOOSE THE SVG DOWNLOAD'); return }
    addSvg(await f.text(), f.name)
  }

  const onPaste = (e: ClipboardEvent) => {
    const file = e.clipboardData.files?.[0]
    if (file) { e.preventDefault(); readFile(file); return }
    const text = e.clipboardData.getData('text')
    if (/<svg[\s>]/i.test(text)) { e.preventDefault(); addSvg(text) }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) { readFile(file); return }
    const text = e.dataTransfer.getData('text')
    if (text) addSvg(text)
  }

  const remove = (id: string) => {
    const next = library.filter((i) => i.id !== id)
    setLibrary(next)
    saveIconLibrary(next)
  }

  const isCurrent = (id: string) => !current?.auto && current?.icon.id === id

  return (
    <div
      ref={rootRef} role="dialog" aria-label="Choose an icon" tabIndex={-1}
      onPaste={onPaste} style={{ ...pop, ...place }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 10px', borderBottom: '2px solid var(--ink)' }}>
        <span style={h3}>ICON</span>
        <span style={{ ...lbl, fontSize: 9, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current?.auto ? 'AUTO · FROM THE NAME' : current?.icon.credit ? current.icon.credit.toUpperCase() : current ? 'CHOSEN' : 'NONE'}
        </span>
        <button aria-label="Close" onClick={onClose} style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
          <svg width={12} height={12} viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1 L13 13 M13 1 L1 13" stroke="var(--ink)" strokeWidth={1.8} /></svg>
        </button>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...lbl, fontSize: 9 }}>PERRY</span>
          <div role="listbox" aria-label="Built-in icons" style={grid}>
            {BUILTIN_ICONS.map((b) => (
              <button key={b.id} role="option" aria-selected={isCurrent(b.id)} title={b.name}
                onClick={() => onChange({ id: b.id })} style={tile(isCurrent(b.id))}>
                <IconGlyph icon={{ id: b.id }} size={26} />
              </button>
            ))}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ ...lbl, fontSize: 9 }}>FROM THE NOUN PROJECT</span>
          <form
            onSubmit={(e) => { e.preventDefault(); window.open(nounSearch(term), '_blank', 'noopener') }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input aria-label="Search the Noun Project" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="guitar, drums, sax…"
              style={{ flex: 1, minWidth: 0, height: 34, border: '1.5px solid var(--ink)', borderRadius: 0, background: '#fff', padding: '0 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }} />
            <button type="submit" style={{ ...outlineBtn, height: 34, fontSize: 10, padding: '0 10px' }}>SEARCH ↗</button>
          </form>
          <input ref={fileRef} type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }}
            onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }} />
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              height: 58, border: `1.5px dashed ${dragOver ? 'var(--accent-1)' : 'var(--label)'}`, borderRadius: 0,
              background: dragOver ? 'rgba(26,107,181,.08)' : 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', lineHeight: 1.6, color: 'var(--accent-1)',
            }}
          >DROP THE DOWNLOADED SVG HERE<br />PASTE IT · OR CLICK TO BROWSE</button>
          <span style={{ ...lbl, fontSize: 9, whiteSpace: 'normal', lineHeight: 1.5, color: error ? '#B3281B' : 'var(--label)' }}>
            {error ?? 'SEARCH OPENS A NEW TAB. DOWNLOAD AN ICON AS SVG AND BRING IT BACK — PERRY KEEPS THE CREATOR’S CREDIT FROM THE FILE.'}
          </span>
        </section>

        {library.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...lbl, fontSize: 9 }}>YOURS · KEPT IN THIS BROWSER</span>
            <div role="listbox" aria-label="Imported icons" style={grid}>
              {library.map((i) => (
                <div key={i.id} style={{ position: 'relative' }}>
                  <button role="option" aria-selected={isCurrent(i.id)} title={[i.name, i.credit].filter(Boolean).join(' — ')}
                    onClick={() => onChange(i)} style={{ ...tile(isCurrent(i.id)), width: '100%' }}>
                    <IconGlyph icon={i} size={26} />
                  </button>
                  <button aria-label={`Forget ${i.name ?? 'icon'}`} title="Remove from your icons" onClick={() => remove(i.id)} style={forget}>×</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: '2px solid var(--ink)', background: 'var(--surface)' }}>
        <button onClick={() => onChange(undefined)} aria-pressed={!!current?.auto} style={{ ...outlineBtn, height: 30, fontSize: 10, padding: '0 10px', background: current?.auto ? 'var(--ink)' : 'transparent', color: current?.auto ? 'var(--bg)' : 'var(--ink)' }}>AUTO</button>
        <button onClick={() => onChange({ id: 'none' })} aria-pressed={!current} style={{ ...outlineBtn, height: 30, fontSize: 10, padding: '0 10px', background: !current ? 'var(--ink)' : 'transparent', color: !current ? 'var(--bg)' : 'var(--ink)' }}>NONE</button>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...outlineBtn, height: 30, fontSize: 10, padding: '0 12px', background: 'var(--accent-1)', borderColor: 'var(--accent-1)', color: '#fff' }}>DONE</button>
      </div>
    </div>
  )
}

const pop: CSSProperties = {
  position: 'fixed', zIndex: 150, width: 'min(400px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column',
  background: 'var(--bg)', border: '2px solid var(--ink)', boxShadow: '6px 6px 0 var(--ink)', color: 'var(--ink)', outline: 'none',
}
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 }
const tile = (on: boolean): CSSProperties => ({
  height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 0, cursor: 'pointer',
  border: `1.5px solid ${on ? 'var(--accent-1)' : 'var(--border)'}`,
  background: on ? 'var(--accent-1)' : '#fff', color: on ? '#fff' : 'var(--ink)',
  ['--icon-knock' as string]: on ? 'var(--accent-1)' : '#fff',
})
const forget: CSSProperties = {
  position: 'absolute', top: -5, right: -5, width: 16, height: 16, padding: 0, lineHeight: '13px',
  border: '1.5px solid var(--ink)', borderRadius: '50%', background: 'var(--bg)', color: 'var(--ink)',
  fontSize: 11, cursor: 'pointer',
}
