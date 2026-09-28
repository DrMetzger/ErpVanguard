import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator'
import { DataSource, type EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { numbers, one, type Db } from '../common/db'
import { addDays, categoryByCode, createTitles, round2, splitAmount, termDays, today } from '../finance/finance.logic'
import { code, found } from '../purchasing/purchasing.helpers'
import { ParametersService } from '../params/parameters.service'
import { takeInvoiceNumber } from './numbering'
import { SalesDocDto, SalesDocsService } from './sales-docs.service'
import { SalesEmailService, SendEmailDto } from './sales-email.service'
import type { User } from '../users/user.entity'

class ListQuery {
  @IsOptional() @IsIn(['aberto', 'faturado', 'cancelado', 'todos']) status?: string
  @IsOptional() @IsString() @MaxLength(100) q?: string
}

class InvoiceListQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
  @IsOptional() @IsString() @MaxLength(100) q?: string
}

class PriceQuery {
  @IsUUID() productId: string
  @IsOptional() @IsUUID() priceTableId?: string
}

class ReadinessQuery {
  @IsOptional() @IsUUID() companyId?: string
}

class CancelDto {
  @IsString() @Length(15, 255, { message: 'Justificativa com pelo menos 15 caracteres (exigência da SEFAZ)' }) reason: string
}

type Tx = EntityManager | DataSource

// Pedidos de venda e notas de saída.
@Controller()
export class SalesController {
  constructor(private readonly db: DataSource, private readonly docs: SalesDocsService, private readonly params: ParametersService, private readonly email: SalesEmailService) {}

  // Preço sugerido e saldo em estoque para a tela do pedido.
  @Get('sales/price')
  async price(@CurrentUser() me: User, @Query() q: PriceQuery) {
    this.requireSales(me)
    const product = found(await one(this.db, `SELECT sale_price, stock, unit FROM products WHERE id = $1`, [q.productId]), 'Produto não encontrado')
    const table = q.priceTableId ? await one(this.db, `SELECT price FROM price_table_items WHERE price_table_id = $1 AND product_id = $2`, [q.priceTableId, q.productId]) : undefined
    return { price: Number(table?.price ?? product.sale_price), fromTable: !!table, stock: Number(product.stock), unit: product.unit }
  }

  // Prévia de preços, CFOP e impostos para a tela (orçamento ou pedido ainda não salvos).
  @Post('sales/preview')
  @HttpCode(200)
  async preview(@CurrentUser() me: User, @Body() dto: SalesDocDto) {
    this.requireSales(me)
    const prep = await this.docs.prepare(this.db, dto)
    return {
      totals: prep.totals, warnings: prep.warnings, regime: prep.regime,
      items: prep.lines.map((l) => ({ productId: l.productId, sku: l.sku, name: l.name, unit: l.unit, stock: l.stock, quantity: l.quantity, unitPrice: l.unitPrice,
        discountPct: l.discountPct, total: l.total, cfop: l.fiscal?.cfop ?? null, tesCode: l.fiscal?.tes.code ?? null, taxes: l.taxes })),
    }
  }

  // O que falta cadastrar antes de vender/faturar (a tela avisa ao abrir o formulário, não só ao salvar).
  @Get('sales/readiness')
  async readiness(@CurrentUser() me: User, @Query() q: ReadinessQuery) {
    this.requireSales(me)
    return this.docs.readiness(this.db, q.companyId)
  }

  @Get('sales-orders')
  list(@CurrentUser() me: User, @Query() q: ListQuery) {
    this.requireSales(me)
    return this.docs.list(this.db, 'order', me, q.status ?? 'todos', q.q)
  }

  @Get('sales-orders/:id')
  get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.docs.load(this.db, 'order', id, me)
  }

  // Pedido direto, sem orçamento.
  @Post('sales-orders')
  async create(@CurrentUser() me: User, @Body() dto: SalesDocDto) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const prep = await this.docs.prepare(tx, dto)
      const row = await one(tx, `INSERT INTO sales_orders (company_id, customer_id, seller_id, operation_type_id, payment_term_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [prep.companyId, dto.customerId, me.id, prep.operation.id, dto.paymentTermId])
      await this.docs.save(tx, 'order', row!.id, dto)
      return this.docs.load(tx, 'order', row!.id, me)
    })
  }

  @Put('sales-orders/:id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalesDocDto) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const order = await this.docs.editable(tx, 'order', id, me)
      if (order.status !== 'aberto') throw new BadRequestException('Pedido faturado ou cancelado não pode ser alterado')
      await this.docs.save(tx, 'order', id, dto)
      return this.docs.load(tx, 'order', id, me)
    })
  }

  @Get('sales-orders/:id/email')
  emailDraft(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.email.draft('order', id, me)
  }

  @Post('sales-orders/:id/email')
  @HttpCode(200)
  sendEmail(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendEmailDto) {
    this.requireSales(me)
    return this.email.send('order', id, me, dto)
  }

  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  async cancelOrder(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const order = await this.docs.editable(tx, 'order', id, me)
      if (order.status === 'faturado') throw new BadRequestException('Pedido faturado: cancele a nota antes')
      if (order.status === 'cancelado') throw new BadRequestException('Pedido já cancelado')
      await tx.query(`UPDATE sales_orders SET status = 'cancelado', updated_at = now() WHERE id = $1`, [id])
      return this.docs.load(tx, 'order', id, me)
    })
  }

  // Fatura o pedido: nota de saída, baixa do estoque (se a TES movimenta) e contas a receber (se gera financeiro).
  @Post('sales-orders/:id/invoice')
  @HttpCode(200)
  async invoice(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'faturamento')
    return this.db.transaction(async (tx) => {
      const order = found(await one(tx, `SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE`, [id]), 'Pedido não encontrado')
      if (order.status !== 'aberto') throw new BadRequestException('Este pedido não pode ser faturado')
      const customer = (await one(tx, `SELECT id, name, uf, taxpayer FROM customers WHERE id = $1`, [order.customer_id]))!
      // Regras fiscais e impostos conferidos de novo na hora de faturar.
      await tx.query(`SELECT id FROM products WHERE id IN (SELECT product_id FROM sales_order_items WHERE order_id = $1) FOR UPDATE`, [id])
      const prep = await this.docs.prepare(tx, await this.docs.dtoFrom(tx, 'order', id))
      const missing = prep.lines.find((l) => !l.fiscal)
      if (missing) throw new BadRequestException(`Sem regra na matriz fiscal para ${missing.sku}`)
      const allowNegative = await this.params.get<boolean>('MV_ESTNEG', tx)
      const short = prep.lines.filter((l) => l.fiscal!.updatesStock && l.stock < l.quantity)
      if (short.length && !allowNegative) {
        throw new BadRequestException(`Estoque insuficiente: ${short.map((l) => `${l.sku} (tem ${l.stock}, pedido ${l.quantity})`).join('; ')}`)
      }

      // Número pela Numeração de notas (série do MV_SERNFE, espécie do MV_ESPECIE), com lock da série.
      const nf = await takeInvoiceNumber(tx, this.params, order.company_id)
      const invoice = (await one(
        tx,
        `INSERT INTO sales_invoices (company_id, series, model, number, order_id, customer_id, operation_type_id, products_total, freight, discount, total, taxes, created_by, cost_center_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, number, series`,
        [order.company_id, nf.series, nf.model, nf.number, id, order.customer_id, order.operation_type_id, prep.totals.products, prep.freight, prep.discount, prep.totals.total, JSON.stringify(prep.totals), me.id, order.cost_center_id],
      ))!
      const reference = `NF ${invoice.number}/${invoice.series}`
      for (const [n, l] of prep.lines.entries()) {
        const r = l.fiscal!
        await tx.query(
          `INSERT INTO sales_invoice_items (invoice_id, item_number, product_id, description, ncm, unit, cfop, tes_id, quantity, unit_price, total, unit_cost, updates_stock, taxes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [invoice.id, n + 1, l.productId, l.name, l.ncm, l.unit, r.cfop, r.tes.id, l.quantity, l.unitPrice, l.total, l.costPrice, r.updatesStock, JSON.stringify(l.taxes)],
        )
        if (r.updatesStock) {
          await tx.query(`UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1`, [l.productId, l.quantity])
          await tx.query(
            `INSERT INTO stock_movements (product_id, quantity, unit_cost, kind, reference, user_id, cost_center_id) VALUES ($1, $2, $3, 'saida_nf', $4, $5, $6)`,
            [l.productId, -l.quantity, l.costPrice, reference, me.id, order.cost_center_id],
          )
        }
      }

      // Contas a receber: valor na nota (com IPI e ST) dos itens cuja TES gera financeiro.
      const receivable = round2(prep.lines.reduce((s, l) => s + (l.fiscal!.generatesFinancial ? l.taxes.total : 0), 0))
      const operation = (await one(tx, `SELECT is_return FROM operation_types WHERE id = $1`, [order.operation_type_id]))!
      if (receivable > 0 && operation.is_return) {
        // Devolução de compra: o fornecedor passa a dever (NDF), abatendo o contas a pagar dele.
        await createTitles(tx, {
          kind: 'P', docType: 'NDF', companyId: order.company_id, supplierId: await this.supplierFromCustomer(tx, order.customer_id),
          categoryId: await categoryByCode(tx, '1.04'), description: `Débito de devolução ${reference} · ${customer.name}`, document: reference,
          issueDate: today(), parcels: [{ amount: receivable, dueDate: today() }], salesInvoiceId: invoice.id, userId: me.id, costCenterId: order.cost_center_id,
          notes: 'NDF: débito do fornecedor. Abate o que você deve a ele ou é recebido em dinheiro.',
        })
      } else if (receivable > 0) {
        const term = (await one(tx, `SELECT days FROM payment_terms WHERE id = $1`, [order.payment_term_id]))!
        const days = termDays(term.days)
        const issue = today()
        const amounts = splitAmount(receivable, days.length || 1)
        await createTitles(tx, {
          kind: 'R', docType: 'NF', companyId: order.company_id, customerId: order.customer_id, categoryId: await categoryByCode(tx, '1.01'),
          description: `Venda ${reference} · ${customer.name}`, document: reference, issueDate: issue,
          parcels: amounts.map((amount, i) => ({ amount, dueDate: addDays(issue, days[i] ?? 0) })), salesInvoiceId: invoice.id, userId: me.id,
          costCenterId: order.cost_center_id,
        })
      }
      await tx.query(`UPDATE sales_orders SET status = 'faturado', updated_at = now() WHERE id = $1`, [id])
      return this.loadInvoice(tx, invoice.id)
    })
  }

  @Get('sales-invoices')
  async invoices(@CurrentUser() me: User, @Query() q: InvoiceListQuery) {
    this.requireSales(me)
    const rows = await this.db.query(
      `SELECT i.id, i.number, i.series, i.issued_at AS "issuedAt", i.total, i.status, i.sefaz_status AS "sefazStatus",
              c.name AS "customerName", c.uf AS "customerUf", co.code AS "companyCode", o.number AS "orderNumber"
       FROM sales_invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id LEFT JOIN sales_orders o ON o.id = i.order_id
       WHERE ($1::date IS NULL OR (i.issued_at AT TIME ZONE 'America/Sao_Paulo')::date >= $1)
         AND ($2::date IS NULL OR (i.issued_at AT TIME ZONE 'America/Sao_Paulo')::date <= $2)
         AND ($3::text IS NULL OR c.name ILIKE '%' || $3 || '%' OR i.number::text = $3)
         AND ($4::uuid IS NULL OR o.seller_id = $4)
       ORDER BY i.issued_at DESC LIMIT 500`,
      [q.from ?? null, q.to ?? null, q.q?.trim() || null, this.onlyOwn(me) ? me.id : null],
    )
    return rows.map((r: any) => ({ ...numbers(r, 'total'), orderCode: r.orderNumber ? code('PV', r.orderNumber) : null }))
  }

  @Get('sales-invoices/:id')
  async getInvoice(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.loadInvoice(this.db, id)
  }

  // Cancelamento: devolve o estoque, cancela os títulos e o pedido volta a "aberto".
  @Post('sales-invoices/:id/cancel')
  @HttpCode(200)
  async cancelInvoice(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    requirePermission(me, 'faturamento')
    return this.db.transaction(async (tx) => {
      const invoice = found(await one(tx, `SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE`, [id]), 'Nota não encontrada')
      if (invoice.status === 'cancelada') throw new BadRequestException('Nota já cancelada')
      const [{ paid }] = await tx.query(`SELECT coalesce(sum(paid_amount), 0) AS paid FROM financial_titles WHERE sales_invoice_id = $1`, [id])
      if (Number(paid) > 0) throw new BadRequestException('A nota tem recebimentos baixados; estorne as baixas no Financeiro antes')
      const reference = `Cancelamento NF ${invoice.number}/${invoice.series}`
      const items = await tx.query(`SELECT product_id, quantity, unit_cost FROM sales_invoice_items WHERE invoice_id = $1 AND updates_stock`, [id])
      for (const item of items) {
        await tx.query(`UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1`, [item.product_id, item.quantity])
        await tx.query(
          `INSERT INTO stock_movements (product_id, quantity, unit_cost, kind, reference, user_id) VALUES ($1, $2, $3, 'cancelamento_nf', $4, $5)`,
          [item.product_id, item.quantity, item.unit_cost, reference, me.id],
        )
      }
      await tx.query(`UPDATE financial_titles SET status = 'cancelado' WHERE sales_invoice_id = $1`, [id])
      await tx.query(`UPDATE sales_invoices SET status = 'cancelada', cancel_reason = $2 WHERE id = $1`, [id, dto.reason.trim()])
      if (invoice.order_id) await tx.query(`UPDATE sales_orders SET status = 'aberto', updated_at = now() WHERE id = $1`, [invoice.order_id])
      return this.loadInvoice(tx, id)
    })
  }

  // ---- auxiliares

  private requireSales(me: User) {
    this.docs.requireSales(me)
  }

  private onlyOwn = (me: User) => this.docs.onlyOwn(me)

  // Devolução de compra: o destinatário é o fornecedor. Acha pelo CNPJ ou cadastra a partir do cliente.
  private async supplierFromCustomer(tx: Tx, customerId: string) {
    const c = (await one(tx, `SELECT document, name, trade_name, email, phone, city, uf FROM customers WHERE id = $1`, [customerId]))!
    const existing = await one(tx, `SELECT id FROM suppliers WHERE cnpj = $1`, [c.document])
    if (existing) return existing.id as string
    const created = await one(
      tx,
      `INSERT INTO suppliers (cnpj, name, trade_name, email, phone, city, uf) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [c.document, c.name, c.trade_name, c.email, c.phone, c.city, c.uf],
    )
    return created!.id as string
  }

  private async loadInvoice(db: Db, id: string) {
    const inv = found(await one(
      db,
      `SELECT i.id, i.number, i.series, i.issued_at AS "issuedAt", i.products_total AS "productsTotal", i.freight, i.discount, i.total, i.status,
              i.sefaz_status AS "sefazStatus", i.cancel_reason AS "cancelReason", i.order_id AS "orderId", o.number AS "orderNumber", i.taxes,
              ot.code || ' · ' || ot.name AS "operationLabel", i.company_id AS "companyId", i.model,
              co.tax_regime AS "taxRegime", co.code || ' · ' || coalesce(co.trade_name, co.name) AS "companyLabel",
              i.cost_center_id AS "costCenterId", (SELECT code || ' · ' || name FROM cost_centers WHERE id = i.cost_center_id) AS "costCenter",
              c.name AS "customerName", c.document AS "customerDocument", c.ie AS "customerIe", c.street AS "customerStreet", c.number AS "customerNumber",
              c.district AS "customerDistrict", c.city AS "customerCity", c.uf AS "customerUf", c.zip AS "customerZip"
       FROM sales_invoices i JOIN customers c ON c.id = i.customer_id JOIN operation_types ot ON ot.id = i.operation_type_id LEFT JOIN sales_orders o ON o.id = i.order_id
       JOIN companies co ON co.id = i.company_id
       WHERE i.id = $1`,
      [id],
    ), 'Nota não encontrada')
    const items = await db.query(
      `SELECT i.item_number AS "itemNumber", p.sku, i.description, i.ncm, i.unit, i.cfop, t.code AS "tesCode", i.quantity, i.unit_price AS "unitPrice", i.total, i.taxes
       FROM sales_invoice_items i JOIN products p ON p.id = i.product_id JOIN tes t ON t.id = i.tes_id WHERE i.invoice_id = $1 ORDER BY i.item_number`,
      [id],
    )
    const titles = await db.query(
      `SELECT id, kind, doc_type AS "docType", installment, installments, due_date::text AS "dueDate", amount, paid_amount AS "paidAmount", status FROM financial_titles WHERE sales_invoice_id = $1 ORDER BY installment`,
      [id],
    )
    return {
      ...numbers(inv, 'productsTotal', 'freight', 'discount', 'total'),
      orderCode: inv.orderNumber ? code('PV', inv.orderNumber) : null,
      items: items.map((i: any) => numbers(i, 'quantity', 'unitPrice', 'total')),
      titles: titles.map((t: any) => numbers(t, 'amount', 'paidAmount')),
    }
  }
}
