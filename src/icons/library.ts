/* Icons the user has imported, kept in this browser for reuse across zones. */
import type { ZoneIcon } from '../types'

const KEY = 'perry.icons.v1'

export function loadIconLibrary(): ZoneIcon[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((i) => i && typeof i.id === 'string' && typeof i.svg === 'string') : []
  } catch {
    return []
  }
}

export function saveIconLibrary(icons: ZoneIcon[]) {
  try { localStorage.setItem(KEY, JSON.stringify(icons)) } catch { /* storage full or blocked */ }
}

/** Stable id from the markup, so re-importing the same file doesn't duplicate it. */
export function iconId(svg: string): string {
  let h = 2166136261
  for (let i = 0; i < svg.length; i++) h = Math.imul(h ^ svg.charCodeAt(i), 16777619)
  return `svg-${(h >>> 0).toString(36)}`
}
