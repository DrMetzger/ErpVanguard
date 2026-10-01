import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { control } from './control-config'

const key = () => createHash('sha256').update(`${control.secret}:control`).digest()

export function seal(text: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
export function open(box: string) {
  const [iv, tag, data] = box.split('.').map((s) => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', key(), iv!)
  d.setAuthTag(tag!)
  return Buffer.concat([d.update(data!), d.final()]).toString('utf8')
}

// Senha forte legível (sem caracteres confusos)
export function password(n = 16) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(randomBytes(n), (b) => abc[b % abc.length]).join('')
}

// Token do painel: payload.assinatura (HMAC), expira em horas.
export function signToken(payload: Record<string, unknown>, hours: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600_000 })).toString('base64url')
  return `${body}.${createHmac('sha256', key()).update(body).digest('base64url')}`
}
export function readToken(token: string): Record<string, any> | null {
  const [body, sig] = String(token).split('.')
  if (!body || !sig) return null
  const want = createHmac('sha256', key()).update(body).digest('base64url')
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    return p.exp > Date.now() ? p : null
  } catch { return null }
}
export const hashCode = (code: string) => createHmac('sha256', key()).update(code).digest('hex')
