// Trabalho sem internet (principalmente no app do celular):
// - leituras (GET) ficam guardadas no aparelho e aparecem quando a conexão cai;
// - gravações feitas sem internet entram numa fila e são enviadas na ordem quando a conexão volta,
//   com uma chave única (Idempotency-Key) para o servidor nunca gravar duas vezes.

const DB_NAME = 'vanguard-offline'
const CACHE = 'cache'
const QUEUE = 'queue'

export interface QueuedWrite {
  id?: number
  method: string
  path: string
  body?: unknown
  key: string
  at: string
  label: string
  error?: string
}

let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(CACHE)
        req.result.createObjectStore(QUEUE, { keyPath: 'id', autoIncrement: true })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(store, mode).objectStore(store))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

// ── estado da conexão ──
let offline = typeof navigator !== 'undefined' ? !navigator.onLine : false
let lastCacheAt: string | null = null
const emit = () => window.dispatchEvent(new Event('vanguard:offline-change'))
export const isOffline = () => offline
export const cacheShownAt = () => lastCacheAt
export function setOffline(value: boolean) {
  if (offline === value) return
  offline = value
  if (!value) lastCacheAt = null
  emit()
  if (!value) void flushQueue()
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOffline(false))
  window.addEventListener('offline', () => setOffline(true))
}

// ── leituras guardadas ──
export async function cachePut(path: string, data: unknown) {
  try { await tx(CACHE, 'readwrite', (s) => s.put({ data, at: new Date().toISOString() }, path)) } catch { /* sem espaço: segue sem guardar */ }
}
export async function cacheGet<T>(path: string): Promise<{ data: T; at: string } | undefined> {
  try { return await tx(CACHE, 'readonly', (s) => s.get(path)) } catch { return undefined }
}
export function noteCacheUsed(at: string) {
  if (!lastCacheAt || at < lastCacheAt) lastCacheAt = at
  emit()
}
export async function clearOfflineData() {
  void import('./localdb').then((m) => m.clearLocal())
  try { await tx(CACHE, 'readwrite', (s) => s.clear()); await tx(QUEUE, 'readwrite', (s) => s.clear()) } catch { /* nada guardado */ }
  emit()
}

// ── fila de gravações ──
// Nunca vão para a fila: login, SEFAZ, e-mail, importação por planilha, certificados e configurações.
const NOT_QUEUED = [/^\/auth\//, /^\/sales\/preview/, /\/nfe(\/|$)/, /^\/sefaz/, /\/email$/, /\/sheet\//, /^\/certificates/, /^\/settings/, /^\/devices\//, /^\/invoice-numbering/, /\/inutilizar/]
export const canQueue = (path: string) => !NOT_QUEUED.some((r) => r.test(path))
export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

export async function enqueue(write: Omit<QueuedWrite, 'id' | 'at'>) {
  await tx(QUEUE, 'readwrite', (s) => s.add({ ...write, at: new Date().toISOString() }))
  emit()
}
export async function queued(): Promise<QueuedWrite[]> {
  try { return await tx(QUEUE, 'readonly', (s) => s.getAll()) } catch { return [] }
}
export async function discard(id: number) {
  await tx(QUEUE, 'readwrite', (s) => s.delete(id))
  emit()
}

type Sender = (w: QueuedWrite) => Promise<'ok' | 'offline' | { error: string }>
let sender: Sender | null = null
export const setSender = (fn: Sender) => { sender = fn }
let flushing = false
// Envia a fila na ordem. Para no primeiro sem conexão; erro de validação fica marcado para o usuário ver.
export async function flushQueue() {
  if (flushing || !sender) return
  flushing = true
  try {
    for (const w of await queued()) {
      if (w.error) continue
      const r = await sender(w)
      if (r === 'offline') { setOffline(true); break }
      if (r === 'ok') await tx(QUEUE, 'readwrite', (s) => s.delete(w.id!))
      else await tx(QUEUE, 'readwrite', (s) => s.put({ ...w, error: r.error }))
      emit()
    }
  } finally {
    flushing = false
    emit()
  }
}
export async function retry(id: number) {
  const w = (await queued()).find((x) => x.id === id)
  if (w) { await tx(QUEUE, 'readwrite', (s) => s.put({ ...w, error: undefined })); await flushQueue() }
}

// Erro especial: a gravação ficou guardada no aparelho e vai quando a internet voltar.
export class QueuedOffline extends Error {
  constructor() { super('Sem internet: guardado no aparelho e será enviado sozinho quando a conexão voltar') }
}

// Descrição curta para a lista de pendências.
export function describe(method: string, path: string) {
  const verb = method === 'POST' ? 'Inclusão' : method === 'DELETE' ? 'Exclusão' : 'Alteração'
  const what = path.split('?')[0]!.split('/').filter((p) => p && !/^[0-9a-f-]{20,}$/i.test(p)).join(' › ')
  return `${verb} · ${what}`
}
