/*
 * Persists user-loaded SoundFonts and samples in IndexedDB so zone setups
 * (and saved configs) still have their sounds after a page refresh.
 * localStorage is far too small for SoundFonts; IndexedDB handles hundreds
 * of MB. Every call fails soft: no IndexedDB just means no persistence.
 */

const DB_NAME = 'perry-assets'
const DB_VERSION = 1
const FONTS = 'fonts'
const SAMPLES = 'samples'

export interface StoredFont { id: string; name: string; data: ArrayBuffer; addedAt: number }
export interface StoredSample { name: string; data: ArrayBuffer; addedAt: number }

let dbPromise: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(FONTS)) d.createObjectStore(FONTS, { keyPath: 'id' })
        if (!d.objectStoreNames.contains(SAMPLES)) d.createObjectStore(SAMPLES, { keyPath: 'name' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  // ask the browser not to evict our data under storage pressure (best effort)
  try { navigator.storage?.persist?.() } catch { /* not supported */ }
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then((d) => new Promise<T | null>((resolve) => {
    if (!d) return resolve(null)
    try {
      const tx = d.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  }))
}

export const saveFont = (f: StoredFont) => run(FONTS, 'readwrite', (s) => s.put(f))
export const deleteFont = (id: string) => run(FONTS, 'readwrite', (s) => s.delete(id))
export const listFonts = async (): Promise<StoredFont[]> =>
  ((await run<StoredFont[]>(FONTS, 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => a.addedAt - b.addedAt)

export const saveSample = (x: StoredSample) => run(SAMPLES, 'readwrite', (s) => s.put(x))
export const listSamples = async (): Promise<StoredSample[]> =>
  (await run<StoredSample[]>(SAMPLES, 'readonly', (s) => s.getAll())) ?? []
