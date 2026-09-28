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

  const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 401 && token) {
    setToken(null)
    window.dispatchEvent(new Event('vanguard:logout'))
  }
  if (res.status === 204) return null as T

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('\n') : data?.message
    throw new ApiError(res.status, message || 'Erro ao comunicar com o servidor', data)
  }
  return data as T
}

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
