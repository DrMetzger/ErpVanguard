import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { numbers, one, type Db } from '../common/db'
import type { User } from '../users/user.entity'
import { addDays, addMonths, CASH_SIGN, round2 } from './finance.logic'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/
const LOCAL = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`

// Centro de custo informado num lançamento: precisa existir, estar ativo e ser analítico.
export async function checkCostCenter(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const cc = await one(db, `SELECT type, active FROM cost_centers WHERE id = $1`, [id])
  if (!cc) throw new BadRequestException('Centro de custo não encontrado')
  if (!cc.active) throw new BadRequestException('Centro de custo inativo')
  if (cc.type !== 'A') throw new BadRequestException('Use um centro de custo analítico; o sintético só agrupa')
  return id
}

// O centro e todos os seus filhos (para filtrar por um sintético).
async function withChildren(db: Db, id: string) {
  const [row] = await db.query(
    `WITH RECURSIVE tree AS (SELECT id FROM cost_centers WHERE id = $1 UNION ALL SELECT c.id FROM cost_centers c JOIN tree t ON c.parent_id = t.id)
     SELECT array_agg(id) AS ids FROM tree`,
    [id],
  )
  if (!row?.ids) throw new BadRequestException('Centro de custo não encontrado')
  return row.ids as string[]
}

// ---- DRE
// Linhas de lançamento (vêm dos dados) e de total (somas das anteriores). Valores com sinal: + aumenta o resultado, − reduz.
export const DRE = [
  { code: 'receita', label: 'Receita bruta' },
  { code: 'deducao', label: '(−) Deduções e impostos sobre vendas' },
  { code: 'receita_liquida', label: 'Receita líquida', sum: ['receita', 'deducao'] },
  { code: 'cmv', label: '(−) CMV / CPV' },
  { code: 'lucro_bruto', label: 'Lucro bruto', sum: ['receita_liquida', 'cmv'] },
  { code: 'desp_adm', label: '(−) Despesas administrativas' },
  { code: 'desp_com', label: '(−) Despesas comerciais' },
  { code: 'desp_fin', label: '(−) Despesas financeiras (líquidas)' },
  { code: 'resultado_operacional', label: 'Resultado operacional', sum: ['lucro_bruto', 'desp_adm', 'desp_com', 'desp_fin'] },
  { code: 'outras', label: 'Outras receitas e despesas' },
  { code: 'resultado_antes_ir', label: 'Resultado antes do IR/CSLL', sum: ['resultado_operacional', 'outras'] },
  { code: 'ir_csll', label: '(−) IR e CSLL' },
  { code: 'lucro_liquido', label: 'Lucro líquido', sum: ['resultado_antes_ir', 'ir_csll'] },
] as { code: string; label: string; sum?: string[] }[]

// Movimentos da DRE por mês e linha, por competência (emissão). ccIds nulo = todos os centros.
async function dreRows(db: Db, from: string, to: string, ccIds: string[] | null) {
  const cc = (col: string) => `($3::uuid[] IS NULL OR ${col} = ANY($3))`
  const num = (path: string) => `coalesce((${path})::numeric, 0)`
  const rows: { month: string; line: string; value: string }[] = await db.query(
    `WITH sales AS (
       SELECT to_char(${LOCAL('i.issued_at')}, 'YYYY-MM') AS month,
              it.total - ${num(`it.taxes->>'discount'`)} + ${num(`it.taxes->>'freight'`)} AS revenue,
              ${num(`it.taxes->'icms'->>'value'`)} + ${num(`it.taxes->'fcp'->>'value'`)} + ${num(`it.taxes->'difal'->>'value'`)} + ${num(`it.taxes->'difal'->>'fcpValue'`)}
                + ${num(`it.taxes->'pis'->>'value'`)} + ${num(`it.taxes->'cofins'->>'value'`)} AS taxes,
              it.quantity * it.unit_cost AS cost
       FROM sales_invoices i JOIN sales_invoice_items it ON it.invoice_id = i.id JOIN operation_types o ON o.id = i.operation_type_id JOIN tes ON tes.id = it.tes_id
       WHERE i.status = 'emitida' AND NOT o.is_return AND tes.generates_financial AND ${LOCAL('i.issued_at')} BETWEEN $1 AND $2 AND ${cc('i.cost_center_id')}
     )
     SELECT month, 'receita' AS line, sum(revenue) AS value FROM sales GROUP BY 1
     UNION ALL SELECT month, 'deducao', -sum(taxes) FROM sales GROUP BY 1
     UNION ALL SELECT month, 'cmv', -sum(cost) FROM sales GROUP BY 1
     -- Devolução de venda (nota de entrada com operação de devolução) abate a receita.
     UNION ALL
     SELECT to_char(${LOCAL('coalesce(n.issue_date, n.posted_at)')}, 'YYYY-MM'), 'deducao', -sum(n.total)
     FROM invoices n JOIN operation_types o ON o.id = n.operation_type_id
     WHERE n.status = 'classificada' AND o.is_return AND ${LOCAL('coalesce(n.issue_date, n.posted_at)')} BETWEEN $1 AND $2 AND ${cc('n.cost_center_id')}
     GROUP BY 1
     -- Títulos lançados à mão, pela natureza (linha da DRE do plano de contas). Os de nota já entram acima.
     UNION ALL
     SELECT to_char(t.issue_date, 'YYYY-MM'), fc.dre_line, sum(t.amount * ${CASH_SIGN()})
     FROM financial_titles t JOIN finance_categories fc ON fc.id = t.category_id
     WHERE t.status <> 'cancelado' AND t.sales_invoice_id IS NULL AND t.invoice_id IS NULL AND fc.dre_line IS NOT NULL AND fc.dre_line <> 'fora'
       AND t.issue_date BETWEEN $1 AND $2 AND ${cc('t.cost_center_id')}
     GROUP BY 1, 2
     -- Juros e descontos das baixas: resultado financeiro.
     UNION ALL
     SELECT to_char(p.paid_at, 'YYYY-MM'), 'desp_fin', sum((p.interest - p.discount) * ${CASH_SIGN()})
     FROM financial_payments p JOIN financial_titles t ON t.id = p.title_id
     WHERE (p.interest > 0 OR p.discount > 0) AND p.paid_at BETWEEN $1 AND $2 AND ${cc('t.cost_center_id')}
     GROUP BY 1`,
    [from, to, ccIds],
  )
  const [pending] = await db.query(
    `SELECT count(*)::int AS count, coalesce(sum(t.amount), 0) AS amount
     FROM financial_titles t LEFT JOIN finance_categories fc ON fc.id = t.category_id
     WHERE t.status <> 'cancelado' AND t.sales_invoice_id IS NULL AND t.invoice_id IS NULL AND fc.dre_line IS NULL
       AND t.issue_date BETWEEN $1 AND $2 AND ${cc('t.cost_center_id')}`,
    [from, to, ccIds],
  )
  return { rows: rows.filter((r) => r.value !== null).map((r) => ({ ...r, value: Number(r.value) })), unclassified: numbers(pending, 'amount') }
}

// Soma as linhas de lançamento e calcula as de total.
function dreLines(values: Map<string, number>) {
  const out: Record<string, number> = {}
  for (const l of DRE) out[l.code] = round2(l.sum ? l.sum.reduce((s, c) => s + (out[c] ?? 0), 0) : values.get(l.code) ?? 0)
  return out
}

const monthEnd = (month: string) => addDays(addMonths(`${month}-01`, 1), -1)
function monthsBetween(from: string, to: string) {
  const list: string[] = []
  for (let m = from; m <= to; m = addMonths(`${m}-01`, 1).slice(0, 7)) list.push(m)
  return list
}

class DreQuery {
  @Matches(MONTH, { message: 'Mês inicial inválido (AAAA-MM)' }) from: string
  @Matches(MONTH, { message: 'Mês final inválido (AAAA-MM)' }) to: string
  @IsOptional() @IsUUID() costCenterId?: string
  // Comparar com o período anterior de mesmo tamanho ou com o mesmo período do ano anterior.
  @IsOptional() @IsIn(['nenhum', 'anterior', 'ano']) compare?: string
}

class ReportQuery {
  @Matches(DATE, { message: 'Data inicial inválida' }) from: string
  @Matches(DATE, { message: 'Data final inválida' }) to: string
  // competência: títulos pela emissão · caixa: baixas pela data do pagamento
  @IsOptional() @IsIn(['competencia', 'caixa']) basis?: string
}

class DetailQuery extends ReportQuery {
  // uuid do centro, ou "sem" para os lançamentos sem centro de custo
  @Matches(/^(sem|[0-9a-f-]{36})$/i, { message: 'Centro de custo inválido' }) costCenterId: string
}

// Centros de custo: opções para os lançamentos, relatório por centro e DRE.
@Controller('finance')
export class CostCentersController {
  constructor(private readonly db: DataSource) {}

  // Só analíticos ativos (os que recebem lançamento). Liberado a quem lança pedidos e notas.
  @Get('cost-centers/options')
  options() {
    return this.db.query(`SELECT id AS value, code || ' · ' || name AS label FROM cost_centers WHERE active AND type = 'A' ORDER BY code`)
  }

  @Get('dre')
  async dre(@CurrentUser() me: User, @Query() q: DreQuery) {
    requirePermission(me, 'financeiro')
    if (q.to < q.from) throw new BadRequestException('Período inválido')
    const months = monthsBetween(q.from, q.to)
    if (months.length > 24) throw new BadRequestException('Período máximo de 24 meses')
    const ccIds = q.costCenterId ? await withChildren(this.db, q.costCenterId) : null
    const main = await dreRows(this.db, `${q.from}-01`, monthEnd(q.to), ccIds)

    const byMonth = new Map(months.map((m) => [m, new Map<string, number>()]))
    const all = new Map<string, number>()
    for (const r of main.rows) {
      const m = byMonth.get(r.month)
      if (m) m.set(r.line, (m.get(r.line) ?? 0) + r.value)
      all.set(r.line, (all.get(r.line) ?? 0) + r.value)
    }
    const monthly = months.map((m) => dreLines(byMonth.get(m)!))
    const total = dreLines(all)

    let compare: { from: string; to: string; total: Record<string, number> } | null = null
    if (q.compare && q.compare !== 'nenhum') {
      const shift = q.compare === 'ano' ? -12 : -months.length
      const cFrom = addMonths(`${q.from}-01`, shift).slice(0, 7)
      const cTo = addMonths(`${q.to}-01`, shift).slice(0, 7)
      const other = await dreRows(this.db, `${cFrom}-01`, monthEnd(cTo), ccIds)
      const sums = new Map<string, number>()
      for (const r of other.rows) sums.set(r.line, (sums.get(r.line) ?? 0) + r.value)
      compare = { from: cFrom, to: cTo, total: dreLines(sums) }
    }
    const net = total.receita_liquida || 0
    return {
      from: q.from, to: q.to, months, unclassified: main.unclassified, compare: compare && { from: compare.from, to: compare.to },
      lines: DRE.map((l, i) => ({
        code: l.code, label: l.label, total: !!l.sum, values: monthly.map((m) => m[l.code]), amount: total[l.code],
        // Análise vertical: % da receita líquida
        pct: net ? round2((total[l.code]! / net) * 100) : null,
        compare: compare ? compare.total[l.code] : null,
        index: i,
      })),
    }
  }

  // Receitas, despesas e resultado de cada centro (os sintéticos somam os filhos).
  @Get('cost-center-report')
  async report(@CurrentUser() me: User, @Query() q: ReportQuery) {
    requirePermission(me, 'financeiro')
    if (q.to < q.from) throw new BadRequestException('Período inválido')
    const caixa = q.basis === 'caixa'
    const sums = await this.db.query(
      caixa
        ? `SELECT t.cost_center_id AS id, sum(p.amount) FILTER (WHERE ${CASH_SIGN()} = 1) AS revenue, sum(p.amount) FILTER (WHERE ${CASH_SIGN()} = -1) AS expense, count(*)::int AS count
           FROM financial_payments p JOIN financial_titles t ON t.id = p.title_id WHERE p.paid_at BETWEEN $1 AND $2 GROUP BY 1`
        : `SELECT t.cost_center_id AS id, sum(t.amount) FILTER (WHERE ${CASH_SIGN()} = 1) AS revenue, sum(t.amount) FILTER (WHERE ${CASH_SIGN()} = -1) AS expense, count(*)::int AS count
           FROM financial_titles t WHERE t.status <> 'cancelado' AND t.issue_date BETWEEN $1 AND $2 GROUP BY 1`,
      [q.from, q.to],
    )
    const own = new Map<string | null, { revenue: number; expense: number; count: number }>(
      sums.map((s: any) => [s.id, { revenue: Number(s.revenue ?? 0), expense: Number(s.expense ?? 0), count: s.count }]),
    )
    const centers: { id: string; code: string; name: string; type: string; parentId: string | null; active: boolean }[] = await this.db.query(
      `SELECT id, code, name, type, parent_id AS "parentId", active FROM cost_centers ORDER BY code`,
    )
    const children = new Map<string | null, string[]>()
    for (const c of centers) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id])
    const rolled = new Map<string, { revenue: number; expense: number; count: number }>()
    const roll = (id: string, seen = new Set<string>()): { revenue: number; expense: number; count: number } => {
      if (rolled.has(id)) return rolled.get(id)!
      if (seen.has(id)) return { revenue: 0, expense: 0, count: 0 } // proteção contra ciclo
      seen.add(id)
      const base = { ...(own.get(id) ?? { revenue: 0, expense: 0, count: 0 }) }
      for (const child of children.get(id) ?? []) {
        const c = roll(child, seen)
        base.revenue += c.revenue; base.expense += c.expense; base.count += c.count
      }
      rolled.set(id, base)
      return base
    }
    const level = (c: { parentId: string | null }, depth = 0): number => {
      const parent = c.parentId ? centers.find((x) => x.id === c.parentId) : undefined
      return parent && depth < 10 ? level(parent, depth + 1) + 1 : 0
    }
    const row = (v: { revenue: number; expense: number; count: number }) => ({ revenue: round2(v.revenue), expense: round2(v.expense), result: round2(v.revenue - v.expense), count: v.count })
    const rows = centers
      .map((c) => ({ ...c, level: level(c), ...row(roll(c.id)) }))
      .filter((c) => c.count > 0 || c.active)
    const none = own.get(null) ?? { revenue: 0, expense: 0, count: 0 }
    const total = [...own.values()].reduce((s, v) => ({ revenue: s.revenue + v.revenue, expense: s.expense + v.expense, count: s.count + v.count }), { revenue: 0, expense: 0, count: 0 })
    return { from: q.from, to: q.to, basis: caixa ? 'caixa' : 'competencia', rows, none: row(none), total: row(total) }
  }

  // Lançamentos de um centro (e dos filhos, se sintético) no período.
  @Get('cost-center-report/details')
  async details(@CurrentUser() me: User, @Query() q: DetailQuery) {
    requirePermission(me, 'financeiro')
    const ids = q.costCenterId === 'sem' ? null : await withChildren(this.db, q.costCenterId)
    const filter = ids ? `t.cost_center_id = ANY($3)` : `t.cost_center_id IS NULL AND $3::uuid[] IS NULL`
    const caixa = q.basis === 'caixa'
    const rows = await this.db.query(
      `SELECT t.id, t.kind, t.doc_type AS "docType", t.description, t.document, ${caixa ? 'p.paid_at::text' : 't.issue_date::text'} AS date, t.due_date::text AS "dueDate",
              ${caixa ? 'p.amount' : 't.amount'} * ${CASH_SIGN()} AS amount, t.status, coalesce(c.name, s.name) AS partner,
              fc.code || ' · ' || fc.name AS category, cc.code || ' · ' || cc.name AS "costCenter"
       FROM financial_titles t ${caixa ? 'JOIN financial_payments p ON p.title_id = t.id' : ''}
       LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN suppliers s ON s.id = t.supplier_id
       LEFT JOIN finance_categories fc ON fc.id = t.category_id LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
       WHERE ${caixa ? 'p.paid_at' : 't.issue_date'} BETWEEN $1 AND $2 ${caixa ? '' : `AND t.status <> 'cancelado'`} AND ${filter}
       ORDER BY 6, t.description LIMIT 2000`,
      [q.from, q.to, ids],
    )
    return rows.map((r: any) => numbers(r, 'amount'))
  }
}
