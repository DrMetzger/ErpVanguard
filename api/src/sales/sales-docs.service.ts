import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { resolveFiscal, type FiscalResult } from '../catalog/fiscal'
import { can } from '../common/access'
import { numbers, one, type Db } from '../common/db'
import { checkCostCenter } from '../finance/cost-centers'
import { round2 } from '../finance/finance.logic'
import { ParametersService } from '../params/parameters.service'
import { code, found } from '../purchasing/purchasing.helpers'
import { isValidCnpj } from '../purchasing/documents'
import { SettingsService } from '../settings/settings.service'
import { saleSeries } from './numbering'
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
  @IsOptional() @IsUUID() costCenterId?: string
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
  companyId: string; regime: string; customer: { id: string; name: string; uf: string | null; taxpayer: string }; operation: { id: string; isReturn: boolean }
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
      ? found(await one(tx, `SELECT id, tax_regime FROM companies WHERE id = $1 AND active`, [dto.companyId]), 'Empresa/filial não encontrada')
      : await one(tx, `SELECT id, tax_regime FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    if (!company) throw new BadRequestException('Cadastre a empresa em Administração › Empresas antes de vender')
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
      const p = found(await one(tx, `SELECT id, sku, name, unit, ncm, type_id, group_id, origin, class_trib_id, stock, cost_price, sale_price, active FROM products WHERE id = $1`, [item.productId]), 'Produto não encontrado')
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
      return { key: String(i), productId: p.id, ncm: p.ncm, typeId: p.type_id, groupId: p.group_id, origin: Number(p.origin), cfop: l.fiscal?.cfop ?? null, amount: l.total, tesId: l.fiscal?.tes.id ?? null, classTribId: p.class_trib_id }
    }), freight, discount)
    return {
      companyId: company.id, regime: company.tax_regime, customer: { id: customer.id, name: customer.name, uf: customer.uf, taxpayer: customer.taxpayer },
      operation: { id: operation.id, isReturn: !!operation.is_return }, paymentTermId: dto.paymentTermId, priceTableId: dto.priceTableId ?? null,
      freight, discount, totals: taxes.totals, warnings: [...warnings, ...taxes.warnings],
      lines: lines.map((l, i) => { const { _product: _p, ...rest } = l as any; return { ...rest, taxes: taxes.items[i]!.taxes } }),
    }
  }

  // Pré-requisitos da venda: empresa com regime, CNPJ, IE e endereço; tipo de operação S01; série da NF-e.
  // "blocking" impede salvar o documento; o resto é aviso (a nota vai precisar para ser transmitida).
  async readiness(db: Db, companyId?: string) {
    const issues: { key: string; message: string; blocking: boolean; link: string }[] = []
    const EMPRESAS = '/empresas'
    const PARAMS = '/parametros'
    const company = await one(
      db,
      `SELECT id, code, name, trade_name, document, ie, tax_regime, street, number, district, city, zip, uf, is_head FROM companies
       WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`,
      [companyId ?? null],
    )
    if (!company) {
      issues.push({ key: 'company', message: 'Nenhuma empresa cadastrada: cadastre a matriz (CNPJ, regime tributário, IE e endereço) antes de vender', blocking: true, link: EMPRESAS })
    } else {
      const who = `${company.code} · ${company.trade_name || company.name}`
      if (!company.tax_regime) issues.push({ key: 'taxRegime', message: `${who}: informe o regime tributário`, blocking: true, link: EMPRESAS })
      if (!isValidCnpj(company.document ?? '')) issues.push({ key: 'cnpj', message: `${who}: CNPJ inválido`, blocking: false, link: EMPRESAS })
      if (!company.ie) issues.push({ key: 'ie', message: `${who}: falta a inscrição estadual (IE)`, blocking: false, link: EMPRESAS })
      const address = (['street', 'number', 'district', 'city', 'zip'] as const).filter((k) => !company[k])
      const names = { street: 'endereço', number: 'número', district: 'bairro', city: 'cidade', zip: 'CEP' }
      if (address.length) issues.push({ key: 'address', message: `${who}: endereço incompleto (${address.map((k) => names[k]).join(', ')})`, blocking: false, link: EMPRESAS })
    }
    if (!(await one(db, `SELECT 1 FROM operation_types WHERE code = 'S01'`))) issues.push({ key: 'operation', message: 'Cadastre o tipo de operação S01 (venda) em Cadastros › Fiscal', blocking: true, link: '/cadastros/fiscal/operacoes' })
    const { series, model } = await saleSeries(db, this.params)
    let numbering: { series: number; model: string | null; nextNumber: number | null } = { series, model, nextNumber: null }
    if (!model) issues.push({ key: 'series', message: `A série ${series} da NF-e (MV_SERNFE) não está no parâmetro MV_ESPECIE`, blocking: false, link: PARAMS })
    else if (model !== '55') issues.push({ key: 'series', message: `A série ${series} (MV_SERNFE) é de NFC-e; a venda por pedido emite NF-e (SPED)`, blocking: false, link: PARAMS })
    if (company) {
      const row = await one(db, `SELECT next_number, active FROM invoice_numbering WHERE company_id = $1 AND series = $2`, [company.id, series])
      const next = row ? Number(row.next_number) : Number((await one(db, `SELECT coalesce(max(number), 0) + 1 AS n FROM sales_invoices WHERE company_id = $1 AND series = $2`, [company.id, series]))!.n)
      numbering = { series, model, nextNumber: next }
      if (row && !row.active) issues.push({ key: 'series', message: `A série ${series} está inativa em Numeração de notas`, blocking: false, link: '/parametros' })
    }
    return {
      ready: !issues.some((i) => i.blocking), complete: issues.length === 0, issues,
      company: company ? { id: company.id, label: `${company.code} · ${company.trade_name || company.name}`, regime: company.tax_regime, uf: company.uf } : null,
      numbering,
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
    // Centro de custo: vai para a nota e para os títulos ao faturar.
    await tx.query(`UPDATE ${d.table} SET cost_center_id = $2 WHERE id = $1`, [id, await checkCostCenter(tx, dto.costCenterId)])
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
      freight: Number(h.freight), discount: Number(h.discount), notes: h.notes ?? undefined, costCenterId: h.cost_center_id ?? undefined,
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
              o.payment_term_id AS "paymentTermId", pt.name AS "paymentTerm", pt.days AS "paymentDays", o.price_table_id AS "priceTableId", tb.name AS "priceTable",
              o.cost_center_id AS "costCenterId", (SELECT code || ' · ' || name FROM cost_centers WHERE id = o.cost_center_id) AS "costCenter"
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
    // Histórico de envio por e-mail ao cliente.
    extra.emails = await db.query(
      `SELECT e.id, e.to_addr AS "to", e.cc, e.status, e.error, e.created_at AS "sentAt", u.name AS "userName"
       FROM sales_doc_emails e JOIN users u ON u.id = e.user_id WHERE e.doc_kind = $1 AND e.doc_id = $2 ORDER BY e.created_at DESC LIMIT 20`,
      [kind, id],
    )
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
