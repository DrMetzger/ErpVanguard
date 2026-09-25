import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { resolveFiscal, type FiscalResult } from '../catalog/fiscal'
import { can } from '../common/access'
import { numbers, one, type Db } from '../common/db'
import { round2 } from '../finance/finance.logic'
import { ParametersService } from '../params/parameters.service'
import { code, found } from '../purchasing/purchasing.helpers'
import { SettingsService } from '../settings/settings.service'
import { computeTaxes, loadTaxContext, type ItemTaxes, type TaxTotals } from '../taxes/tax-engine'
import type { User } from '../users/user.entity'

export class ItemDto {
  @IsUUID() productId: string
  @Type(() => Number) @IsNumber() @Min(0.0001, { message: 'Quantidade deve ser maior que zero' }) quantity: number
  // Sem preço: usa a tabela de preço, senão o preço de venda do produto.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPrice?: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) discountPct?: number
}

export class SalesDocDto {
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

export type DocKind = 'quote' | 'order'
export const DOC = {
  quote: { table: 'sales_quotes', items: 'sales_quote_items', fk: 'quote_id', prefix: 'ORC', name: 'Orçamento' },
  order: { table: 'sales_orders', items: 'sales_order_items', fk: 'order_id', prefix: 'PV', name: 'Pedido' },
} as const

export interface PreparedLine {
  productId: string; sku: string; name: string; unit: string; ncm: string | null; stock: number; costPrice: number
  quantity: number; unitPrice: number; discountPct: number; total: number; fiscal: FiscalResult | null; taxes: ItemTaxes
}
export interface Prepared {
  companyId: string; customer: { id: string; name: string; uf: string | null; taxpayer: string }; operation: { id: string; isReturn: boolean }
  paymentTermId: string; priceTableId: string | null; freight: number; discount: number; lines: PreparedLine[]; totals: TaxTotals; warnings: string[]
}

// Regras comuns a orçamento e pedido: preço, TES/CFOP pela matriz fiscal e impostos pela matriz de impostos.
@Injectable()
export class SalesDocsService {
  constructor(private readonly db: DataSource, private readonly settings: SettingsService, private readonly params: ParametersService) {}

  requireSales(me: User) {
    if (!can(me, 'vendedor') && !can(me, 'faturamento')) throw new ForbiddenException('Seu usuário não tem o perfil "vendedor" nem "faturamento"')
  }

  // Vendedor vê só os próprios documentos; faturamento vê todos.
  onlyOwn = (me: User) => !can(me, 'faturamento')

  async prepare(tx: Db, dto: SalesDocDto): Promise<Prepared> {
    const company = dto.companyId
      ? found(await one(tx, `SELECT id FROM companies WHERE id = $1 AND active`, [dto.companyId]), 'Empresa/filial não encontrada')
      : await one(tx, `SELECT id FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    if (!company) throw new BadRequestException('Cadastre a empresa em Cadastros › Empresas antes de vender')
    const customer = found(await one(tx, `SELECT id, name, uf, taxpayer, active FROM customers WHERE id = $1`, [dto.customerId]), 'Cliente não encontrado')
    if (!customer.active) throw new BadRequestException('Cliente inativo')
    const operation = dto.operationTypeId
      ? found(await one(tx, `SELECT id, kind, is_return FROM operation_types WHERE id = $1`, [dto.operationTypeId]), 'Tipo de operação não encontrado')
      : found(await one(tx, `SELECT id, kind, is_return FROM operation_types WHERE code = 'S01'`), 'Cadastre o tipo de operação S01 (venda)')
    if (operation.kind !== 'S') throw new BadRequestException('Use um tipo de operação de saída')
    found(await one(tx, `SELECT id FROM payment_terms WHERE id = $1 AND active`, [dto.paymentTermId]), 'Condição de pagamento não encontrada')
    if (dto.priceTableId) found(await one(tx, `SELECT id FROM price_tables WHERE id = $1 AND active`, [dto.priceTableId]), 'Tabela de preço não encontrada')

    const fallbackUf = (await this.settings.company()).uf
    const lines: Omit<PreparedLine, 'taxes'>[] = []
    const warnings: string[] = []
    for (const item of dto.items) {
      const p = found(await one(tx, `SELECT id, sku, name, unit, ncm, type_id, group_id, origin, stock, cost_price, sale_price, active FROM products WHERE id = $1`, [item.productId]), 'Produto não encontrado')
      if (!p.active) throw new BadRequestException(`Produto inativo: ${p.sku}`)
      let unitPrice = item.unitPrice
      if (unitPrice === undefined) {
        const table = dto.priceTableId ? await one(tx, `SELECT price FROM price_table_items WHERE price_table_id = $1 AND product_id = $2`, [dto.priceTableId, item.productId]) : undefined
        unitPrice = Number(table?.price ?? p.sale_price)
      }
      const discountPct = item.discountPct ?? 0
      const fiscal = await resolveFiscal(tx, { operationTypeId: operation.id, companyId: company.id, uf: customer.uf, taxpayer: customer.taxpayer, productId: p.id }, fallbackUf)
      if (!fiscal) warnings.push(`${p.sku}: sem regra na matriz fiscal (Cadastros › Fiscal)`)
      lines.push({
        productId: p.id, sku: p.sku, name: p.name, unit: p.unit, ncm: p.ncm, stock: Number(p.stock), costPrice: Number(p.cost_price),
        quantity: item.quantity, unitPrice, discountPct, total: round2(item.quantity * unitPrice * (1 - discountPct / 100)), fiscal,
        ...({ _product: p } as any),
      })
    }
    const ctx = await loadTaxContext(tx, this.params, { companyId: company.id, destUf: customer.uf, taxpayer: customer.taxpayer, operationTypeId: operation.id, date: new Date().toISOString().slice(0, 10) })
    const freight = round2(dto.freight ?? 0)
    const discount = round2(dto.discount ?? 0)
    const itemsTotal = lines.reduce((s, l) => s + l.total, 0)
    if (discount > itemsTotal + 0.005) throw new BadRequestException('O desconto é maior que o valor dos itens')
    const taxes = computeTaxes(ctx, lines.map((l, i) => {
      const p = (l as any)._product
      return { key: String(i), productId: p.id, ncm: p.ncm, typeId: p.type_id, groupId: p.group_id, origin: Number(p.origin), cfop: l.fiscal?.cfop ?? null, amount: l.total }
    }), freight, discount)
    return {
      companyId: company.id, customer: { id: customer.id, name: customer.name, uf: customer.uf, taxpayer: customer.taxpayer },
      operation: { id: operation.id, isReturn: !!operation.is_return }, paymentTermId: dto.paymentTermId, priceTableId: dto.priceTableId ?? null,
      freight, discount, totals: taxes.totals, warnings: [...warnings, ...taxes.warnings],
      lines: lines.map((l, i) => { const { _product: _p, ...rest } = l as any; return { ...rest, taxes: taxes.items[i]!.taxes } }),
    }
  }

  async save(tx: Db, kind: DocKind, id: string, dto: SalesDocDto) {
    const d = DOC[kind]
    const prep = await this.prepare(tx, dto)
    await tx.query(`DELETE FROM ${d.items} WHERE ${d.fk} = $1`, [id])
    for (const [position, l] of prep.lines.entries()) {
      await tx.query(
        `INSERT INTO ${d.items} (${d.fk}, product_id, quantity, unit_price, discount_pct, total, tes_id, cfop, taxes, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, l.productId, l.quantity, l.unitPrice, l.discountPct, l.total, l.fiscal?.tes.id ?? null, l.fiscal?.cfop ?? null, JSON.stringify(l.taxes), position],
      )
    }
    await tx.query(
      `UPDATE ${d.table} SET company_id = $2, customer_id = $3, operation_type_id = $4, payment_term_id = $5, price_table_id = $6, valid_until = $7,
              freight = $8, discount = $9, total = $10, taxes = $11, notes = $12, updated_at = now() WHERE id = $1`,
      [id, prep.companyId, prep.customer.id, prep.operation.id, prep.paymentTermId, prep.priceTableId, dto.validUntil ?? null,
        prep.freight, prep.discount, prep.totals.total, JSON.stringify(prep.totals), dto.notes?.trim() || null],
    )
    return prep
  }

  // Monta o DTO a partir de um documento gravado (para copiar orçamento → pedido e recalcular ao faturar).
  async dtoFrom(tx: Db, kind: DocKind, id: string): Promise<SalesDocDto> {
    const d = DOC[kind]
    const h = (await one(tx, `SELECT * FROM ${d.table} WHERE id = $1`, [id]))!
    const items = await tx.query(`SELECT product_id, quantity, unit_price, discount_pct FROM ${d.items} WHERE ${d.fk} = $1 ORDER BY position`, [id])
    return {
      companyId: h.company_id, customerId: h.customer_id, operationTypeId: h.operation_type_id, paymentTermId: h.payment_term_id,
      priceTableId: h.price_table_id ?? undefined, validUntil: h.valid_until ? new Date(h.valid_until).toISOString().slice(0, 10) : undefined,
      freight: Number(h.freight), discount: Number(h.discount), notes: h.notes ?? undefined,
      items: items.map((i: any) => ({ productId: i.product_id, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), discountPct: Number(i.discount_pct) })),
    }
  }

  async load(db: Db, kind: DocKind, id: string, me: User) {
    const d = DOC[kind]
    const doc = found(await one(
      db,
      `SELECT o.id, o.number, o.status, o.total, o.freight, o.discount, o.notes, o.taxes, o.valid_until::text AS "validUntil", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
              o.company_id AS "companyId", co.code || ' · ' || coalesce(co.trade_name, co.name) AS "companyLabel", co.uf AS "companyUf", co.tax_regime AS "taxRegime",
              o.customer_id AS "customerId", c.name AS "customerName", c.document AS "customerDocument", c.uf AS "customerUf", c.taxpayer AS "customerTaxpayer",
              o.seller_id AS "sellerId", u.name AS "sellerName", o.operation_type_id AS "operationTypeId", ot.code || ' · ' || ot.name AS "operationLabel",
              o.payment_term_id AS "paymentTermId", pt.name AS "paymentTerm", pt.days AS "paymentDays", o.price_table_id AS "priceTableId", tb.name AS "priceTable"
              ${kind === 'quote' ? `, o.lost_reason AS "lostReason", o.closed_at AS "closedAt", (SELECT id FROM sales_orders WHERE quote_id = o.id LIMIT 1) AS "orderId",
                 (SELECT number FROM sales_orders WHERE quote_id = o.id LIMIT 1) AS "orderNumber"`
                : `, o.quote_id AS "quoteId", (SELECT number FROM sales_quotes WHERE id = o.quote_id) AS "quoteNumber"`}
       FROM ${d.table} o JOIN companies co ON co.id = o.company_id JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.seller_id
       JOIN operation_types ot ON ot.id = o.operation_type_id JOIN payment_terms pt ON pt.id = o.payment_term_id LEFT JOIN price_tables tb ON tb.id = o.price_table_id
       WHERE o.id = $1`,
      [id],
    ), `${d.name} não encontrado`)
    if (this.onlyOwn(me) && doc.sellerId !== me.id) throw new NotFoundException(`${d.name} não encontrado`)
    const items = await db.query(
      `SELECT i.id, i.product_id AS "productId", p.sku, p.name, p.unit, p.stock, i.quantity, i.unit_price AS "unitPrice", i.discount_pct AS "discountPct", i.total,
              i.cfop, i.taxes, t.code AS "tesCode", t.updates_stock AS "updatesStock"
       FROM ${d.items} i JOIN products p ON p.id = i.product_id LEFT JOIN tes t ON t.id = i.tes_id WHERE i.${d.fk} = $1 ORDER BY i.position`,
      [id],
    )
    const warnings: string[] = []
    const open = doc.status === 'aberto'
    for (const it of items) {
      if (!it.cfop) warnings.push(`${it.sku}: sem regra na matriz fiscal (Cadastros › Fiscal)`)
      else if (kind === 'order' && open && it.updatesStock && Number(it.stock) < Number(it.quantity)) warnings.push(`${it.sku}: estoque ${Number(it.stock)} menor que o pedido (${Number(it.quantity)})`)
    }
    if (kind === 'quote' && open && doc.validUntil && doc.validUntil < new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })) warnings.push('Orçamento vencido: confira preços e validade antes de ganhar')
    const extra: Record<string, unknown> = {}
    if (kind === 'order') {
      const invoice = await one(db, `SELECT id, number, series FROM sales_invoices WHERE order_id = $1 AND status = 'emitida'`, [id])
      extra.invoice = invoice ? { id: invoice.id, label: `NF ${invoice.number}/${invoice.series}` } : null
      extra.quoteCode = doc.quoteNumber ? code('ORC', doc.quoteNumber) : null
    } else {
      extra.orderCode = doc.orderNumber ? code('PV', doc.orderNumber) : null
    }
    return {
      ...numbers(doc, 'total', 'freight', 'discount'), code: code(d.prefix, doc.number), ...extra,
      items: items.map((i: any) => numbers(i, 'stock', 'quantity', 'unitPrice', 'discountPct', 'total')),
      warnings,
    }
  }

  async list(db: Db, kind: DocKind, me: User, status: string, q?: string) {
    const d = DOC[kind]
    const rows = await db.query(
      `SELECT o.id, o.number, o.status, o.total, o.created_at AS "createdAt", o.valid_until::text AS "validUntil",
              c.name AS "customerName", c.uf AS "customerUf", u.name AS "sellerName", co.code AS "companyCode", pt.name AS "paymentTerm",
              ${kind === 'order' ? `(SELECT number FROM sales_invoices WHERE order_id = o.id AND status = 'emitida' LIMIT 1)` : `(SELECT number FROM sales_orders WHERE quote_id = o.id LIMIT 1)`} AS "linkNumber"
       FROM ${d.table} o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.seller_id
       JOIN companies co ON co.id = o.company_id JOIN payment_terms pt ON pt.id = o.payment_term_id
       WHERE ($1 = 'todos' OR o.status = $1) AND ($2::uuid IS NULL OR o.seller_id = $2)
         AND ($3::text IS NULL OR c.name ILIKE '%' || $3 || '%' OR c.document LIKE $3 || '%' OR o.number::text = $3)
       ORDER BY o.number DESC LIMIT 500`,
      [status, this.onlyOwn(me) ? me.id : null, q?.trim() || null],
    )
    return rows.map((r: any) => ({ ...numbers(r, 'total'), code: code(d.prefix, r.number) }))
  }

  async editable(tx: Db, kind: DocKind, id: string, me: User) {
    const d = DOC[kind]
    const doc = found(await one(tx, `SELECT id, status, seller_id FROM ${d.table} WHERE id = $1 FOR UPDATE`, [id]), `${d.name} não encontrado`)
    if (this.onlyOwn(me) && doc.seller_id !== me.id) throw new ForbiddenException(`Este ${d.name.toLowerCase()} é de outro vendedor`)
    return doc
  }
}
