import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { one } from '../common/db'
import { addDays, today } from '../finance/finance.logic'
import { ParametersService } from '../params/parameters.service'
import type { User } from '../users/user.entity'
import { CurrentBranch } from '../branches/branch.context'
import { SalesDocDto, SalesDocsService } from './sales-docs.service'
import { SalesEmailService, SendEmailDto } from './sales-email.service'

class ListQuery {
  @IsOptional() @IsIn(['aberto', 'ganho', 'perdido', 'todos']) status?: string
  @IsOptional() @IsString() @MaxLength(100) q?: string
}
class LoseDto {
  @IsString() @Length(3, 300, { message: 'Diga o motivo da perda (preço, prazo, concorrente…)' }) reason: string
}

// Orçamentos: negociação com o cliente. Ganho gera o pedido de venda; perdido guarda o motivo.
@Controller('sales-quotes')
export class QuotesController {
  constructor(private readonly db: DataSource, private readonly docs: SalesDocsService, private readonly params: ParametersService, private readonly email: SalesEmailService) {}

  @Get()
  list(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Query() q: ListQuery) {
    this.docs.requireSales(me)
    return this.docs.list(this.db, 'quote', me, q.status ?? 'todos', q.q, branch)
  }

  @Get(':id')
  get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.docs.requireSales(me)
    return this.docs.load(this.db, 'quote', id, me)
  }

  @Post()
  async create(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Body() dto: SalesDocDto) {
    this.docs.requireSales(me)
    await this.docs.useBranch(me, dto, branch)
    const days = await this.params.get<number>('MV_ORCVAL')
    return this.db.transaction(async (tx) => {
      const prep = await this.docs.prepare(tx, dto)
      const row = await one(tx, `INSERT INTO sales_quotes (company_id, customer_id, seller_id, operation_type_id, payment_term_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [prep.companyId, dto.customerId, me.id, prep.operation.id, dto.paymentTermId])
      await this.docs.save(tx, 'quote', row!.id, { ...dto, validUntil: dto.validUntil ?? addDays(today(), days) })
      return this.docs.load(tx, 'quote', row!.id, me)
    })
  }

  @Put(':id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalesDocDto) {
    this.docs.requireSales(me)
    return this.db.transaction(async (tx) => {
      const quote = await this.docs.editable(tx, 'quote', id, me)
      if (quote.status !== 'aberto') throw new BadRequestException('Só orçamentos em aberto podem ser alterados')
      await this.docs.useBranch(me, dto, quote.company_id)
      await this.docs.save(tx, 'quote', id, dto)
      return this.docs.load(tx, 'quote', id, me)
    })
  }

  // Ganho: gera o pedido de venda com os mesmos itens (impostos recalculados).
  @Post(':id/win')
  @HttpCode(200)
  async win(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.docs.requireSales(me)
    return this.db.transaction(async (tx) => {
      const quote = await this.docs.editable(tx, 'quote', id, me)
      if (quote.status !== 'aberto') throw new BadRequestException('Este orçamento já foi fechado')
      const dto = await this.docs.dtoFrom(tx, 'quote', id)
      const prep = await this.docs.prepare(tx, dto)
      if (prep.lines.some((l) => !l.fiscal)) throw new BadRequestException('Há itens sem regra na matriz fiscal (Cadastros › Fiscal)')
      const order = await one(tx, `INSERT INTO sales_orders (company_id, customer_id, seller_id, operation_type_id, payment_term_id, quote_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [prep.companyId, dto.customerId, quote.seller_id, prep.operation.id, dto.paymentTermId, id])
      await this.docs.save(tx, 'order', order!.id, dto)
      await tx.query(`UPDATE sales_quotes SET status = 'ganho', closed_at = now(), updated_at = now() WHERE id = $1`, [id])
      return this.docs.load(tx, 'order', order!.id, me)
    })
  }

  @Post(':id/lose')
  @HttpCode(200)
  async lose(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LoseDto) {
    this.docs.requireSales(me)
    return this.db.transaction(async (tx) => {
      const quote = await this.docs.editable(tx, 'quote', id, me)
      if (quote.status !== 'aberto') throw new BadRequestException('Este orçamento já foi fechado')
      await tx.query(`UPDATE sales_quotes SET status = 'perdido', lost_reason = $2, closed_at = now(), updated_at = now() WHERE id = $1`, [id, dto.reason.trim()])
      return this.docs.load(tx, 'quote', id, me)
    })
  }

  @Post(':id/reopen')
  @HttpCode(200)
  async reopen(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.docs.requireSales(me)
    return this.db.transaction(async (tx) => {
      const quote = await this.docs.editable(tx, 'quote', id, me)
      if (quote.status !== 'perdido') throw new BadRequestException('Só orçamentos perdidos podem ser reabertos')
      await tx.query(`UPDATE sales_quotes SET status = 'aberto', lost_reason = NULL, closed_at = NULL, updated_at = now() WHERE id = $1`, [id])
      return this.docs.load(tx, 'quote', id, me)
    })
  }

  // E-mail ao cliente: rascunho (modelo + e-mail do cadastro) e envio com histórico.
  @Get(':id/email')
  emailDraft(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.docs.requireSales(me)
    return this.email.draft('quote', id, me)
  }

  @Post(':id/email')
  @HttpCode(200)
  sendEmail(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendEmailDto) {
    this.docs.requireSales(me)
    return this.email.send('quote', id, me, dto)
  }
}
