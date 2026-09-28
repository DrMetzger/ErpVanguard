import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common'
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'
import { MailService } from './mail.service'
import { renderEmail, VARIABLES, type DocData } from './render'

const KEYS = ['quote', 'order']

class TemplateDto {
  @IsString() @Length(1, 200, { message: 'Informe o assunto (até 200 caracteres)' }) subject: string
  @IsString() @MaxLength(2000) header: string
  @IsString() @Length(1, 10000, { message: 'Informe o corpo do e-mail' }) body: string
  @IsString() @MaxLength(2000) signature: string
  @IsString() @MaxLength(2000) footer: string
  @IsBoolean() showLogo: boolean
}

class TestDto {
  @IsOptional() @IsEmail({}, { message: 'E-mail de destino inválido' }) to?: string
}

class KeyParam {
  @IsIn(KEYS) key: string
}

// Dados de exemplo para a prévia do modelo (o nome traz < > para mostrar o escape).
function sample(company: string, seller: string): DocData {
  return {
    values: { cliente: 'Construtora Exemplo <Ltda> & Cia', numero: 'ORC-000123', total: 'R$ 1.259,40', validade: '15/10/2026', data: '30/09/2026', empresa: company, vendedor: seller, condicao: '30/60/90 dias', observacoes: 'Entrega em até 5 dias úteis.' },
    items: [
      { sku: 'FUR-500', name: 'Furadeira de impacto 500W', unit: 'UN', quantity: 4, unitPrice: 249.9, discountPct: 0, total: 999.6 },
      { sku: 'BRO-08', name: 'Broca para concreto 8mm', unit: 'UN', quantity: 30, unitPrice: 9.5, discountPct: 10, total: 256.5 },
    ],
    freight: 30, discount: 26.7, total: 1259.4,
  }
}

@Controller()
export class MailController {
  constructor(private readonly db: DataSource, private readonly mail: MailService) {}

  @Get('email-templates')
  async list(@CurrentUser() me: User) {
    requireAdmin(me)
    return { templates: await this.mail.templates(), variables: VARIABLES }
  }

  @Put('email-templates/:key')
  save(@CurrentUser() me: User, @Param() p: KeyParam, @Body() dto: TemplateDto) {
    requireAdmin(me)
    return this.mail.saveTemplate(p.key, dto, me.id)
  }

  // Prévia ao vivo do rascunho do modelo, com dados de exemplo e o logo da matriz.
  @Post('email-templates/:key/preview')
  @HttpCode(200)
  async preview(@CurrentUser() me: User, @Param() p: KeyParam, @Body() dto: TemplateDto) {
    requireAdmin(me)
    const company = await one(this.db, `SELECT coalesce(trade_name, name) AS name, logo FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    const doc = sample(company?.name ?? 'Sua empresa', me.name)
    if (p.key === 'order') doc.values.numero = 'PV-000123'
    return renderEmail({ key: p.key, name: '', ...dto }, doc, { logo: company?.logo ?? null })
  }

  @Post('settings/smtp/test')
  @HttpCode(200)
  async test(@CurrentUser() me: User, @Body() dto: TestDto) {
    requireAdmin(me)
    const to = dto.to || me.email
    const info = await this.mail.send({
      to: [to], subject: 'Teste de e-mail do ERP Vanguard',
      html: `<p>Este é um e-mail de teste enviado pelo <b>ERP Vanguard</b>.</p><p>Se você recebeu, o envio de orçamentos por e-mail está pronto.</p>`,
      text: 'Este é um e-mail de teste enviado pelo ERP Vanguard. Se você recebeu, o envio de orçamentos por e-mail está pronto.',
    })
    return { ok: true, to, messageId: info.messageId }
  }
}
