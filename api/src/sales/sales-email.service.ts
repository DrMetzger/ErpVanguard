import { BadRequestException, Injectable } from '@nestjs/common'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { one } from '../common/db'
import { logoAttachment, MailService, NOT_CONFIGURED } from '../mail/mail.service'
import { dateBr, money, renderEmail, renderMessage, renderSubject, type DocData } from '../mail/render'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'
import { SalesDocsService, type DocKind } from './sales-docs.service'

export class SendEmailDto {
  @IsArray() @ArrayMinSize(1, { message: 'Informe o e-mail do cliente' }) @ArrayMaxSize(10) @IsEmail({}, { each: true, message: 'E-mail de destino inválido' }) to: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true, message: 'E-mail em cópia inválido' }) cc?: string[]
  @IsOptional() @IsString() @Length(1, 250) subject?: string
  @IsOptional() @IsString() @MaxLength(10000) message?: string
}

// Envio de orçamento/pedido ao cliente pelo modelo de e-mail, com histórico.
@Injectable()
export class SalesEmailService {
  constructor(private readonly db: DataSource, private readonly docs: SalesDocsService, private readonly mail: MailService, private readonly settings: SettingsService) {}

  private async data(kind: DocKind, id: string, me: User) {
    const doc: any = await this.docs.load(this.db, kind, id, me) // já confere se o usuário pode ver
    const extra = await one(this.db,
      `SELECT c.email AS "customerEmail", coalesce(co.trade_name, co.name) AS company, co.logo
       FROM ${kind === 'quote' ? 'sales_quotes' : 'sales_orders'} o JOIN customers c ON c.id = o.customer_id JOIN companies co ON co.id = o.company_id WHERE o.id = $1`, [id])
    const data: DocData = {
      values: {
        cliente: doc.customerName, numero: doc.code, total: money(doc.total), validade: dateBr(doc.validUntil), data: dateBr(new Date(doc.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })),
        empresa: extra!.company, vendedor: doc.sellerName, condicao: doc.paymentTerm, observacoes: doc.notes ?? '',
      },
      items: doc.items.map((i: any) => ({ sku: i.sku, name: i.name, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct, total: i.total })),
      freight: doc.freight, discount: doc.discount, total: doc.total,
    }
    return { doc, data, customerEmail: extra!.customerEmail as string | null, logo: extra!.logo as string | null }
  }

  history(kind: DocKind, id: string) {
    return this.db.query(
      `SELECT e.id, e.to_addr AS "to", e.cc, e.subject, e.status, e.error, e.created_at AS "sentAt", u.name AS "userName"
       FROM sales_doc_emails e JOIN users u ON u.id = e.user_id WHERE e.doc_kind = $1 AND e.doc_id = $2 ORDER BY e.created_at DESC LIMIT 50`,
      [kind, id],
    )
  }

  // Rascunho para o modal: destinatário do cadastro, assunto e mensagem do modelo.
  async draft(kind: DocKind, id: string, me: User) {
    const { data, customerEmail } = await this.data(kind, id, me)
    const tpl = await this.mail.template(this.db, kind)
    const smtp = await this.settings.smtp()
    return {
      to: customerEmail ? customerEmail.split(/[;,\s]+/).filter(Boolean) : [],
      subject: renderSubject(tpl.subject, data),
      message: renderMessage(tpl.body, data),
      template: tpl.name,
      smtpConfigured: !!smtp.host && !!smtp.fromEmail,
      history: await this.history(kind, id),
    }
  }

  async send(kind: DocKind, id: string, me: User, dto: SendEmailDto) {
    const { data, logo } = await this.data(kind, id, me)
    const smtp = await this.settings.smtp()
    if (!smtp.host || !smtp.fromEmail) throw new BadRequestException(NOT_CONFIGURED)
    const tpl = await this.mail.template(this.db, kind)
    const attachment = tpl.showLogo ? logoAttachment(logo) : null
    const email = renderEmail(tpl, data, { body: dto.message, logo: attachment ? `cid:${attachment.cid}` : null })
    const subject = dto.subject ? renderSubject(dto.subject, data) : email.subject
    const log = (status: 'enviado' | 'erro', error: string | null, messageId: string | null) => this.db.query(
      `INSERT INTO sales_doc_emails (doc_kind, doc_id, to_addr, cc, subject, status, error, message_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [kind, id, dto.to.join(', '), dto.cc?.length ? dto.cc.join(', ') : null, subject, status, error, messageId, me.id],
    )
    try {
      const info = await this.mail.send({ to: dto.to, cc: dto.cc, subject, html: email.html, text: email.text, attachments: attachment ? [attachment] : [] })
      await log('enviado', null, info.messageId)
    } catch (error: any) {
      await log('erro', String(error.message).slice(0, 1000), null)
      throw error
    }
    return { ok: true, history: await this.history(kind, id) }
  }
}
