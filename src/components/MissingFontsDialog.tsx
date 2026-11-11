import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { h1, h2, lbl, outlineBtn } from './controls'

export interface MissingFont {
  /** Font slot id the config's zones point at. */
  id: string
  /** File name recorded when the config was saved, if known. */
  name: string | null
  /** Names of the zones that use it. */
  zones: string[]
}

interface Props {
  configName: string
  missing: MissingFont[]
  /** Saved fonts are still being restored from the browser. */
  restoring: boolean
  onLoad: (fontId: string) => void
  onClose: () => void
}

/** Shown after loading a config whose SoundFonts aren't loaded yet. */
export function MissingFontsDialog({ configName, missing, restoring, onLoad, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="missing-fonts-title" style={dialog}>
        <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '2px solid var(--ink)' }}>
          <div style={{ width: 6, background: 'var(--accent-2)' }} />
          <div style={{ flex: 1, padding: '14px 20px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>CONFIG · {configName.toUpperCase()}</span>
            <div id="missing-fonts-title" style={h1}>
              {restoring ? 'LOADING SOUNDFONTS…' : `${missing.length} SOUNDFONT${missing.length === 1 ? '' : 'S'} NEEDED`}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: '#3E3D38' }}>
            {restoring
              ? 'Restoring the SoundFonts saved in this browser…'
              : 'These zones are silent until their SoundFont is loaded. Load each file once — Perry keeps it in this browser from then on.'}
          </p>
          {!restoring && missing.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ ...h2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(m.name ?? 'UNKNOWN FONT').toUpperCase()}
                </span>
                <span style={{ ...lbl, fontSize: 9, whiteSpace: 'normal' }}>USED BY {m.zones.map((z) => z.toUpperCase()).join(' · ')}</span>
              </div>
              <button onClick={() => onLoad(m.id)} style={{ ...outlineBtn, height: 40, background: 'var(--accent-1)', color: '#fff', borderColor: 'var(--accent-1)' }}>
                LOAD FILE…
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '2px solid var(--ink)', background: 'var(--surface)' }}>
          <button onClick={onClose} style={{ ...outlineBtn, height: 36 }}>{restoring ? 'CLOSE' : 'CONTINUE WITHOUT'}</button>
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
  width: 'min(560px, 100%)', background: 'var(--bg)', border: '2px solid var(--ink)',
  boxShadow: '8px 8px 0 var(--ink)', display: 'flex', flexDirection: 'column', color: 'var(--ink)',
}
