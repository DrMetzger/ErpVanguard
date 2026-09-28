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
export const setToken = storage.set

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T = unknown>(path: string, options: { method?: Method; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
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
      const hit = await cacheGet<T>(path)
      if (hit) { noteCacheUsed(hit.at); return hit.data }
      throw new ApiError(0, 'Sem internet e esta tela ainda não foi aberta neste aparelho')
    }
    if (canQueue(path) && token) {
      await enqueue({ method, path, body, key: key!, label: describe(method, path) })
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
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('\n') : data?.message
    throw new ApiError(res.status, message || 'Erro ao comunicar com o servidor', data)
  }
  if (method === 'GET') void cachePut(path, data)
  return data as T
}

// Envio de um item da fila offline (mesma chave da gravação original).
setSender(async (w) => {
  const token = getToken()
  if (!token) return { error: 'Entre de novo no sistema para enviar' }
  try {
    const res = await fetch(`${API_URL}/api${w.path}`, {
      method: w.method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': w.key, ...(w.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: w.body === undefined ? undefined : JSON.stringify(w.body),
    })
    if (res.ok) return 'ok'
    if (res.status >= 500) return 'offline'
    const data = await res.json().catch(() => null)
    return { error: (Array.isArray(data?.message) ? data.message.join('; ') : data?.message) || `Erro ${res.status}` }
  } catch {
    return 'offline'
  }
})

// Arquivo da API (XML, PDF) com o token: devolve o conteúdo e o nome sugerido pelo servidor.
export async function apiFile(path: string): Promise<{ blob: Blob; name: string }> {
  const token = getToken()
  const res = await fetch(`${API_URL}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.message || 'Erro ao baixar o arquivo', data)
  }
  const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'arquivo'
  return { blob: await res.blob(), name }
}
