/*
 * Import SVG icons (e.g. downloads from the Noun Project) safely: only plain
 * shapes survive, colours become currentColor, attribution text is lifted
 * out as a credit, and the viewBox is cropped to the artwork.
 */

const SHAPES = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
const ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points',
  'transform', 'fill-rule', 'clip-rule', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity',
])
const NUM_LIST = /^[-+0-9.eE,\s]*$/
const SVG_NS = 'http://www.w3.org/2000/svg'

export interface ImportedSvg {
  svg: string
  /** Attribution found in the file (Noun Project downloads carry one). */
  credit: string | null
}

const WHITE = /^\s*(#fff|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\s*$/i
/**
 * Colours collapse to currentColor; white stays as a "knockout" (#fff),
 * which CSS paints in the background colour (--icon-knock) so holes and
 * highlights in an icon still read.
 */
const paintOf = (v: string | null) => (v == null ? null : /^\s*none\s*$/i.test(v) ? 'none' : WHITE.test(v) ? '#fff' : 'currentColor')

/** Read the paint a `style` attribute sets, since styles themselves are dropped. */
function styleProp(style: string | null, prop: string): string | null {
  const m = style?.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

function clean(src: Element, out: Document, credits: string[]): Element | null {
  const tag = src.localName.toLowerCase()
  if (tag === 'text' || tag === 'title' || tag === 'desc') {
    const t = src.textContent?.trim()
    if (t) credits.push(t)
    return null
  }
  if (!SHAPES.has(tag)) return null
  const el = out.createElementNS(SVG_NS, tag)
  for (const a of Array.from(src.attributes)) {
    const name = a.name.toLowerCase()
    if (!ATTRS.has(name)) continue
    // geometry only: numbers, path data and transforms (no url(), no script)
    if (name !== 'd' && name !== 'transform' && !NUM_LIST.test(a.value) && !/^[a-z-]+$/i.test(a.value)) continue
    if (name === 'opacity' || name.endsWith('-opacity')) { if (!NUM_LIST.test(a.value)) continue }
    if (/url\s*\(|javascript:|expression/i.test(a.value)) continue
    el.setAttribute(name, a.value)
  }
  const style = src.getAttribute('style')
  const fill = paintOf(src.getAttribute('fill') ?? styleProp(style, 'fill'))
  const stroke = paintOf(src.getAttribute('stroke') ?? styleProp(style, 'stroke'))
  if (fill) el.setAttribute('fill', fill)
  if (stroke) el.setAttribute('stroke', stroke)
  const sw = styleProp(style, 'stroke-width')
  if (sw && NUM_LIST.test(sw) && !el.hasAttribute('stroke-width')) el.setAttribute('stroke-width', sw)
  for (const child of Array.from(src.children)) {
    const c = clean(child, out, credits)
    if (c) el.appendChild(c)
  }
  if (tag === 'g' && el.childElementCount === 0) return null
  return el
}

/** Bounding box of the artwork, measured in the live document. */
function measure(svg: SVGSVGElement): string | null {
  if (typeof document === 'undefined' || !document.body) return null
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:200px;height:200px;visibility:hidden'
  const live = document.importNode(svg, true) as SVGSVGElement
  live.removeAttribute('viewBox')
  live.setAttribute('width', '200')
  live.setAttribute('height', '200')
  const g = document.createElementNS(SVG_NS, 'g')
  while (live.firstChild) g.appendChild(live.firstChild)
  live.appendChild(g)
  host.appendChild(live)
  document.body.appendChild(host)
  try {
    const b = g.getBBox()
    if (!b.width || !b.height) return null
    const side = Math.max(b.width, b.height)
    const pad = side * 0.04
    const x = b.x - (side - b.width) / 2 - pad
    const y = b.y - (side - b.height) / 2 - pad
    const r = (n: number) => +n.toFixed(2)
    return `${r(x)} ${r(y)} ${r(side + 2 * pad)} ${r(side + 2 * pad)}`
  } catch {
    return null
  } finally {
    host.remove()
  }
}

/** "Created by Jane Doe from Noun Project" → "Jane Doe · Noun Project". */
function creditFrom(texts: string[]): string | null {
  const all = texts.join(' ').replace(/\s+/g, ' ').trim()
  if (!all) return null
  const m = all.match(/created by\s+(.+?)(?:\s+from\s+(?:the\s+)?noun\s*project)?\s*$/i)
  if (m) return `${m[1].trim()} · Noun Project`
  return /noun\s*project/i.test(all) ? all : null
}

/**
 * Parse and sanitise an SVG. `measureBox` crops the viewBox to the artwork
 * (needs a DOM); skip it when re-checking stored icons.
 */
export function importSvg(text: string, measureBox = true): ImportedSvg | null {
  if (!/<svg[\s>]/i.test(text)) return null
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null
  const out = document.implementation.createDocument(SVG_NS, 'svg', null)
  const credits: string[] = []
  const svg = clean(root, out, credits) as SVGSVGElement | null
  if (!svg || svg.childElementCount === 0) return null
  for (const a of ['width', 'height', 'x', 'y']) svg.removeAttribute(a)
  svg.setAttribute('xmlns', SVG_NS)
  if (!svg.hasAttribute('fill')) svg.setAttribute('fill', 'currentColor')
  const vb = root.getAttribute('viewBox')
  const box = (measureBox && measure(svg)) || (vb && NUM_LIST.test(vb) ? vb : null)
    || `0 0 ${parseFloat(root.getAttribute('width') ?? '24') || 24} ${parseFloat(root.getAttribute('height') ?? '24') || 24}`
  svg.setAttribute('viewBox', box)
  return { svg: new XMLSerializer().serializeToString(svg), credit: creditFrom(credits) }
}

/** Icon name from a download's file name: "noun-electric-guitar-12345.svg" → "Electric guitar". */
export function nameFromFile(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/^noun[-_ ]?(project[-_ ]?)?/i, '').replace(/[-_ ]?\d{3,}$/, '')
  const words = base.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Icon'
}

const checked = new Map<string, string | null>()
/** Re-sanitise stored markup (configs can come from anywhere); cached. */
export function safeSvg(markup: string): string | null {
  if (!checked.has(markup)) checked.set(markup, importSvg(markup, false)?.svg ?? null)
  return checked.get(markup)!
}
