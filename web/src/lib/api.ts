import { localAnswer, syncState } from './localdb'
import { cacheGet, cachePut, canQueue, clearOfflineData, describe, enqueue, newKey, noteCacheUsed, QueuedOffline, setOffline, setSender } from './offline'
const TOKEN_KEY = 'vanguard.token'
// No site fica vazio (mesmo domínio); no app Android aponta para o servidor.
export const API_URL: string = import.meta.env.VITE_API_URL ?? ''

const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (token: string | null) => {
    try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch { /* modo privado */ }
  },
}
export const getToken = storage.get
// Identificador do aparelho (só no app do celular): o servidor bloqueia aparelho por aparelho.
let deviceId: string | null = null
export const setDeviceId = (id: string | null) => { deviceId = id }
// Filial escolhida no topo da tela (guardada no aparelho); o servidor confere se está liberada para o usuário.
const BRANCH_KEY = 'vanguard.branch'
let branchId: string | null = (() => { try { return localStorage.getItem(BRANCH_KEY) } catch { return null } })()
export const getBranchId = () => branchId
export function setBranchId(id: string | null) {
  branchId = id
  try { if (id) localStorage.setItem(BRANCH_KEY, id); else localStorage.removeItem(BRANCH_KEY) } catch { /* modo privado */ }
}
const deviceHeader = (branch: string | null = branchId): Record<string, string> => ({ ...(deviceId ? { 'X-Device-Id': deviceId } : {}), ...(branch ? { 'X-Branch-Id': branch } : {}) })
// Tela guardada para uso sem internet: separada por filial.
const cacheKey = (path: string) => (branchId ? `${branchId}|${path}` : path)
// Aparelho bloqueado pelo administrador: sai do sistema e apaga o que estava guardado no celular.
function onBlocked(data: any) {
  setToken(null)
  void import('./offline').then((m) => m.clearOfflineData())
  window.dispatchEvent(new CustomEvent('vanguard:device-blocked', { detail: data?.message ?? 'Este aparelho foi bloqueado pelo administrador' }))
}
export const setToken = storage.set
// Cliente com acesso desativado pela Prime ERP (ex.: fatura em aberto): mostra o aviso no lugar das telas.
function onAccessBlocked(data: any) {
  window.dispatchEvent(new CustomEvent('vanguard:access-blocked', { detail: data?.message ?? 'Seu acesso encontra-se desativado. Favor contactar a equipe de suporte.' }))
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T = unknown>(path: string, options: { method?: Method; body?: unknown } = {}, retried = false): Promise<T> {
  const { method = 'GET', body } = options
  const headers: Record<string, string> = { Accept: 'application/json', ...deviceHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  // Chave única da gravação: se a mesma for reenviada (fila offline, clique duplo), o servidor não grava duas vezes.
  const key = method === 'GET' ? null : newKey()
  if (key) headers['Idempotency-Key'] = key

  let res: Response
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    // Sem conexão: mostra o que está guardado no aparelho ou guarda a gravação para enviar depois.
    setOffline(true)
    if (method === 'GET') {
      // Primeiro a base sincronizada do celular (produtos, clientes, tabelas…), depois a última tela guardada.
      const local = await localAnswer(path).catch(() => null)
      if (local) { const at = syncState().lastSync; if (at) noteCacheUsed(at); return local.data as T }
      const hit = await cacheGet<T>(cacheKey(path))
      if (hit) { noteCacheUsed(hit.at); return hit.data }
      throw new ApiError(0, 'Sem internet e esta tela ainda não foi aberta neste aparelho')
    }
    if (canQueue(path) && token) {
      await enqueue({ method, path, body, key: key!, label: describe(method, path), branch: branchId })
      throw new QueuedOffline()
    }
    throw new ApiError(0, 'Sem internet: esta ação precisa de conexão (tente de novo quando voltar)')
  }
  setOffline(false)
  if (res.status === 401 && token) {
    setToken(null)
    void clearOfflineData()
    window.dispatchEvent(new Event('vanguard:logout'))
  }
  if (res.status === 204) return null as T

  const data = await res.json().catch(() => null)
  if (res.status === 403 && data?.code === 'DEVICE_BLOCKED') onBlocked(data)
  if (res.status === 403 && data?.code === 'ACCESS_BLOCKED') onAccessBlocked(data)
  // Filial guardada que deixou de estar liberada: volta para a padrão do usuário e tenta de novo.
  if (res.status === 403 && data?.code === 'BRANCH_DENIED' && branchId && !retried) {
    setBranchId(null)
    window.dispatchEvent(new Event('vanguard:branch-reset'))
    return api<T>(path, options, true)
  }
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('\n') : data?.message
    throw new ApiError(res.status, message || 'Erro ao comunicar com o servidor', data)
  }
  if (method === 'GET') void cachePut(cacheKey(path), data)
  return data as T
}

// Envio de um item da fila offline (mesma chave da gravação original).
setSender(async (w) => {
  const token = getToken()
  if (!token) return { error: 'Entre de novo no sistema para enviar' }
  try {
    const res = await fetch(`${API_URL}/api${w.path}`, {
      method: w.method,
      // Vai para a filial em que a gravação foi feita (mesmo que o usuário tenha trocado depois).
      headers: { Accept: 'application/json', ...deviceHeader(w.branch === undefined ? branchId : w.branch), Authorization: `Bearer ${token}`, 'Idempotency-Key': w.key, ...(w.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: w.body === undefined ? undefined : JSON.stringify(w.body),
    })
    if (res.ok) return 'ok'
    if (res.status >= 500) return 'offline'
    const data = await res.json().catch(() => null)
    if (res.status === 403 && data?.code === 'DEVICE_BLOCKED') { onBlocked(data); return 'offline' }
    if (res.status === 403 && data?.code === 'ACCESS_BLOCKED') { onAccessBlocked(data); return 'offline' }
    return { error: (Array.isArray(data?.message) ? data.message.join('; ') : data?.message) || `Erro ${res.status}` }
  } catch {
    return 'offline'
  }
})

// Arquivo da API (XML, PDF) com o token: devolve o conteúdo e o nome sugerido pelo servidor.
export async function apiFile(path: string): Promise<{ blob: Blob; name: string }> {
  const token = getToken()
  const res = await fetch(`${API_URL}/api${path}`, { headers: { ...deviceHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.message || 'Erro ao baixar o arquivo', data)
  }
  const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'arquivo'
  return { blob: await res.blob(), name }
}
