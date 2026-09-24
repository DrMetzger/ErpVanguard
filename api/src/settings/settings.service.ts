import { Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { DataSource } from 'typeorm'
import { config } from '../config'

export interface GeminiSettings { apiKey: string | null; model: string; fallbackModels: string[]; source: 'tela' | 'servidor' | 'nenhuma' }
export interface NfeSettings { autoAi: boolean }
export interface CompanySettings { name: string; cnpj: string; uf: string }

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

  async saveNfe(input: NfeSettings, userId: string) {
    await this.write('nfe', { autoAi: !!input.autoAi }, userId)
  }

  async company(): Promise<CompanySettings> {
    return { name: '', cnpj: '', uf: 'SP', ...((await this.read<CompanySettings>('company')) ?? {}) }
  }

  async saveCompany(input: CompanySettings, userId: string) {
    await this.write('company', input, userId)
  }
}
