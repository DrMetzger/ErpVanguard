import { Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { config } from '../config'

export interface GeminiSettings { apiKey: string | null; model: string; fallbackModels: string[]; source: 'tela' | 'servidor' | 'nenhuma' }
export interface NfeSettings { autoAi: boolean }
export interface SecuritySettings { twoFactor: boolean }
export interface CompanySettings { name: string; cnpj: string; uf: string }
export interface SerasaSettings { enabled: boolean; environment: 'homologacao' | 'producao'; clientId: string | null; clientSecret: string | null }
export type SmtpSecurity = 'ssl' | 'starttls' | 'nenhuma'
export interface SmtpSettings {
  host: string | null; port: number; security: SmtpSecurity; user: string | null; password: string | null
  fromName: string | null; fromEmail: string | null; replyTo: string | null; source: 'tela' | 'servidor' | 'nenhuma'
}
export interface SmtpInput {
  host?: string; port?: number; security?: SmtpSecurity; user?: string; password?: string; clearPassword?: boolean
  fromName?: string; fromEmail?: string; replyTo?: string
}

// "Nome <email@x>" ou só o e-mail.
const parseFrom = (from: string | null) => {
  const m = from?.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  return m ? { name: m[1]!.trim() || null, email: m[2]!.trim() } : { name: null, email: from?.trim() || null }
}

// Chave de criptografia derivada do segredo do servidor (nunca vai para o banco).
const key = () => createHash('sha256').update(`${config.jwtSecret}:app-settings`).digest()

export function encrypt(text: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

export function decrypt(box: { iv: string; tag: string; data: string }) {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8')
}

@Injectable()
export class SettingsService {
  constructor(private readonly db: DataSource) {}

  private async read<T>(k: string): Promise<T | null> {
    const [row] = await this.db.query(`SELECT value FROM app_settings WHERE key = $1`, [k])
    return row ? (row.value as T) : null
  }

  private async write(k: string, value: unknown, userId: string) {
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [k, JSON.stringify(value), userId],
    )
  }

  // O que foi salvo pela tela vale mais que as variáveis do servidor.
  async gemini(): Promise<GeminiSettings> {
    const saved = await this.read<{ apiKey?: { iv: string; tag: string; data: string }; model?: string; fallbackModels?: string[] }>('gemini')
    let apiKey: string | null = null
    let source: GeminiSettings['source'] = 'nenhuma'
    if (saved?.apiKey) {
      try {
        apiKey = decrypt(saved.apiKey)
        source = 'tela'
      } catch {
        apiKey = null // segredo do servidor mudou: a chave salva não abre mais
      }
    }
    if (!apiKey && config.geminiApiKey) {
      apiKey = config.geminiApiKey
      source = 'servidor'
    }
    return {
      apiKey,
      source,
      model: saved?.model || config.geminiModel,
      fallbackModels: saved?.fallbackModels?.length ? saved.fallbackModels : config.geminiFallbackModels,
    }
  }

  async saveGemini(input: { apiKey?: string; clearApiKey?: boolean; model?: string; fallbackModels?: string[] }, userId: string) {
    const saved = (await this.read<Record<string, unknown>>('gemini')) ?? {}
    if (input.clearApiKey) delete saved.apiKey
    if (input.apiKey) saved.apiKey = encrypt(input.apiKey.trim())
    if (input.model !== undefined) saved.model = input.model.trim()
    if (input.fallbackModels !== undefined) saved.fallbackModels = input.fallbackModels.map((m) => m.trim()).filter(Boolean)
    await this.write('gemini', saved, userId)
  }

  async nfe(): Promise<NfeSettings> {
    return { autoAi: false, ...((await this.read<NfeSettings>('nfe')) ?? {}) }
  }

  // Login em duas etapas: ligado por padrão.
  async security(): Promise<SecuritySettings> {
    return { twoFactor: true, ...((await this.read<SecuritySettings>('security')) ?? {}) }
  }

  async saveSecurity(input: SecuritySettings, userId: string) {
    await this.write('security', { twoFactor: !!input.twoFactor }, userId)
  }

  async saveNfe(input: NfeSettings, userId: string) {
    await this.write('nfe', { autoAi: !!input.autoAi }, userId)
  }

  // Serasa Experian (API paga, por contrato): fica pronto para ativar com as chaves.
  async serasa(): Promise<SerasaSettings> {
    const saved = await this.read<{ enabled?: boolean; environment?: 'homologacao' | 'producao'; clientId?: string; clientSecret?: { iv: string; tag: string; data: string } }>('serasa')
    let clientSecret: string | null = null
    try { clientSecret = saved?.clientSecret ? decrypt(saved.clientSecret) : null } catch { clientSecret = null }
    return { enabled: !!saved?.enabled, environment: saved?.environment ?? 'homologacao', clientId: saved?.clientId ?? null, clientSecret }
  }

  async saveSerasa(input: { enabled?: boolean; environment?: 'homologacao' | 'producao'; clientId?: string; clientSecret?: string; clearSecret?: boolean }, userId: string) {
    const saved = (await this.read<Record<string, unknown>>('serasa')) ?? {}
    if (input.enabled !== undefined) saved.enabled = input.enabled
    if (input.environment) saved.environment = input.environment
    if (input.clientId !== undefined) saved.clientId = input.clientId.trim() || null
    if (input.clearSecret) delete saved.clientSecret
    if (input.clientSecret) saved.clientSecret = encrypt(input.clientSecret.trim())
    await this.write('serasa', saved, userId)
  }

  // SMTP salvo na tela vale mais que o do servidor; a senha fica criptografada.
  async smtp(): Promise<SmtpSettings> {
    const saved = await this.read<Omit<SmtpInput, 'password'> & { password?: { iv: string; tag: string; data: string } }>('smtp')
    if (saved?.host) {
      let password: string | null = null
      try { password = saved.password ? decrypt(saved.password) : null } catch { password = null }
      return {
        host: saved.host, port: saved.port ?? 587, security: saved.security ?? 'starttls', user: saved.user || null, password,
        fromName: saved.fromName || null, fromEmail: saved.fromEmail || null, replyTo: saved.replyTo || null, source: 'tela',
      }
    }
    const env = config.smtp
    const from = parseFrom(env.from)
    const port = env.port ?? 587
    return {
      host: env.host, port, security: port === 465 ? 'ssl' : 'starttls', user: env.user, password: env.pass,
      fromName: from.name, fromEmail: from.email ?? env.user, replyTo: null, source: env.host ? 'servidor' : 'nenhuma',
    }
  }

  async saveSmtp(input: SmtpInput, userId: string) {
    const saved = (await this.read<Record<string, unknown>>('smtp')) ?? {}
    for (const k of ['host', 'user', 'fromName', 'fromEmail', 'replyTo'] as const) if (input[k] !== undefined) saved[k] = input[k]!.trim() || null
    if (input.port !== undefined) saved.port = input.port
    if (input.security) saved.security = input.security
    if (input.clearPassword) delete saved.password
    if (input.password) saved.password = encrypt(input.password)
    await this.write('smtp', saved, userId)
  }

  async company(): Promise<CompanySettings> {
    return { name: '', cnpj: '', uf: 'SP', ...((await this.read<CompanySettings>('company')) ?? {}) }
  }

  async saveCompany(input: CompanySettings, userId: string) {
    await this.write('company', input, userId)
  }
}
