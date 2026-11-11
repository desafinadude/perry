import type { CSSProperties } from 'react'
import type { Zone, ZoneIcon } from '../types'
import { builtinIcon, guessIcon } from '../icons/builtin'
import { safeSvg } from '../icons/svg'

const ENGINE_FALLBACK = { soundfont: 'keys', synth: 'synth', sampler: 'sample' } as const

/** The icon a zone shows: its chosen one, else one guessed from its name/engine. */
export function resolveZoneIcon(zone: Pick<Zone, 'name' | 'icon' | 'engine'>): { icon: ZoneIcon; auto: boolean } | null {
  if (zone.icon?.id === 'none') return null
  if (zone.icon && (zone.icon.svg || builtinIcon(zone.icon.id))) return { icon: zone.icon, auto: false }
  const guess = guessIcon(zone.name) ?? builtinIcon(ENGINE_FALLBACK[zone.engine ?? 'soundfont'])!
  return { icon: { id: guess.id }, auto: true }
}

/** Renders a built-in or imported icon in currentColor. */
export function IconGlyph({ icon, size = 24, style, title }: { icon: ZoneIcon | null; size?: number; style?: CSSProperties; title?: string }) {
  const box: CSSProperties = { width: size, height: size, flexShrink: 0, display: 'inline-flex', ...style }
  if (!icon) return <span aria-hidden="true" style={box} />
  const label = title ?? icon.name ?? builtinIcon(icon.id)?.name
  if (icon.svg) {
    const svg = safeSvg(icon.svg)
    if (!svg) return <span aria-hidden="true" style={box} />
    return (
      <span
        role="img" aria-label={label} title={title}
        className="perry-icon"
        style={box}
        // sanitised: shapes only, no scripts, styles, links or external refs
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  const b = builtinIcon(icon.id)
  if (!b) return <span aria-hidden="true" style={box} />
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24" style={box}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title.replace(/[<&]/g, '')}</title>` : '') + b.markup }} />
  )
}

/** A zone's icon (or nothing when it has none). */
export function ZoneIconView({ zone, size = 24, style }: { zone: Pick<Zone, 'name' | 'icon' | 'engine'>; size?: number; style?: CSSProperties }) {
  const r = resolveZoneIcon(zone)
  return r ? <IconGlyph icon={r.icon} size={size} style={style} /> : null
}
