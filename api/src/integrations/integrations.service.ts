import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { one, type Db } from '../common/db'
import { decrypt, encrypt } from '../settings/settings.service'

type Box = { iv: string; tag: string; data: string }
export interface ProviderDef { label: string; config: string[]; secrets: string[]; ready: boolean }

// Integrações disponíveis. "ready" = já tem envio/recebimento no sistema; as outras só guardam as chaves por enquanto.
export const PROVIDERS: Record<string, ProviderDef> = {
  whatsapp: { label: 'WhatsApp (Meta)', ready: true, config: ['phoneNumberId', 'businessAccountId', 'apiVersion', 'templateName', 'templateLanguage', 'testNumber'], secrets: ['accessToken', 'appSecret', 'verifyToken'] },
  mercadolivre: { label: 'Mercado Livre', ready: false, config: ['clientId', 'redirectUri'], secrets: ['clientSecret'] },
  shopee: { label: 'Shopee', ready: false, config: ['partnerId', 'shopId'], secrets: ['partnerKey'] },
  magalu: { label: 'Magalu', ready: false, config: ['clientId'], secrets: ['clientSecret'] },
}

export interface LogEntry {
  provider: string; direction: 'out' | 'in'; kind: string; status: string; externalId?: string | null; target?: string | null
  docKind?: string | null; docId?: string | null; summary?: string | null; error?: string | null; payload?: unknown; companyId?: string | null; userId?: string | null
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly db: DataSource) {}

  def(provider: string) {
    const d = PROVIDERS[provider]
    if (!d) throw new NotFoundException('Integração não encontrada')
    return d
  }

  // Uso interno: configuração com as chaves abertas.
  async get(provider: string, db: Db = this.db) {
    this.def(provider)
    const row = await one(db, `SELECT * FROM integrations WHERE provider = $1`, [provider])
    const secrets: Record<string, string> = {}
    for (const [k, box] of Object.entries((row?.secrets ?? {}) as Record<string, Box>)) {
      try { secrets[k] = decrypt(box) } catch { /* chave do servidor mudou: precisa colar de novo */ }
    }
    return { enabled: !!row?.enabled, config: (row?.config ?? {}) as Record<string, string>, secrets, status: (row?.status ?? 'desconectado') as string }
  }

  // Para a tela: as chaves nunca saem, só se estão preenchidas e o final.
  async list() {
    const rows: any[] = await this.db.query(`SELECT * FROM integrations`)
    return Object.entries(PROVIDERS).map(([provider, d]) => {
      const row = rows.find((r) => r.provider === provider)
      const secrets = Object.fromEntries(d.secrets.map((k) => {
        const box = row?.secrets?.[k] as Box | undefined
        let end: string | null = null
        if (box) try { end = decrypt(box).slice(-4) } catch { end = null }
        return [k, { set: !!box, end }]
      }))
      return {
        provider, label: d.label, ready: d.ready, enabled: !!row?.enabled, status: !row?.enabled ? 'desativado' : row?.status ?? 'desconectado', lastError: row?.last_error ?? null,
        checkedAt: row?.checked_at ?? null, updatedAt: row?.updated_at ?? null, config: row?.config ?? {}, secrets,
      }
    })
  }

  // Grava: chave vazia ('') apaga, ausente mantém a atual.
  async save(provider: string, input: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, unknown> }, userId: string) {
    const d = this.def(provider)
    const row = await one(this.db, `SELECT config, secrets, enabled FROM integrations WHERE provider = $1`, [provider])
    const config: Record<string, string> = { ...(row?.config ?? {}) }
    for (const [k, v] of Object.entries(input.config ?? {})) {
      if (!d.config.includes(k)) throw new BadRequestException(`Campo desconhecido: ${k}`)
      const text = String(v ?? '').trim()
      if (text.length > 300) throw new BadRequestException(`${k}: texto longo demais`)
      if (text) config[k] = text; else delete config[k]
    }
    const secrets: Record<string, Box> = { ...(row?.secrets ?? {}) }
    for (const [k, v] of Object.entries(input.secrets ?? {})) {
      if (!d.secrets.includes(k)) throw new BadRequestException(`Chave desconhecida: ${k}`)
      if (v === undefined || v === null) continue
      const text = String(v).trim()
      if (text.length > 2000) throw new BadRequestException(`${k}: chave longa demais`)
      if (text) secrets[k] = encrypt(text); else delete secrets[k]
    }
    await this.db.query(
      `INSERT INTO integrations (provider, enabled, config, secrets, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (provider) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config, secrets = EXCLUDED.secrets, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [provider, input.enabled ?? row?.enabled ?? false, JSON.stringify(config), JSON.stringify(secrets), userId],
    )
  }

  async setStatus(provider: string, status: 'conectado' | 'erro' | 'desconectado', error: string | null) {
    await this.db.query(
      `INSERT INTO integrations (provider, status, last_error, checked_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (provider) DO UPDATE SET status = $2, last_error = $3, checked_at = now()`,
      [provider, status, error],
    )
  }

  async log(e: LogEntry, db: Db = this.db) {
    const row = await one(db,
      `INSERT INTO integration_logs (provider, direction, kind, external_id, status, target, doc_kind, doc_id, summary, error, payload, company_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [e.provider, e.direction, e.kind, e.externalId ?? null, e.status, e.target ?? null, e.docKind ?? null, e.docId ?? null, e.summary?.slice(0, 2000) ?? null,
        e.error?.slice(0, 2000) ?? null, e.payload === undefined ? null : JSON.stringify(e.payload), e.companyId ?? null, e.userId ?? null])
    return row!.id as string
  }

  async logs(provider: string | null, docKind?: string, docId?: string, limit = 200) {
    return this.db.query(
      `SELECT l.id, l.provider, l.direction, l.kind, l.external_id AS "externalId", l.status, l.target, l.doc_kind AS "docKind", l.doc_id AS "docId",
              l.summary, l.error, l.created_at AS "createdAt", l.updated_at AS "updatedAt", u.name AS "userName"
       FROM integration_logs l LEFT JOIN users u ON u.id = l.user_id
       WHERE ($1::text IS NULL OR l.provider = $1) AND ($2::text IS NULL OR l.doc_kind = $2) AND ($3::uuid IS NULL OR l.doc_id = $3)
       ORDER BY l.created_at DESC LIMIT $4`,
      [provider, docKind ?? null, docId ?? null, limit],
    )
  }
}
