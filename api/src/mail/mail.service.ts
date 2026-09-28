import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { createTransport } from 'nodemailer'
import { DataSource } from 'typeorm'
import { one, type Db } from '../common/db'
import { SettingsService } from '../settings/settings.service'
import type { EmailTemplate } from './render'

export interface Attachment { filename: string; content: Buffer; contentType: string; cid?: string }
export interface Message { to: string[]; cc?: string[]; subject: string; html: string; text: string; attachments?: Attachment[] }

export const NOT_CONFIGURED = 'E-mail não configurado: preencha o servidor SMTP em Administração › Configurações'

const TEMPLATE_COLS = `key, name, subject, header, body, signature, footer, show_logo AS "showLogo", updated_at AS "updatedAt"`

// Logo da empresa (data URL do cadastro) → anexo embutido no e-mail.
export function logoAttachment(dataUrl: string | null | undefined): Attachment | null {
  const m = dataUrl?.match(/^data:(image\/(png|jpeg));base64,(.+)$/)
  if (!m) return null
  return { filename: `logo.${m[2] === 'png' ? 'png' : 'jpg'}`, content: Buffer.from(m[3]!, 'base64'), contentType: m[1]!, cid: 'logo@erpvanguard' }
}

// Envio por SMTP (config da tela ou do servidor) e modelos de e-mail.
@Injectable()
export class MailService {
  constructor(private readonly db: DataSource, private readonly settings: SettingsService) {}

  async templates(): Promise<EmailTemplate[]> {
    return this.db.query(`SELECT ${TEMPLATE_COLS} FROM email_templates ORDER BY key DESC`)
  }

  async template(db: Db, key: string): Promise<EmailTemplate> {
    const row = await one<EmailTemplate>(db, `SELECT ${TEMPLATE_COLS} FROM email_templates WHERE key = $1`, [key])
    if (!row) throw new NotFoundException('Modelo de e-mail não encontrado')
    return row
  }

  async saveTemplate(key: string, t: Omit<EmailTemplate, 'key' | 'name'>, userId: string) {
    const [, count] = await this.db.query(
      `UPDATE email_templates SET subject = $2, header = $3, body = $4, signature = $5, footer = $6, show_logo = $7, updated_by = $8, updated_at = now() WHERE key = $1`,
      [key, t.subject, t.header, t.body, t.signature, t.footer, t.showLogo, userId],
    )
    if (!count) throw new NotFoundException('Modelo de e-mail não encontrado')
    return this.template(this.db, key)
  }

  async send(msg: Message) {
    const smtp = await this.settings.smtp()
    if (!smtp.host || !smtp.fromEmail) throw new BadRequestException(NOT_CONFIGURED)
    const transport = createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.security === 'ssl', requireTLS: smtp.security === 'starttls', ignoreTLS: smtp.security === 'nenhuma',
      auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
      connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    })
    try {
      const info = await transport.sendMail({
        from: smtp.fromName ? { name: smtp.fromName, address: smtp.fromEmail } : smtp.fromEmail,
        replyTo: smtp.replyTo || undefined,
        to: msg.to, cc: msg.cc?.length ? msg.cc : undefined, subject: msg.subject, html: msg.html, text: msg.text,
        attachments: msg.attachments,
      })
      return { messageId: info.messageId as string, accepted: (info.accepted as unknown[]).map(String) }
    } catch (error: any) {
      throw new ServiceUnavailableException(`O servidor de e-mail recusou o envio: ${error.message}`)
    } finally {
      transport.close()
    }
  }
}
