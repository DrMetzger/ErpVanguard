const TOKEN_KEY = 'vanguard.token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) =>
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY)

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && token) {
    setToken(null)
    window.dispatchEvent(new Event('vanguard:logout'))
  }
  if (res.status === 204) return null

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('\n') : data?.message
    throw new ApiError(res.status, message || 'Erro ao comunicar com o servidor')
  }
  return data
}
