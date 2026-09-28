// Base local do celular: cópia dos cadastros de trabalho, sincronizada por partes
// (a primeira vez baixa tudo; depois só o que mudou/excluiu desde a última vez).
// Sem internet, as buscas de produto/cliente e listas de cadastro são respondidas daqui.

export const SYNCED = ['products', 'customers', 'suppliers', 'payment-terms', 'price-tables', 'price-table-items', 'units', 'product-groups', 'product-types', 'operation-types', 'cost-centers', 'companies'] as const
type Resource = (typeof SYNCED)[number]
type Row = Record<string, any> & { id: string; _label?: string; _search?: string; _sort?: string }
interface Meta { resource: string; since: string; after: string; count: number; at: string }

let dbp: Promise<IDBDatabase> | null = null
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('vanguard-local', 1)
      req.onupgradeneeded = () => {
        for (const r of SYNCED) req.result.createObjectStore(r, { keyPath: 'id' })
        req.result.createObjectStore('meta', { keyPath: 'resource' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}
async function all<T>(store: string): Promise<T[]> {
  const db = await open()
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result as T[]); r.onerror = () => reject(r.error) })
}
async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error) })
}
async function write(store: string, rows: Row[], deleted: string[], meta: Meta) {
  const db = await open()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([store, 'meta'], 'readwrite')
    const s = tx.objectStore(store)
    for (const id of deleted) s.delete(id)
    for (const r of rows) s.put(r)
    tx.objectStore('meta').put(meta)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
const count = async (store: string) => { const db = await open(); return new Promise<number>((resolve) => { const r = db.transaction(store).objectStore(store).count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0) }) }

// ── situação da sincronização ──
export interface SyncState { running: boolean; lastSync: string | null; counts: Partial<Record<Resource, number>>; error: string | null }
let state: SyncState = { running: false, lastSync: null, counts: {}, error: null }
export const syncState = () => state
const emit = (patch: Partial<SyncState>) => { state = { ...state, ...patch }; window.dispatchEvent(new Event('vanguard:sync')) }
export async function loadSyncState() {
  try {
    const metas = await all<Meta>('meta')
    const counts: Partial<Record<Resource, number>> = {}
    for (const m of metas) counts[m.resource as Resource] = m.count
    emit({ counts, lastSync: metas.length === SYNCED.length ? metas.map((m) => m.at).sort()[0]! : null })
  } catch { /* sem IndexedDB */ }
}
export const hasLocal = () => state.lastSync !== null

// Baixa as mudanças de todos os cadastros. `fetchPage` usa a API normal (com token e aparelho).
let running: Promise<void> | null = null
export function syncAll(fetchPage: (path: string) => Promise<{ rows: Row[]; deleted: string[]; next: { since: string; after: string } | null; resume: string }>) {
  if (running) return running
  running = (async () => {
    emit({ running: true, error: null })
    try {
      for (const r of SYNCED) {
        const meta = (await get<Meta>('meta', r)) ?? { resource: r, since: '', after: '', count: 0, at: '' }
        let since = meta.since, after = meta.after
        for (let page = 0; page < 500; page++) {
          const res = await fetchPage(`/catalog/${r}/sync?limit=2000${since ? `&since=${encodeURIComponent(since)}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`)
          const next = res.next ?? { since: res.resume, after: '' }
          const done = !res.next
          await write(r, res.rows, res.deleted, { resource: r, since: next.since, after: next.after, count: 0, at: done ? new Date().toISOString() : meta.at })
          since = next.since; after = next.after
          if (done) break
        }
        const n = await count(r)
        const m = (await get<Meta>('meta', r))!
        await write(r, [], [], { ...m, count: n })
      }
      await loadSyncState()
    } catch (e) {
      emit({ error: (e as Error).message })
    } finally {
      emit({ running: false })
      running = null
    }
  })()
  return running
}

export async function clearLocal() {
  try {
    const db = await open()
    await new Promise<void>((resolve) => { const tx = db.transaction([...SYNCED, 'meta'], 'readwrite'); for (const s of [...SYNCED, 'meta']) tx.objectStore(s).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => resolve() })
  } catch { /* nada guardado */ }
  emit({ lastSync: null, counts: {} })
}

// ── respostas locais para as telas (quando está sem internet) ──
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = (r: Row, q: string) => !q || norm(r._search ?? r._label).includes(norm(q)) || norm(r._label).includes(norm(q))
const strip = ({ _label: _l, _search: _s, _sort: _o, _at: _a, ...rest }: Row) => rest

export async function localAnswer(path: string): Promise<{ data: unknown } | null> {
  if (!hasLocal()) return null
  const url = new URL(path, 'http://x')
  const q = url.searchParams.get('q')?.trim() ?? ''
  let m: RegExpMatchArray | null
  if (url.pathname === '/products') {
    const rows = (await all<Row>('products')).filter((r) => matches(r, q)).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return { data: rows.slice(0, 500).map((r) => ({ ...strip(r), typeLabel: r.typeIdLabel ?? null, groupLabel: r.groupIdLabel ?? null })) }
  }
  if (url.pathname === '/suppliers') {
    return { data: (await all<Row>('suppliers')).filter((r) => matches(r, q)).sort((a, b) => String(a._sort).localeCompare(String(b._sort))).slice(0, 300).map(strip) }
  }
  if (url.pathname === '/sales/price') {
    const p = await get<Row>('products', url.searchParams.get('productId') ?? '')
    if (!p) return null
    const t = url.searchParams.get('priceTableId')
    const item = t ? await get<Row>('price-table-items', `${t}:${p.id}`) : undefined
    return { data: { price: Number(item?.price ?? p.salePrice), fromTable: !!item, stock: Number(p.stock), unit: p.unit } }
  }
  if ((m = url.pathname.match(/^\/catalog\/([a-z-]+)\/options$/)) && (SYNCED as readonly string[]).includes(m[1]!)) {
    const rows = (await all<Row>(m[1]!)).filter((r) => r.active !== false && matches(r, q)).sort((a, b) => String(a._label).localeCompare(String(b._label)))
    return { data: rows.slice(0, 1000).map((r) => ({ value: r.id, label: r._label })) }
  }
  if ((m = url.pathname.match(/^\/catalog\/([a-z-]+)$/)) && (SYNCED as readonly string[]).includes(m[1]!)) {
    const rows = (await all<Row>(m[1]!)).filter((r) => matches(r, q)).sort((a, b) => String(a._sort).localeCompare(String(b._sort)))
    return { data: rows.slice(0, 1000).map(strip) }
  }
  return null
}
