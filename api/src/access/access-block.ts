import { ForbiddenException } from '@nestjs/common'
import type { DataSource } from 'typeorm'

// Bloqueio de acesso do cliente (ex.: fatura em aberto). Quem liga/desliga é o painel da Prime ERP,
// pelo agente da VPS, gravando a chave 'access_block' no banco do cliente. Ninguém dentro do ERP consegue mudar.
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'kleber.farias@primeerp.com.br'
export const BLOCK_MESSAGE = `Seu acesso encontra-se desativado. Favor contactar a equipe de suporte pelo e-mail ${SUPPORT_EMAIL}.`

let cache: { at: number; blocked: boolean } | null = null

export async function isBlocked(db: DataSource) {
  if (cache && Date.now() - cache.at < 10_000) return cache.blocked
  const [row] = await db.query(`SELECT value FROM app_settings WHERE key = 'access_block'`)
  cache = { at: Date.now(), blocked: !!row?.value?.blocked }
  return cache.blocked
}

export async function ensureNotBlocked(db: DataSource) {
  if (await isBlocked(db)) throw new ForbiddenException({ code: 'ACCESS_BLOCKED', message: BLOCK_MESSAGE, supportEmail: SUPPORT_EMAIL })
}
