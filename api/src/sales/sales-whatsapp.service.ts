import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { can } from '../common/access'
import { one } from '../common/db'
import { IntegrationsService } from '../integrations/integrations.service'
import { sendDocument, sendTemplate, uploadMedia, waNumber, WhatsAppError, type WaConfig } from '../integrations/whatsapp'
import { NfeService } from '../nfe/nfe.service'
import type { User } from '../users/user.entity'
import { buildDocPdf } from './doc-pdf'
import { SalesDocsService, type DocKind } from './sales-docs.service'

export class SendWhatsAppDto {
  @IsString() @Length(8, 20) to: string
  @IsOptional() @IsString() @MaxLength(900) message?: string
}

type WaKind = DocKind | 'invoice'
const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const NOT_READY = 'WhatsApp não configurado: preencha em Administração › Integrações'

// Envio de orçamento, pedido e NF (DANFE) ao cliente pelo WhatsApp, com histórico.
@Injectable()
export class SalesWhatsAppService {
  constructor(private readonly db: DataSource, private readonly docs: SalesDocsService, private readonly nfe: NfeService, private readonly integrations: IntegrationsService) {}

  private async config(): Promise<{ cfg: WaConfig; template: string | null; language: string }> {
    const it = await this.integrations.get('whatsapp')
    if (!it.enabled || !it.config.phoneNumberId || !it.secrets.accessToken) throw new BadRequestException(NOT_READY)
    return { cfg: { phoneNumberId: it.config.phoneNumberId, accessToken: it.secrets.accessToken, apiVersion: it.config.apiVersion }, template: it.config.templateName || null, language: it.config.templateLanguage || 'pt_BR' }
  }

  // Documento, telefone do cliente e texto padrão.
  private async prepare(kind: WaKind, id: string, me: User) {
    if (kind === 'invoice') {
      if (!can(me, 'faturamento')) throw new ForbiddenException('Seu usuário não tem o perfil "faturamento"')
      const inv = await one(this.db,
        `SELECT i.id, i.number, i.series, i.total, i.access_key, i.company_id, i.sefaz_status, c.name AS customer, c.phone, c.phone2, coalesce(co.trade_name, co.name) AS company
         FROM sales_invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id WHERE i.id = $1`, [id])
      if (!inv) throw new BadRequestException('Nota não encontrada')
      return {
        label: `NF ${inv.number}/${inv.series}`, companyId: inv.company_id as string, phone: (inv.phone2 || inv.phone) as string | null,
        message: `a nota fiscal ${inv.number}/${inv.series} da ${inv.company}, valor ${brl(Number(inv.total))}${inv.access_key ? `, chave ${inv.access_key}` : ''}`,
        file: async () => {
          const f = await this.nfe.file(id)
          if (!f.authorized) throw new BadRequestException('Só nota autorizada pela SEFAZ pode ser enviada ao cliente')
          const d = await this.nfe.danfe(id)
          return { buffer: d.pdf, name: d.name, mime: 'application/pdf' }
        },
      }
    }
    const doc: any = await this.docs.load(this.db, kind, id, me) // já confere se o usuário pode ver
    const x = (await one(this.db,
      `SELECT c.phone, c.phone2, c.document AS cdoc, concat_ws(', ', c.street, c.number, c.district, c.city || '/' || c.uf) AS caddr,
              coalesce(co.trade_name, co.name) AS company, co.document AS codoc, co.phone AS cophone, co.email AS coemail, co.logo,
              concat_ws(', ', co.street, co.number, co.district, co.city || '/' || co.uf) AS coaddr
       FROM ${kind === 'quote' ? 'sales_quotes' : 'sales_orders'} o JOIN customers c ON c.id = o.customer_id JOIN companies co ON co.id = o.company_id WHERE o.id = $1`, [id]))!
    const title = `${kind === 'quote' ? 'Orçamento' : 'Pedido de venda'} ${doc.code}`
    const dateBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
    return {
      label: doc.code as string, companyId: doc.companyId as string, phone: (x.phone2 || x.phone) as string | null,
      message: `${kind === 'quote' ? 'o orçamento' : 'o pedido'} ${doc.code} da ${x.company}, total ${brl(doc.total)}${kind === 'quote' && doc.validUntil ? `, válido até ${dateBr(doc.validUntil)}` : ''}`,
      file: async () => ({
        buffer: await buildDocPdf({
          title, company: { name: x.company, document: x.codoc, address: x.coaddr, phone: x.cophone, email: x.coemail, logo: x.logo },
          customer: { name: doc.customerName, document: x.cdoc, address: x.caddr },
          info: [['Data', dateBr(new Date(doc.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))], ['Validade', kind === 'quote' ? dateBr(doc.validUntil) : ''],
            ['Condição', doc.paymentTerm], ['Vendedor', doc.sellerName]],
          items: doc.items, freight: doc.freight, discount: doc.discount, total: doc.total, ipi: doc.taxes?.ipi, st: doc.taxes?.st, notes: doc.notes,
        }),
        name: `${doc.code}.pdf`, mime: 'application/pdf',
      }),
    }
  }

  async draft(kind: WaKind, id: string, me: User) {
    const p = await this.prepare(kind, id, me)
    const it = await this.integrations.get('whatsapp')
    return {
      to: waNumber(p.phone) ?? '', message: p.message, configured: it.enabled && !!it.config.phoneNumberId && !!it.secrets.accessToken,
      template: it.config.templateName || null, history: await this.integrations.logs('whatsapp', kind, id, 20),
    }
  }

  async send(kind: WaKind, id: string, me: User, dto: SendWhatsAppDto) {
    const p = await this.prepare(kind, id, me)
    const { cfg, template, language } = await this.config()
    const to = waNumber(dto.to)
    if (!to) throw new BadRequestException('Número inválido: use DDD + número (ex.: 17 99999-0000) ou o código do país')
    const text = (dto.message?.trim() || p.message)
    const file = await p.file()
    const log = (status: string, externalId: string | null, error: string | null) => this.integrations.log({
      provider: 'whatsapp', direction: 'out', kind: 'documento', status, externalId, target: to, docKind: kind, docId: id,
      summary: `${file.name}${template ? ` (modelo ${template})` : ''} · ${text}`, error, companyId: p.companyId, userId: me.id,
    })
    try {
      const mediaId = await uploadMedia(cfg, file.buffer, file.mime, file.name)
      // Com modelo aprovado: funciona mesmo sem conversa aberta. Sem modelo: só se o cliente falou nas últimas 24 h.
      const wamid = template
        ? await sendTemplate(cfg, to, template, language, [text], { id: mediaId, filename: file.name })
        : await sendDocument(cfg, to, mediaId, file.name, `Segue ${text}`)
      await log('enviado', wamid, null)
      return { ok: true, id: wamid, to, history: await this.integrations.logs('whatsapp', kind, id, 20) }
    } catch (e) {
      const message = e instanceof WhatsAppError ? e.message : `Falha no envio: ${(e as Error).message}`
      await log('erro', null, message)
      throw new BadRequestException(message)
    }
  }
}
