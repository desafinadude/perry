/* Chart library: built-in practice charts + the user's charts (localStorage). */
import type { Chart } from './model'
import { parseLink, parseMusic, toMusic } from './ireal'

const STORE_KEY = 'perry.jam.library.v1'

// Generic practice progressions, written as iReal links so they also
// exercise the importer.
const BUILTIN_LINKS = [
  'irealbook://Blues in F==Medium Swing=F=n={*AT44F7 |Bb7 |F7 |C-7 F7 |Bb7 |Bo7 |F7 |D7 |G-7 |C7 |F7 D7 |G-7 C7 }',
  'irealbook://Minor Blues==Medium Swing=C-=n={*AT44C-7 |F-7 |C-7 | x |F-7 | x |C-7 | x |Ab7 |G7 |C-7 |G7 }',
  'irealbook://Rhythm Changes==Medium Swing=Bb=n=*A{T44Bb^7 G-7 |C-7 F7 |D-7 G7 |C-7 F7 |F-7 Bb7 |Eb^7 Ab7 |N1D-7 G7 |C-7 F7 } |N2C-7 F7 |Bb6 ]*B[D7 | x |G7 | x |C7 | x |F7 | x ]*A[Bb^7 G-7 |C-7 F7 |D-7 G7 |C-7 F7 |F-7 Bb7 |Eb^7 Ab7 |C-7 F7 |Bb6 Z',
  'irealbook://ii-V-I All Keys==Medium Swing=C=n=*A[T44D-7 G7 |C^7 |G-7 C7 |F^7 |C-7 F7 |Bb^7 |F-7 Bb7 |Eb^7 ]*B[Bb-7 Eb7 |Ab^7 |Eb-7 Ab7 |Db^7 |Ab-7 Db7 |Gb^7 |C#-7 F#7 |B^7 ]*C[F#-7 B7 |E^7 |B-7 E7 |A^7 |E-7 A7 |D^7 |A-7 D7 |G^7 Z',
  'irealbook://Bossa Vamp==Bossa Nova=D-=n={*AT44D-9 |G13 |D-9 |G13 |E-7b5 |A7b9 |D-9 |A7b9 }',
  'irealbook://Pop Four==Pop=C=n={*AT44C |G |A- |F }',
  'irealbook://Funk Vamp==Funk=E=n={*AT44E7#9 | x |A7 |E7#9 }',
  'irealbook://Ballad Changes==Ballad=Eb=n=*A[T44Eb^7 C-7 |F-7 Bb7 |G-7 C7 |F-7 Bb7 |Eb^7 Eb7 |Ab^7 Db7 |G-7 C7 |F-7 Bb7 Z',
]

let builtins: Chart[] | null = null
export function builtInCharts(): Chart[] {
  if (!builtins) {
    builtins = BUILTIN_LINKS.flatMap((l, i) => parseLink(l, 'Practice · built-in').charts.map((c) => ({
      ...c, id: `builtin-${i}`, builtIn: true, playlist: 'Practice · built-in',
    })))
  }
  return builtins.map((c) => structuredClone(c))
}

/** Stored compactly: header fields + the iReal music string. */
interface StoredChart extends Omit<Chart, 'bars' | 'timeSig'> { music: string }

export function loadUserCharts(): Chart[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as StoredChart[]
    if (!Array.isArray(data)) return []
    return data.map(({ music, ...rest }) => {
      const { bars, timeSig } = parseMusic(music)
      return { ...rest, bars, timeSig }
    })
  } catch {
    return []
  }
}

/** Returns false if the browser refused to store (quota). */
export function saveUserCharts(charts: Chart[]): boolean {
  const data: StoredChart[] = charts.map(({ bars: _b, timeSig: _t, ...rest }, i) => ({ ...rest, music: toMusic(charts[i]) }))
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true } catch { return false }
}

const BAND_KEY = 'perry.jam.band.v1'
export function loadBandPrefs<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(BAND_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch { return fallback }
}
export function saveBandPrefs(v: unknown) {
  try { localStorage.setItem(BAND_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}
