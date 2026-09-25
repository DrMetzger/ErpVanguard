import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { numbers, one } from '../common/db'
import { found } from '../purchasing/purchasing.helpers'
import type { User } from '../users/user.entity'
import { addDays, addMonths, createTitles, recalcTitle, round2, splitAmount, today } from './finance.logic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

class ListQuery {
  @IsIn(['R', 'P']) kind: 'R' | 'P'
  @IsOptional() @IsIn(['aberto', 'vencido', 'pago', 'cancelado', 'todos']) status?: string
  @IsOptional() @Matches(DATE) from?: string
  @IsOptional() @Matches(DATE) to?: string
  @IsOptional() @IsString() @MaxLength(100) q?: string
}

class TitleDto {
  @IsIn(['R', 'P']) kind: 'R' | 'P'
  @IsOptional() @IsUUID() companyId?: string
  @IsOptional() @IsUUID() customerId?: string
  @IsOptional() @IsUUID() supplierId?: string
  @IsOptional() @IsUUID() categoryId?: string
  @IsString() @Length(2, 200, { message: 'Descreva o título' }) description: string
  @IsOptional() @IsString() @MaxLength(40) document?: string
  @Matches(DATE, { message: 'Vencimento inválido' }) dueDate: string
  @Type(() => Number) @IsNumber() @Min(0.01, { message: 'Valor deve ser maior que zero' }) amount: number
  // Divide o valor em N parcelas mensais (ou repete o valor, se "repeat")
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) installments?: number
  @IsOptional() @IsIn(['dividir', 'repetir']) mode?: 'dividir' | 'repetir'
  @IsOptional() @IsString() @MaxLength(1000) notes?: string
}

class UpdateTitleDto {
  @IsOptional() @Matches(DATE, { message: 'Vencimento inválido' }) dueDate?: string
  @IsOptional() @IsString() @Length(2, 200) description?: string
  @IsOptional() @IsUUID() categoryId?: string
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) amount?: number
  @IsOptional() @IsString() @MaxLength(1000) notes?: string
}

class PayDto {
  @IsUUID() bankAccountId: string
  @Matches(DATE, { message: 'Data da baixa inválida' }) paidAt: string
  @Type(() => Number) @IsNumber() @Min(0.01, { message: 'Valor deve ser maior que zero' }) amount: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) interest?: number
  @IsOptional() @IsString() @MaxLength(500) notes?: string
}

class FlowQuery {
  @IsOptional() @Matches(DATE) from?: string
  @IsOptional() @Matches(DATE) to?: string
  @IsOptional() @IsUUID() bankAccountId?: string
}

const TITLE_SELECT = `
  SELECT t.id, t.kind, t.description, t.document, t.installment, t.installments, t.issue_date::text AS "issueDate", t.due_date::text AS "dueDate",
         t.amount, t.paid_amount AS "paidAmount", t.amount - t.paid_amount AS balance, t.status, t.notes, t.created_at AS "createdAt",
         t.customer_id AS "customerId", t.supplier_id AS "supplierId", coalesce(c.name, s.name) AS partner, coalesce(c.document, s.cnpj) AS "partnerDocument",
         t.category_id AS "categoryId", fc.code || ' · ' || fc.name AS category, t.company_id AS "companyId", co.code || ' · ' || coalesce(co.trade_name, co.name) AS company,
         t.sales_invoice_id AS "salesInvoiceId", t.invoice_id AS "invoiceId",
         CASE WHEN t.status IN ('aberto', 'parcial') AND t.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
              THEN ((now() AT TIME ZONE 'America/Sao_Paulo')::date - t.due_date) ELSE 0 END AS "daysOverdue"
  FROM financial_titles t
  LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN suppliers s ON s.id = t.supplier_id
  LEFT JOIN finance_categories fc ON fc.id = t.category_id LEFT JOIN companies co ON co.id = t.company_id`

const money = (r: any) => numbers(r, 'amount', 'paidAmount', 'balance', 'discount', 'interest')

// Contas a pagar e a receber, baixas e fluxo de caixa.
@Controller('finance')
export class FinanceController {
  constructor(private readonly db: DataSource) {}

  @Get('titles')
  async list(@CurrentUser() me: User, @Query() q: ListQuery) {
    requirePermission(me, 'financeiro')
    const status = q.status ?? 'aberto'
    const rows = await this.db.query(
      `${TITLE_SELECT}
       WHERE t.kind = $1
         AND CASE $2 WHEN 'aberto' THEN t.status IN ('aberto', 'parcial')
                     WHEN 'vencido' THEN t.status IN ('aberto', 'parcial') AND t.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
                     WHEN 'todos' THEN true ELSE t.status = $2 END
         AND ($3::date IS NULL OR t.due_date >= $3) AND ($4::date IS NULL OR t.due_date <= $4)
         AND ($5::text IS NULL OR t.description ILIKE '%' || $5 || '%' OR t.document ILIKE '%' || $5 || '%' OR coalesce(c.name, s.name) ILIKE '%' || $5 || '%')
       ORDER BY t.due_date, t.created_at LIMIT 1000`,
      [q.kind, status, q.from ?? null, q.to ?? null, q.q?.trim() || null],
    )
    return rows.map(money)
  }

  @Get('titles/:id')
  async get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'financeiro')
    return this.load(id)
  }

  @Post('titles')
  async create(@CurrentUser() me: User, @Body() dto: TitleDto) {
    requirePermission(me, 'financeiro')
    if (dto.kind === 'R' && dto.supplierId) throw new BadRequestException('Conta a receber é de um cliente')
    if (dto.kind === 'P' && dto.customerId) throw new BadRequestException('Conta a pagar é de um fornecedor')
    const n = dto.installments ?? 1
    const amounts = dto.mode === 'repetir' ? Array(n).fill(round2(dto.amount)) : splitAmount(round2(dto.amount), n)
    const company = dto.companyId ?? (await one(this.db, `SELECT id FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`))?.id ?? null
    const ids = await this.db.transaction((tx) =>
      createTitles(tx, {
        kind: dto.kind, companyId: company, customerId: dto.customerId, supplierId: dto.supplierId, categoryId: dto.categoryId ?? null,
        description: dto.description.trim(), document: dto.document?.trim() || null, issueDate: today(), notes: dto.notes,
        parcels: amounts.map((amount, i) => ({ amount, dueDate: addMonths(dto.dueDate, i) })), userId: me.id,
      }),
    )
    return this.load(ids[0]!)
  }

  @Patch('titles/:id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTitleDto) {
    requirePermission(me, 'financeiro')
    const title = found(await one(this.db, `SELECT status, paid_amount FROM financial_titles WHERE id = $1`, [id]), 'Título não encontrado')
    if (['pago', 'cancelado'].includes(title.status)) throw new BadRequestException('Título pago ou cancelado não pode ser alterado')
    if (dto.amount !== undefined && Number(title.paid_amount) > 0) throw new BadRequestException('Título com baixa não pode mudar de valor; estorne a baixa antes')
    await this.db.query(
      `UPDATE financial_titles SET due_date = coalesce($2, due_date), description = coalesce($3, description), category_id = coalesce($4, category_id),
              amount = coalesce($5, amount), notes = coalesce($6, notes) WHERE id = $1`,
      [id, dto.dueDate ?? null, dto.description?.trim() ?? null, dto.categoryId ?? null, dto.amount !== undefined ? round2(dto.amount) : null, dto.notes ?? null],
    )
    return this.load(id)
  }

  @Post('titles/:id/pay')
  async pay(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    requirePermission(me, 'financeiro')
    return this.db.transaction(async (tx) => {
      const title = found(await one(tx, `SELECT * FROM financial_titles WHERE id = $1 FOR UPDATE`, [id]), 'Título não encontrado')
      if (!['aberto', 'parcial'].includes(title.status)) throw new BadRequestException('Este título não está em aberto')
      found(await one(tx, `SELECT id FROM bank_accounts WHERE id = $1 AND active`, [dto.bankAccountId]), 'Conta bancária não encontrada')
      const discount = round2(dto.discount ?? 0)
      const interest = round2(dto.interest ?? 0)
      const principal = round2(dto.amount + discount - interest)
      const balance = round2(Number(title.amount) - Number(title.paid_amount))
      if (principal <= 0) throw new BadRequestException('Valor da baixa inválido')
      if (principal > balance + 0.005) throw new BadRequestException(`A baixa (R$ ${principal.toFixed(2)}) passa do saldo do título (R$ ${balance.toFixed(2)})`)
      await tx.query(
        `INSERT INTO financial_payments (title_id, bank_account_id, paid_at, amount, discount, interest, notes, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, dto.bankAccountId, dto.paidAt, round2(dto.amount), discount, interest, dto.notes ?? null, me.id],
      )
      await recalcTitle(tx, id)
      return this.load(id, tx)
    })
  }

  // Estorno de uma baixa.
  @Delete('payments/:id')
  async unpay(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'financeiro')
    return this.db.transaction(async (tx) => {
      const payment = found(await one(tx, `SELECT title_id FROM financial_payments WHERE id = $1`, [id]), 'Baixa não encontrada')
      await tx.query(`DELETE FROM financial_payments WHERE id = $1`, [id])
      await recalcTitle(tx, payment.title_id)
      return this.load(payment.title_id, tx)
    })
  }

  @Post('titles/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'financeiro')
    const title = found(await one(this.db, `SELECT status, paid_amount, sales_invoice_id FROM financial_titles WHERE id = $1`, [id]), 'Título não encontrado')
    if (Number(title.paid_amount) > 0) throw new BadRequestException('Estorne as baixas antes de cancelar')
    if (title.sales_invoice_id) throw new BadRequestException('Título de nota fiscal: cancele a nota no Faturamento')
    await this.db.query(`UPDATE financial_titles SET status = 'cancelado' WHERE id = $1`, [id])
    return this.load(id)
  }

  // Números do topo da tela.
  @Get('summary')
  async summary(@CurrentUser() me: User) {
    requirePermission(me, 'financeiro')
    const [t] = await this.db.query(
      `SELECT
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'R'), 0) AS "receivable",
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'R' AND due_date < d), 0) AS "receivableOverdue",
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'R' AND due_date BETWEEN d AND d + 7), 0) AS "receivableWeek",
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'P'), 0) AS "payable",
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'P' AND due_date < d), 0) AS "payableOverdue",
         coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'P' AND due_date BETWEEN d AND d + 7), 0) AS "payableWeek"
       FROM financial_titles, (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d) today
       WHERE status IN ('aberto', 'parcial')`,
    )
    const accounts = await this.balances()
    return { ...numbers(t, 'receivable', 'receivableOverdue', 'receivableWeek', 'payable', 'payableOverdue', 'payableWeek'), accounts, cash: round2(accounts.reduce((s, a) => s + a.balance, 0)) }
  }

  @Get('bank-balances')
  async bankBalances(@CurrentUser() me: User) {
    requirePermission(me, 'financeiro')
    return this.balances()
  }

  // Fluxo de caixa dia a dia: realizado (baixas) e previsto (títulos em aberto; atrasados entram no primeiro dia).
  @Get('cash-flow')
  async cashFlow(@CurrentUser() me: User, @Query() q: FlowQuery) {
    requirePermission(me, 'financeiro')
    const from = q.from ?? today()
    const to = q.to ?? addDays(from, 30)
    if (to < from) throw new BadRequestException('Período inválido')
    if (Date.parse(to) - Date.parse(from) > 400 * 86400e3) throw new BadRequestException('Período máximo de 400 dias')
    const account = q.bankAccountId ?? null
    const [opening] = await this.db.query(
      `SELECT coalesce((SELECT sum(opening_balance) FROM bank_accounts WHERE active AND ($2::uuid IS NULL OR id = $2)), 0)
            + coalesce((SELECT sum(CASE t.kind WHEN 'R' THEN p.amount ELSE -p.amount END) FROM financial_payments p JOIN financial_titles t ON t.id = p.title_id
                        WHERE p.paid_at < $1 AND ($2::uuid IS NULL OR p.bank_account_id = $2)), 0) AS balance`,
      [from, account],
    )
    const realized = await this.db.query(
      `SELECT p.paid_at::text AS day, sum(p.amount) FILTER (WHERE t.kind = 'R') AS "in", sum(p.amount) FILTER (WHERE t.kind = 'P') AS "out"
       FROM financial_payments p JOIN financial_titles t ON t.id = p.title_id
       WHERE p.paid_at BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR p.bank_account_id = $3) GROUP BY 1`,
      [from, to, account],
    )
    const projected = await this.db.query(
      `SELECT greatest(due_date, $1::date)::text AS day, sum(amount - paid_amount) FILTER (WHERE kind = 'R') AS "in", sum(amount - paid_amount) FILTER (WHERE kind = 'P') AS "out"
       FROM financial_titles WHERE status IN ('aberto', 'parcial') AND due_date <= $2 AND greatest(due_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date) >= $1 GROUP BY 1`,
      [from, to],
    )
    const byDay = (rows: any[]) => new Map(rows.map((r) => [r.day, { in: Number(r.in ?? 0), out: Number(r.out ?? 0) }]))
    const r = byDay(realized)
    const p = byDay(projected)
    const days = []
    let balance = Number(opening.balance)
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const real = r.get(d) ?? { in: 0, out: 0 }
      const plan = p.get(d) ?? { in: 0, out: 0 }
      balance = round2(balance + real.in - real.out + plan.in - plan.out)
      days.push({ date: d, inRealized: real.in, outRealized: real.out, inProjected: plan.in, outProjected: plan.out, balance })
    }
    return { from, to, opening: round2(Number(opening.balance)), closing: balance, days }
  }

  private async balances() {
    const rows = await this.db.query(
      `SELECT a.id, a.code, a.name, a.kind, a.bank_code AS "bankCode",
              a.opening_balance + coalesce((SELECT sum(CASE t.kind WHEN 'R' THEN p.amount ELSE -p.amount END)
                                            FROM financial_payments p JOIN financial_titles t ON t.id = p.title_id WHERE p.bank_account_id = a.id), 0) AS balance
       FROM bank_accounts a WHERE a.active ORDER BY a.code`,
    )
    return rows.map((r: any) => numbers(r, 'balance')) as { id: string; code: string; name: string; kind: string; bankCode: string | null; balance: number }[]
  }

  private async load(id: string, db: DataSource | any = this.db) {
    const title = money(found(await one(db, `${TITLE_SELECT} WHERE t.id = $1`, [id]), 'Título não encontrado'))
    const payments = await db.query(
      `SELECT p.id, p.paid_at::text AS "paidAt", p.amount, p.discount, p.interest, p.notes, p.created_at AS "createdAt",
              a.code || ' · ' || a.name AS "bankAccount", u.name AS "userName"
       FROM financial_payments p JOIN bank_accounts a ON a.id = p.bank_account_id LEFT JOIN users u ON u.id = p.user_id
       WHERE p.title_id = $1 ORDER BY p.paid_at, p.created_at`,
      [id],
    )
    return { ...title, payments: payments.map(money) }
  }
}
