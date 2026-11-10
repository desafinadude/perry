/*
 * iReal Pro chart links.
 *
 *   irealbook://Title=Composer=Style=Key=n=Music[=Title=…]          (documented)
 *   irealb://Title=Composer==Style=Key==1r34LbKcu7Music=Comp=BPM=Rep===…===Playlist
 *
 * The irealb form (what the app's share/export produces) scrambles the music
 * string: after the "1r34LbKcu7" marker, each 50-character block has
 * characters swapped between its ends, and a few substitutions shorten
 * common runs (XyQ = three spaces, LZ = " |", Kcl = "| x").
 */
import type { Chart, ChartBar } from './model'
import { assignBeats, barBeats, uid } from './model'

const MUSIC_PREFIX = '1r34LbKcu7'

/** Extract every iReal link from pasted text or an exported HTML file. */
export function findLinks(text: string): string[] {
  const out: string[] = []
  const re = /irealb(?:ook)?:\/\/[^\s"'<>]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[0])
  return out
}

export interface ImportResult {
  charts: Chart[]
  playlist: string | null
}

/** Parse all charts found in text (links, a whole playlist, or HTML). */
export function importText(text: string, fallbackPlaylist = 'Imported'): ImportResult {
  const charts: Chart[] = []
  let playlist: string | null = null
  for (const link of findLinks(text)) {
    const r = parseLink(link, fallbackPlaylist)
    charts.push(...r.charts)
    if (r.playlist) playlist = r.playlist
  }
  return { charts, playlist }
}

function decode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, '%20')) } catch { return s }
}

export function parseLink(link: string, fallbackPlaylist = 'Imported'): ImportResult {
  if (link.startsWith('irealb://')) return parseIrealb(decode(link.slice('irealb://'.length)), fallbackPlaylist)
  if (link.startsWith('irealbook://')) return parseIrealbook(decode(link.slice('irealbook://'.length)), fallbackPlaylist)
  return { charts: [], playlist: null }
}

function parseIrealbook(body: string, playlist: string): ImportResult {
  const f = body.split('=')
  const charts: Chart[] = []
  for (let i = 0; i + 5 < f.length; i += 6) {
    charts.push(makeChart({ title: f[i], composer: f[i + 1], style: f[i + 2], key: f[i + 3], music: f[i + 5], playlist }))
  }
  const rest = f.length % 6 === 1 ? f[f.length - 1] : null
  return { charts, playlist: rest || null }
}

function parseIrealb(body: string, playlist: string): ImportResult {
  const parts = body.split('===')
  let name: string | null = null
  if (parts.length > 1 && !parts[parts.length - 1].includes('=')) name = parts.pop() || null
  const charts: Chart[] = []
  for (const song of parts) {
    const f = song.split('=')
    const mi = f.findIndex((x) => x.startsWith(MUSIC_PREFIX))
    if (mi < 0) continue
    const head = f.slice(0, mi)
    const keyIdx = lastIndex(head, (x, i) => i >= 2 && /^[A-G][b#]?-?$/.test(x))
    const key = keyIdx >= 0 ? head[keyIdx] : 'C'
    const style = head.slice(2, keyIdx >= 0 ? keyIdx : head.length).filter(Boolean).pop() ?? ''
    const bpm = Number(f[mi + 2]) || null
    const repeats = Number(f[mi + 3]) || null
    charts.push(makeChart({
      title: head[0] ?? 'Untitled', composer: head[1] ?? '', style, key,
      music: unscramble(f[mi].slice(MUSIC_PREFIX.length)), playlist: name ?? playlist, bpm, repeats,
    }))
  }
  return { charts, playlist: name }
}

function lastIndex<T>(a: T[], fn: (x: T, i: number) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (fn(a[i], i)) return i
  return -1
}

/** Reverse the irealb music obfuscation. */
export function unscramble(s: string): string {
  let r = ''
  while (s.length > 51) {
    r += swap50(s.slice(0, 50))
    s = s.slice(50)
  }
  r += s
  return r.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   ')
}

function swap50(s: string): string {
  const c = s.split('')
  for (let i = 0; i < 5; i++) { c[49 - i] = s[i]; c[i] = s[49 - i] }
  for (let i = 10; i < 24; i++) { c[49 - i] = s[i]; c[i] = s[49 - i] }
  return c.join('')
}

function makeChart(o: {
  title: string; composer: string; style: string; key: string; music: string; playlist: string
  bpm?: number | null; repeats?: number | null
}): Chart {
  const { bars, timeSig } = parseMusic(o.music)
  let title = o.title.trim() || 'Untitled'
  const the = title.match(/^(.*), (The|A|An)$/)
  if (the) title = `${the[2]} ${the[1]}`
  return {
    id: uid(), title, composer: o.composer.trim(), style: o.style.trim() || 'Medium Swing',
    key: o.key.trim() || 'C', timeSig, bpm: o.bpm ?? null, repeats: o.repeats ?? null,
    bars, playlist: o.playlist, transpose: 0,
  }
}

// ── Music string → bars ─────────────────────────────────────────────────────

const CHORD_RE = /^([A-GW][b#]?)((?:sus|alt|add|maj|min|dim|aug|[\^\-+oh#b0-9])*)(\/[A-G][b#]?)?/

interface Draft extends Omit<ChartBar, 'chords'> {
  texts: { text: string; alt?: string }[]
  spaces: number
}

export function parseMusic(music: string): { bars: ChartBar[]; timeSig: string } {
  const bars: ChartBar[] = []
  let firstTs: string | null = null
  let ts = '44'
  let cur: Draft = blank()
  let lastChord: string | null = null

  function blank(): Draft { return { texts: [], spaces: 0 } }
  function hasContent(d: Draft) {
    return d.texts.length > 0 || !!d.repeat || !!d.section || d.ending !== undefined || !!d.text || !!d.segno || !!d.coda || !!d.timeSig || !!d.open
  }
  function finish(close?: ChartBar['close']) {
    if (!hasContent(cur) && cur.spaces < 2) {
      // a bare double-bar or stray barline: attach the close to the last bar
      if (close && bars.length) bars[bars.length - 1].close = close
      cur = blank()
      return
    }
    if (cur.timeSig) ts = cur.timeSig
    const { texts, spaces: _s, ...rest } = cur
    const bar: ChartBar = { ...rest, chords: assignBeats(texts, barBeats(ts)) }
    if (close) bar.close = close
    bars.push(bar)
    cur = blank()
  }

  let i = 0
  while (i < music.length) {
    const c = music[i]
    const rest = music.slice(i)
    if (c === '{' || c === '[') {
      // markers written before the barline (e.g. "*A{") belong to the new bar
      if (cur.texts.length || cur.repeat || cur.spaces >= 2) finish()
      cur.open = c
      i++
    } else if (c === '|') { finish(); i++ }
    else if (c === ']' || c === '}' || c === 'Z') { finish(c); i++ }
    else if (c === 'T' && /^T\d\d/.test(rest)) {
      cur.timeSig = rest.slice(1, 3)
      if (!firstTs) firstTs = cur.timeSig
      i += 3
    } else if (c === '*' && rest.length > 1) { cur.section = rest[1]; i += 2 }
    else if (c === 'N' && /^N\d/.test(rest)) { cur.ending = Number(rest[1]); i += 2 }
    else if (c === '<') {
      const end = music.indexOf('>', i)
      const raw = music.slice(i + 1, end < 0 ? undefined : end).replace(/^\*\d\d/, '').trim()
      if (raw) cur.text = cur.text ? `${cur.text} ${raw}` : raw
      i = end < 0 ? music.length : end + 1
    } else if (c === '(') {
      const end = music.indexOf(')', i)
      const alt = music.slice(i + 1, end < 0 ? undefined : end).trim()
      const last = cur.texts[cur.texts.length - 1]
      if (last && alt) last.alt = alt
      i = end < 0 ? music.length : end + 1
    } else if (c === 'S') { cur.segno = true; i++ }
    else if (c === 'Q') { cur.coda = true; i++ }
    else if (c === 'f') { cur.fermata = true; i++ }
    else if (c === 'x') { cur.repeat = 'x'; i++ }
    else if (c === 'r') { cur.repeat = 'r'; i++ }
    else if (c === 'n') { cur.texts.push({ text: 'n' }); i++ }
    else if (c === 'p') { if (lastChord) cur.texts.push({ text: lastChord }); i++ }
    else if (c === ' ') { cur.spaces++; i++ }
    else {
      const m = rest.match(CHORD_RE)
      if (m && m[0].length > 0) {
        let text = m[0]
        if (text.startsWith('W')) {
          // invisible root: previous chord with a new bass
          const prev = (lastChord ?? 'C').split('/')[0]
          text = m[3] ? prev + m[3] : prev
        }
        cur.texts.push({ text })
        lastChord = text
        i += m[0].length
      } else {
        i++ // Y, U, l, s, commas and anything unknown
      }
    }
  }
  if (hasContent(cur)) finish('Z')
  if (bars.length && !bars[bars.length - 1].close) bars[bars.length - 1].close = 'Z'
  return { bars, timeSig: firstTs ?? '44' }
}

// ── Chart → irealbook:// ────────────────────────────────────────────────────

/** Serialise to the documented irealbook:// form (opens in iReal Pro). */
export function toIrealbook(chart: Chart): string {
  const fields = [chart.title, chart.composer, chart.style, chart.key, 'n', toMusic(chart)]
  return 'irealbook://' + fields.map((f) => encodeURIComponent(f.replace(/=/g, '-'))).join('%3D')
}

export function toMusic(chart: Chart): string {
  let out = ''
  let ts = chart.timeSig
  chart.bars.forEach((b, i) => {
    const next = chart.bars[i + 1]
    if (b.open) out += b.open
    if (b.section) out += '*' + b.section
    if (i === 0 || b.timeSig) {
      ts = b.timeSig ?? chart.timeSig
      out += 'T' + ts
    }
    if (b.ending !== undefined) out += 'N' + b.ending
    if (b.segno) out += 'S'
    if (b.text) out += `<${b.text.replace(/[<>=]/g, '')}>`
    if (b.fermata) out += 'f'
    if (b.repeat) out += ` ${b.repeat} `
    else {
      const slots = Math.max(1, Math.round(barBeats(ts)))
      for (let s = 0; s < slots; s++) {
        const ch = b.chords.find((c) => Math.floor(c.beat) === s)
        out += ch ? ch.text + (ch.alt ? `(${ch.alt})` : '') + ' ' : ' '
      }
    }
    if (b.coda) out += 'Q'
    const close = b.close ?? (i === chart.bars.length - 1 ? 'Z' : next?.open ? '' : '|')
    out += close
  })
  return out
}
