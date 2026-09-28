import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config'

// Pasta dos arquivos enviados (no servidor é um volume do Docker).
export const MEDIA_DIR = process.env.MEDIA_DIR ?? join(process.cwd(), 'media')
export const VIDEO_DIR = join(MEDIA_DIR, 'videos')
mkdirSync(VIDEO_DIR, { recursive: true })

// O <video> do navegador não manda o token; por isso o link do arquivo é assinado e expira.
const sign = (id: string, exp: number) => createHmac('sha256', `${config.jwtSecret}:media`).update(`${id}.${exp}`).digest('base64url')

export function signedVideoUrl(id: string, hours = 6) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600
  return `/api/media/videos/${id}?exp=${exp}&sig=${sign(id, exp)}`
}

export function checkSignature(id: string, exp: string, sig: string) {
  const e = Number(exp)
  if (!Number.isInteger(e) || e < Date.now() / 1000) return false
  const expected = Buffer.from(sign(id, e))
  const given = Buffer.from(String(sig))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Link de vídeo aceito: YouTube, Vimeo ou arquivo de vídeo direto (https).
export function parseVideoLink(raw: string): { provider: 'youtube' | 'vimeo' | 'url'; url: string } | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1)
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? null
  if (id !== null) return /^[\w-]{6,20}$/.test(id) ? { provider: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}` } : null
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(\d{6,12})/)?.[1]
    return v ? { provider: 'vimeo', url: `https://player.vimeo.com/video/${v}` } : null
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { provider: 'url', url: u.toString() }
  return null
}
