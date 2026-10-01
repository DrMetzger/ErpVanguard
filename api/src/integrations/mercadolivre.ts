// Cliente da API do Mercado Livre. Fora de produção, MERCADOLIVRE_API_URL e MERCADOLIVRE_AUTH_URL trocam os endereços (testes).
const env = (k: string, d: string) => (process.env[k] && process.env.NODE_ENV !== 'production' ? process.env[k]! : d).replace(/\/$/, '')
export const ML_API = () => env('MERCADOLIVRE_API_URL', 'https://api.mercadolibre.com')
export const ML_AUTH = () => env('MERCADOLIVRE_AUTH_URL', 'https://auth.mercadolivre.com.br')
export const SITE = 'MLB'

export class MercadoLivreError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) { super(message) }
}

// Erros do ML em português quando conhecidos; senão a causa que eles mandam.
function explain(status: number, data: any) {
  const causes: string[] = (data?.cause ?? []).map((c: any) => c?.message ?? c?.code).filter(Boolean)
  if (status === 401) return 'acesso ao Mercado Livre expirou ou foi revogado: conecte a conta de novo'
  if (status === 404) return 'não encontrado no Mercado Livre (anúncio excluído ou código errado)'
  if (status === 403) return `o Mercado Livre não permitiu (${data?.message ?? 'sem permissão'})`
  if (data?.error === 'invalid_grant') return 'código de autorização inválido ou já usado: clique em Conectar de novo'
  return [data?.message ?? data?.error ?? `HTTP ${status}`, ...causes].join(' · ')
}

export async function mlFetch<T>(path: string, init: { method?: string; token?: string; json?: unknown; form?: URLSearchParams | FormData; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${ML_API()}${path}`, {
      method: init.method ?? (init.json || init.form ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.json ? { 'Content-Type': 'application/json' } : init.form instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...init.headers,
      },
      body: init.json ? JSON.stringify(init.json) : init.form,
      signal: AbortSignal.timeout(25_000),
    })
  } catch (e) {
    throw new MercadoLivreError(`Não foi possível falar com o Mercado Livre (${(e as Error).name === 'TimeoutError' ? 'tempo esgotado' : (e as Error).message})`)
  }
  const data: any = await res.json().catch(() => null)
  if (!res.ok) throw new MercadoLivreError(explain(res.status, data), res.status, data)
  return data as T
}

export interface Tokens { access_token: string; refresh_token: string; expires_in: number; user_id: number }
export const exchangeCode = (clientId: string, clientSecret: string, code: string, redirectUri: string) =>
  mlFetch<Tokens>('/oauth/token', { form: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }) })
export const refreshTokens = (clientId: string, clientSecret: string, refreshToken: string) =>
  mlFetch<Tokens>('/oauth/token', { form: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }) })
export const authorizeUrl = (clientId: string, redirectUri: string, state: string) =>
  `${ML_AUTH()}/authorization?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state })}`
