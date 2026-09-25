import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import { IsOptional, IsUUID, Matches } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { numbers } from '../common/db'
import { addMonths, round2, today } from '../finance/finance.logic'
import type { User } from '../users/user.entity'

class Period {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
  @IsOptional() @IsUUID() companyId?: string
}

const BR = `AT TIME ZONE 'America/Sao_Paulo'`
const pct = (part: number, whole: number) => (whole ? round2((part / whole) * 100) : 0)

// BI: vendas, margem, compras, financeiro e estoque. Datas pelo horário de Brasília.
@Controller('bi')
export class BiController {
  constructor(private readonly db: DataSource) {}

  @Get('overview')
  async overview(@CurrentUser() me: User, @Query() q: Period) {
    requirePermission(me, 'bi')
    const to = q.to ?? today()
    const from = q.from ?? `${addMonths(to, -11).slice(0, 7)}-01`
    if (from > to) throw new BadRequestException('Período inválido')
    const company = q.companyId ?? null
    const args = [from, to, company]
    // Itens das notas de saída emitidas no período
    const salesItems = `
      FROM sales_invoice_items ii JOIN sales_invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'emitida' AND (i.issued_at ${BR})::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR i.company_id = $3)`

    const [sales] = await this.db.query(
      `SELECT coalesce(sum(total), 0) AS revenue, count(*)::int AS invoices,
              coalesce((SELECT sum(ii.quantity * ii.unit_cost) ${salesItems}), 0) AS cost,
              coalesce((SELECT sum(ii.total) ${salesItems}), 0) AS "productsRevenue",
              count(DISTINCT customer_id)::int AS customers
       FROM sales_invoices i WHERE i.status = 'emitida' AND (i.issued_at ${BR})::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR i.company_id = $3)`,
      args,
    )
    const [purchases] = await this.db.query(
      `SELECT coalesce(sum(total), 0) AS total, count(*)::int AS invoices FROM invoices
       WHERE status = 'lancada' AND (posted_at ${BR})::date BETWEEN $1 AND $2`,
      [from, to],
    )
    const [fin] = await this.db.query(
      `SELECT coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'R'), 0) AS receivable,
              coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'R' AND due_date < (now() ${BR})::date), 0) AS "receivableOverdue",
              coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'P'), 0) AS payable,
              coalesce(sum(amount - paid_amount) FILTER (WHERE kind = 'P' AND due_date < (now() ${BR})::date), 0) AS "payableOverdue"
       FROM financial_titles WHERE status IN ('aberto', 'parcial') AND ($1::uuid IS NULL OR company_id = $1)`,
      [company],
    )
    const [stock] = await this.db.query(
      `SELECT coalesce(sum(stock * cost_price) FILTER (WHERE stock > 0), 0) AS value, count(*) FILTER (WHERE stock < min_stock AND active)::int AS "belowMin",
              count(*) FILTER (WHERE active)::int AS products
       FROM products`,
    )

    // Mês a mês
    const monthly = await this.db.query(
      `WITH months AS (SELECT to_char(m, 'YYYY-MM') AS month FROM generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month') m),
       s AS (SELECT to_char(i.issued_at ${BR}, 'YYYY-MM') AS month, sum(i.total) AS revenue FROM sales_invoices i
             WHERE i.status = 'emitida' AND (i.issued_at ${BR})::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR i.company_id = $3) GROUP BY 1),
       c AS (SELECT to_char(i.issued_at ${BR}, 'YYYY-MM') AS month, sum(ii.quantity * ii.unit_cost) AS cost ${salesItems} GROUP BY 1),
       p AS (SELECT to_char(posted_at ${BR}, 'YYYY-MM') AS month, sum(total) AS purchases FROM invoices
             WHERE status = 'lancada' AND (posted_at ${BR})::date BETWEEN $1 AND $2 GROUP BY 1),
       f AS (SELECT to_char(pay.paid_at, 'YYYY-MM') AS month, sum(pay.amount) FILTER (WHERE t.kind = 'R') AS received, sum(pay.amount) FILTER (WHERE t.kind = 'P') AS paid
             FROM financial_payments pay JOIN financial_titles t ON t.id = pay.title_id
             WHERE pay.paid_at BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR t.company_id = $3) GROUP BY 1)
       SELECT months.month, coalesce(s.revenue, 0) AS revenue, coalesce(c.cost, 0) AS cost, coalesce(p.purchases, 0) AS purchases,
              coalesce(f.received, 0) AS received, coalesce(f.paid, 0) AS paid
       FROM months LEFT JOIN s USING (month) LEFT JOIN c USING (month) LEFT JOIN p USING (month) LEFT JOIN f USING (month) ORDER BY 1`,
      args,
    )

    // Produtos (com curva ABC pelo faturamento)
    const products = (await this.db.query(
      `SELECT p.id, p.sku, p.name, sum(ii.quantity) AS quantity, sum(ii.total) AS revenue, sum(ii.total - ii.quantity * ii.unit_cost) AS margin
       ${salesItems.replace('FROM sales_invoice_items ii', 'FROM sales_invoice_items ii JOIN products p ON p.id = ii.product_id')}
       GROUP BY p.id ORDER BY revenue DESC`,
      args,
    )).map((r: any) => numbers(r, 'quantity', 'revenue', 'margin'))
    const productsRevenue = products.reduce((s: number, p: any) => s + p.revenue, 0)
    let running = 0
    const abc = { A: { count: 0, revenue: 0 }, B: { count: 0, revenue: 0 }, C: { count: 0, revenue: 0 } }
    for (const p of products) {
      running += p.revenue
      const share = productsRevenue ? running / productsRevenue : 1
      p.curve = share <= 0.8 || p === products[0] ? 'A' : share <= 0.95 ? 'B' : 'C'
      p.marginPct = pct(p.margin, p.revenue)
      abc[p.curve as 'A' | 'B' | 'C'].count++
      abc[p.curve as 'A' | 'B' | 'C'].revenue += p.revenue
    }

    const group = async (label: string, joins: string, key: string) =>
      (await this.db.query(
        `SELECT ${key} AS label, sum(i.total) AS revenue, count(*)::int AS invoices FROM sales_invoices i ${joins}
         WHERE i.status = 'emitida' AND (i.issued_at ${BR})::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR i.company_id = $3)
         GROUP BY 1 ORDER BY 2 DESC LIMIT ${label === 'uf' ? 27 : 10}`,
        args,
      )).map((r: any) => numbers(r, 'revenue'))

    const revenue = Number(sales.revenue)
    const cost = Number(sales.cost)
    const productsRevenueTotal = Number(sales.productsRevenue)
    return {
      period: { from, to },
      kpis: {
        revenue, invoices: sales.invoices, averageTicket: sales.invoices ? round2(revenue / sales.invoices) : 0, customers: sales.customers,
        grossMargin: round2(productsRevenueTotal - cost), grossMarginPct: pct(productsRevenueTotal - cost, productsRevenueTotal),
        purchases: Number(purchases.total), purchaseInvoices: purchases.invoices,
        ...numbers(fin, 'receivable', 'receivableOverdue', 'payable', 'payableOverdue'),
        stockValue: round2(Number(stock.value)), productsBelowMin: stock.belowMin, activeProducts: stock.products,
      },
      monthly: monthly.map((m: any) => {
        const row = numbers(m, 'revenue', 'cost', 'purchases', 'received', 'paid')
        return { ...row, margin: round2(row.revenue - row.cost) }
      }),
      topProducts: products.slice(0, 10),
      abc: Object.entries(abc).map(([curve, v]) => ({ curve, count: v.count, revenue: round2(v.revenue), share: pct(v.revenue, productsRevenue) })),
      topCustomers: await group('customer', 'JOIN customers c ON c.id = i.customer_id', 'c.name'),
      byUf: await group('uf', 'JOIN customers c ON c.id = i.customer_id', "coalesce(c.uf, '—')"),
      bySeller: await group('seller', 'JOIN sales_orders o ON o.id = i.order_id JOIN users u ON u.id = o.seller_id', 'u.name'),
    }
  }
}
