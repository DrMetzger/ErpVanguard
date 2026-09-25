import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { DataSource, type EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { resolveFiscal, type FiscalResult } from '../catalog/fiscal'
import { can, requirePermission } from '../common/access'
import { numbers, one, type Db } from '../common/db'
import { addDays, categoryByCode, createTitles, round2, splitAmount, termDays, today } from '../finance/finance.logic'
import { code, found } from '../purchasing/purchasing.helpers'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'

class ItemDto {
  @IsUUID() productId: string
  @Type(() => Number) @IsNumber() @Min(0.0001, { message: 'Quantidade deve ser maior que zero' }) quantity: number
  // Sem preço: usa a tabela de preço do pedido, senão o preço de venda do produto.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) discountPct?: number
}

class OrderDto {
  @IsOptional() @IsUUID() companyId?: string
  @IsUUID() customerId: string
  @IsOptional() @IsUUID() operationTypeId?: string
  @IsUUID() paymentTermId: string
  @IsOptional() @IsUUID() priceTableId?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freight?: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number
  @IsOptional() @IsString() @MaxLength(2000) notes?: string
  @IsArray() @ArrayMinSize(1, { message: 'Inclua ao menos um item' }) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[]
}

class ListQuery {
  @IsOptional() @IsIn(['orcamento', 'aprovado', 'faturado', 'cancelado', 'todos']) status?: string
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

class CancelDto {
  @IsString() @Length(15, 255, { message: 'Justificativa com pelo menos 15 caracteres (exigência da SEFAZ)' }) reason: string
}

type Tx = EntityManager | DataSource

// Orçamentos, pedidos de venda e notas de saída.
@Controller()
export class SalesController {
  constructor(private readonly db: DataSource, private readonly settings: SettingsService) {}

  // Preço sugerido e saldo em estoque para a tela do pedido.
  @Get('sales/price')
  async price(@CurrentUser() me: User, @Query() q: PriceQuery) {
    this.requireSales(me)
    const product = found(await one(this.db, `SELECT sale_price, stock, unit FROM products WHERE id = $1`, [q.productId]), 'Produto não encontrado')
    const table = q.priceTableId ? await one(this.db, `SELECT price FROM price_table_items WHERE price_table_id = $1 AND product_id = $2`, [q.priceTableId, q.productId]) : undefined
    return { price: Number(table?.price ?? product.sale_price), fromTable: !!table, stock: Number(product.stock), unit: product.unit }
  }

  @Get('sales-orders')
  async list(@CurrentUser() me: User, @Query() q: ListQuery) {
    this.requireSales(me)
    const status = q.status ?? 'todos'
    const rows = await this.db.query(
      `SELECT o.id, o.number, o.status, o.total, o.created_at AS "createdAt", o.valid_until::text AS "validUntil",
              c.name AS "customerName", c.uf AS "customerUf", u.name AS "sellerName", co.code AS "companyCode", pt.name AS "paymentTerm",
              (SELECT count(*)::int FROM sales_order_items WHERE order_id = o.id) AS "itemCount",
              (SELECT number FROM sales_invoices WHERE order_id = o.id AND status = 'emitida' LIMIT 1) AS "invoiceNumber"
       FROM sales_orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.seller_id
       JOIN companies co ON co.id = o.company_id JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE ($1 = 'todos' OR o.status = $1) AND ($2::uuid IS NULL OR o.seller_id = $2)
         AND ($3::text IS NULL OR c.name ILIKE '%' || $3 || '%' OR c.document LIKE $3 || '%' OR o.number::text = $3)
       ORDER BY o.number DESC LIMIT 500`,
      [status, this.onlyOwn(me) ? me.id : null, q.q?.trim() || null],
    )
    return rows.map((r: any) => ({ ...numbers(r, 'total'), code: code('PV', r.number) }))
  }

  @Get('sales-orders/:id')
  async get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.load(this.db, id, me)
  }

  @Post('sales-orders')
  async create(@CurrentUser() me: User, @Body() dto: OrderDto) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const row = await one(tx, `INSERT INTO sales_orders (company_id, customer_id, seller_id, operation_type_id, payment_term_id)
        VALUES ((SELECT id FROM companies LIMIT 1), $1, $2, (SELECT id FROM operation_types LIMIT 1), $3) RETURNING id`, [dto.customerId, me.id, dto.paymentTermId])
      await this.save(tx, row!.id, dto)
      return this.load(tx, row!.id, me)
    }).catch(this.companyMissing)
  }

  @Put('sales-orders/:id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderDto) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const order = await this.editable(tx, id, me)
      if (order.status !== 'orcamento' && order.status !== 'aprovado') throw new BadRequestException('Pedido faturado ou cancelado não pode ser alterado')
      await this.save(tx, id, dto)
      // Mudou o pedido aprovado: volta a ser orçamento para aprovar de novo.
      await tx.query(`UPDATE sales_orders SET status = 'orcamento' WHERE id = $1`, [id])
      return this.load(tx, id, me)
    })
  }

  @Post('sales-orders/:id/approve')
  @HttpCode(200)
  async approve(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const order = await this.editable(tx, id, me)
      if (order.status !== 'orcamento') throw new BadRequestException('Só orçamentos podem ser aprovados')
      const [{ n }] = await tx.query(`SELECT count(*)::int AS n FROM sales_order_items WHERE order_id = $1 AND tes_id IS NULL`, [id])
      if (n) throw new BadRequestException('Há itens sem regra na matriz fiscal (Cadastros › Fiscal)')
      await tx.query(`UPDATE sales_orders SET status = 'aprovado', updated_at = now() WHERE id = $1`, [id])
      return this.load(tx, id, me)
    })
  }

  @Post('sales-orders/:id/cancel')
  @HttpCode(200)
  async cancelOrder(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    this.requireSales(me)
    return this.db.transaction(async (tx) => {
      const order = await this.editable(tx, id, me)
      if (order.status === 'faturado') throw new BadRequestException('Pedido faturado: cancele a nota antes')
      if (order.status === 'cancelado') throw new BadRequestException('Pedido já cancelado')
      await tx.query(`UPDATE sales_orders SET status = 'cancelado', updated_at = now() WHERE id = $1`, [id])
      return this.load(tx, id, me)
    })
  }

  // Fatura o pedido: nota de saída, baixa do estoque (se a TES movimenta) e contas a receber (se gera financeiro).
  @Post('sales-orders/:id/invoice')
  @HttpCode(200)
  async invoice(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'faturamento')
    return this.db.transaction(async (tx) => {
      const order = found(await one(tx, `SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE`, [id]), 'Pedido não encontrado')
      if (order.status !== 'aprovado') throw new BadRequestException(order.status === 'orcamento' ? 'Aprove o orçamento antes de faturar' : 'Este pedido não pode ser faturado')
      const customer = (await one(tx, `SELECT id, name, uf, taxpayer FROM customers WHERE id = $1`, [order.customer_id]))!
      const items = await tx.query(
        `SELECT i.*, p.sku, p.name, p.ncm, p.unit, p.stock, p.cost_price FROM sales_order_items i JOIN products p ON p.id = i.product_id
         WHERE i.order_id = $1 ORDER BY i.position FOR UPDATE OF p`,
        [id],
      )
      // Regras fiscais conferidas de novo na hora de faturar.
      const fallbackUf = (await this.settings.company()).uf
      const resolved: FiscalResult[] = []
      for (const item of items) {
        const r = await resolveFiscal(tx, { operationTypeId: order.operation_type_id, companyId: order.company_id, uf: customer.uf, taxpayer: customer.taxpayer, productId: item.product_id }, fallbackUf)
        if (!r) throw new BadRequestException(`Sem regra na matriz fiscal para ${item.sku}`)
        resolved.push(r)
      }
      const short = items.filter((it: any, i: number) => resolved[i]!.updatesStock && Number(it.stock) < Number(it.quantity))
      if (short.length) {
        throw new BadRequestException(`Estoque insuficiente: ${short.map((it: any) => `${it.sku} (tem ${Number(it.stock)}, pedido ${Number(it.quantity)})`).join('; ')}`)
      }

      await tx.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [order.company_id])
      const [{ next }] = await tx.query(`SELECT coalesce(max(number), 0) + 1 AS next FROM sales_invoices WHERE company_id = $1 AND series = 1`, [order.company_id])
      const productsTotal = round2(items.reduce((s: number, it: any) => s + Number(it.total), 0))
      const invoice = (await one(
        tx,
        `INSERT INTO sales_invoices (company_id, number, order_id, customer_id, operation_type_id, products_total, freight, discount, total, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, number`,
        [order.company_id, next, id, order.customer_id, order.operation_type_id, productsTotal, order.freight, order.discount, order.total, me.id],
      ))!
      const reference = `NF ${invoice.number}/1`
      for (const [n, item] of items.entries()) {
        const r = resolved[n]!
        await tx.query(
          `INSERT INTO sales_invoice_items (invoice_id, item_number, product_id, description, ncm, unit, cfop, tes_id, quantity, unit_price, total, unit_cost, updates_stock)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [invoice.id, n + 1, item.product_id, item.name, item.ncm, item.unit, r.cfop, r.tes.id, item.quantity, item.unit_price, item.total, item.cost_price, r.updatesStock],
        )
        if (r.updatesStock) {
          await tx.query(`UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1`, [item.product_id, item.quantity])
          await tx.query(
            `INSERT INTO stock_movements (product_id, quantity, unit_cost, kind, reference, user_id) VALUES ($1, $2, $3, 'saida_nf', $4, $5)`,
            [item.product_id, -Number(item.quantity), item.cost_price, reference, me.id],
          )
        }
      }

      // Contas a receber proporcionais aos itens que geram financeiro (frete e desconto entram no rateio).
      const financialShare = items.reduce((s: number, it: any, i: number) => s + (resolved[i]!.generatesFinancial ? Number(it.total) : 0), 0)
      const receivable = productsTotal > 0 ? round2(Number(order.total) * (financialShare / productsTotal)) : 0
      const operation = (await one(tx, `SELECT is_return FROM operation_types WHERE id = $1`, [order.operation_type_id]))!
      if (receivable > 0 && operation.is_return) {
        // Devolução de compra: o fornecedor passa a dever (NDF), abatendo o contas a pagar dele.
        await createTitles(tx, {
          kind: 'P', docType: 'NDF', companyId: order.company_id, supplierId: await this.supplierFromCustomer(tx, order.customer_id),
          categoryId: await categoryByCode(tx, '1.04'), description: `Débito de devolução ${reference} · ${customer.name}`, document: reference,
          issueDate: today(), parcels: [{ amount: receivable, dueDate: today() }], salesInvoiceId: invoice.id, userId: me.id,
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

  // Cancelamento: devolve o estoque, cancela os títulos e o pedido volta a "aprovado".
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
      if (invoice.order_id) await tx.query(`UPDATE sales_orders SET status = 'aprovado', updated_at = now() WHERE id = $1`, [invoice.order_id])
      return this.loadInvoice(tx, id)
    })
  }

  // ---- auxiliares

  private requireSales(me: User) {
    if (!can(me, 'vendedor') && !can(me, 'faturamento')) throw new ForbiddenException('Seu usuário não tem o perfil "vendedor" nem "faturamento"')
  }

  // Vendedor vê só os próprios pedidos; faturamento vê todos.
  private onlyOwn = (me: User) => !can(me, 'faturamento')

  private companyMissing = (error: any) => {
    if (error?.column === 'company_id' || /company_id/.test(String(error?.message))) throw new BadRequestException('Cadastre a empresa em Cadastros › Empresas antes de vender')
    throw error
  }

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

  private async editable(tx: Tx, id: string, me: User) {
    const order = found(await one(tx, `SELECT id, status, seller_id FROM sales_orders WHERE id = $1 FOR UPDATE`, [id]), 'Pedido não encontrado')
    if (this.onlyOwn(me) && order.seller_id !== me.id) throw new ForbiddenException('Este pedido é de outro vendedor')
    return order
  }

  private async save(tx: Tx, id: string, dto: OrderDto) {
    const company = dto.companyId
      ? found(await one(tx, `SELECT id FROM companies WHERE id = $1 AND active`, [dto.companyId]), 'Empresa/filial não encontrada')
      : await one(tx, `SELECT id FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    if (!company) throw new BadRequestException('Cadastre a empresa em Cadastros › Empresas antes de vender')
    const customer = found(await one(tx, `SELECT id, uf, taxpayer, active FROM customers WHERE id = $1`, [dto.customerId]), 'Cliente não encontrado')
    if (!customer.active) throw new BadRequestException('Cliente inativo')
    const operation = dto.operationTypeId
      ? found(await one(tx, `SELECT id, kind FROM operation_types WHERE id = $1`, [dto.operationTypeId]), 'Tipo de operação não encontrado')
      : found(await one(tx, `SELECT id, kind FROM operation_types WHERE code = 'S01'`), 'Cadastre o tipo de operação S01 (venda)')
    if (operation.kind !== 'S') throw new BadRequestException('Use um tipo de operação de saída')
    found(await one(tx, `SELECT id FROM payment_terms WHERE id = $1 AND active`, [dto.paymentTermId]), 'Condição de pagamento não encontrada')
    if (dto.priceTableId) found(await one(tx, `SELECT id FROM price_tables WHERE id = $1 AND active`, [dto.priceTableId]), 'Tabela de preço não encontrada')

    await tx.query(`DELETE FROM sales_order_items WHERE order_id = $1`, [id])
    const fallbackUf = (await this.settings.company()).uf
    let itemsTotal = 0
    for (const [position, item] of dto.items.entries()) {
      const product = found(await one(tx, `SELECT id, sale_price, active FROM products WHERE id = $1`, [item.productId]), 'Produto não encontrado')
      if (!product.active) throw new BadRequestException('Há produto inativo no pedido')
      let unitPrice = item.unitPrice
      if (unitPrice === undefined) {
        const table = dto.priceTableId ? await one(tx, `SELECT price FROM price_table_items WHERE price_table_id = $1 AND product_id = $2`, [dto.priceTableId, item.productId]) : undefined
        unitPrice = Number(table?.price ?? product.sale_price)
      }
      const discountPct = item.discountPct ?? 0
      const total = round2(item.quantity * unitPrice * (1 - discountPct / 100))
      itemsTotal += total
      const fiscal = await resolveFiscal(tx, { operationTypeId: operation.id, companyId: company.id, uf: customer.uf, taxpayer: customer.taxpayer, productId: item.productId }, fallbackUf)
      await tx.query(
        `INSERT INTO sales_order_items (order_id, product_id, quantity, unit_price, discount_pct, total, tes_id, cfop, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, item.productId, item.quantity, unitPrice, discountPct, total, fiscal?.tes.id ?? null, fiscal?.cfop ?? null, position],
      )
    }
    const freight = round2(dto.freight ?? 0)
    const discount = round2(dto.discount ?? 0)
    const total = round2(itemsTotal + freight - discount)
    if (total < 0) throw new BadRequestException('O desconto é maior que o pedido')
    await tx.query(
      `UPDATE sales_orders SET company_id = $2, customer_id = $3, operation_type_id = $4, payment_term_id = $5, price_table_id = $6, valid_until = $7,
              freight = $8, discount = $9, total = $10, notes = $11, updated_at = now() WHERE id = $1`,
      [id, company.id, customer.id, operation.id, dto.paymentTermId, dto.priceTableId ?? null, dto.validUntil ?? null, freight, discount, total, dto.notes?.trim() || null],
    )
  }

  private async load(db: Db, id: string, me: User) {
    const order = found(await one(
      db,
      `SELECT o.id, o.number, o.status, o.total, o.freight, o.discount, o.notes, o.valid_until::text AS "validUntil", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
              o.company_id AS "companyId", co.code || ' · ' || coalesce(co.trade_name, co.name) AS "companyLabel", co.uf AS "companyUf",
              o.customer_id AS "customerId", c.name AS "customerName", c.document AS "customerDocument", c.uf AS "customerUf", c.taxpayer AS "customerTaxpayer",
              o.seller_id AS "sellerId", u.name AS "sellerName", o.operation_type_id AS "operationTypeId", ot.code || ' · ' || ot.name AS "operationLabel",
              o.payment_term_id AS "paymentTermId", pt.name AS "paymentTerm", pt.days AS "paymentDays", o.price_table_id AS "priceTableId", tb.name AS "priceTable"
       FROM sales_orders o JOIN companies co ON co.id = o.company_id JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.seller_id
       JOIN operation_types ot ON ot.id = o.operation_type_id JOIN payment_terms pt ON pt.id = o.payment_term_id LEFT JOIN price_tables tb ON tb.id = o.price_table_id
       WHERE o.id = $1`,
      [id],
    ), 'Pedido não encontrado')
    if (this.onlyOwn(me) && order.sellerId !== me.id) throw new NotFoundException('Pedido não encontrado')
    const items = await db.query(
      `SELECT i.id, i.product_id AS "productId", p.sku, p.name, p.unit, p.stock, i.quantity, i.unit_price AS "unitPrice", i.discount_pct AS "discountPct", i.total,
              i.cfop, t.code AS "tesCode", t.updates_stock AS "updatesStock"
       FROM sales_order_items i JOIN products p ON p.id = i.product_id LEFT JOIN tes t ON t.id = i.tes_id WHERE i.order_id = $1 ORDER BY i.position`,
      [id],
    )
    const invoice = await one(db, `SELECT id, number, series FROM sales_invoices WHERE order_id = $1 AND status = 'emitida'`, [id])
    const warnings: string[] = []
    for (const it of items) {
      if (!it.cfop) warnings.push(`${it.sku}: sem regra na matriz fiscal (Cadastros › Fiscal)`)
      else if (it.updatesStock && Number(it.stock) < Number(it.quantity) && order.status !== 'faturado') warnings.push(`${it.sku}: estoque ${Number(it.stock)} menor que o pedido (${Number(it.quantity)})`)
    }
    return {
      ...numbers(order, 'total', 'freight', 'discount'),
      code: code('PV', order.number),
      items: items.map((i: any) => numbers(i, 'stock', 'quantity', 'unitPrice', 'discountPct', 'total')),
      invoice: invoice ? { id: invoice.id, label: `NF ${invoice.number}/${invoice.series}` } : null,
      warnings,
    }
  }

  private async loadInvoice(db: Db, id: string) {
    const inv = found(await one(
      db,
      `SELECT i.id, i.number, i.series, i.issued_at AS "issuedAt", i.products_total AS "productsTotal", i.freight, i.discount, i.total, i.status,
              i.sefaz_status AS "sefazStatus", i.cancel_reason AS "cancelReason", i.order_id AS "orderId", o.number AS "orderNumber",
              ot.code || ' · ' || ot.name AS "operationLabel", i.company_id AS "companyId",
              c.name AS "customerName", c.document AS "customerDocument", c.ie AS "customerIe", c.street AS "customerStreet", c.number AS "customerNumber",
              c.district AS "customerDistrict", c.city AS "customerCity", c.uf AS "customerUf", c.zip AS "customerZip"
       FROM sales_invoices i JOIN customers c ON c.id = i.customer_id JOIN operation_types ot ON ot.id = i.operation_type_id LEFT JOIN sales_orders o ON o.id = i.order_id
       WHERE i.id = $1`,
      [id],
    ), 'Nota não encontrada')
    const items = await db.query(
      `SELECT i.item_number AS "itemNumber", p.sku, i.description, i.ncm, i.unit, i.cfop, t.code AS "tesCode", i.quantity, i.unit_price AS "unitPrice", i.total
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
