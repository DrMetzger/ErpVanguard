import { BadRequestException } from '@nestjs/common'
import { one, type Db } from '../common/db'

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Data (AAAA-MM-DD) de hoje em Brasília.
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMonths(date: string, months: number) {
  const d = new Date(`${date}T12:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

// Divide um total em parcelas; os centavos que sobram vão na última.
export function splitAmount(total: number, parts: number) {
  const base = Math.floor((total * 100) / parts) / 100
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? round2(total - base * (parts - 1)) : base))
}

// "30/60/90" -> [30, 60, 90]
export const termDays = (days: string) => days.split('/').map(Number).filter((n) => Number.isInteger(n) && n >= 0)

export interface NewTitle {
  kind: 'R' | 'P'
  // NF: nota fiscal · NCC: crédito do cliente (devolução de venda) · NDF: débito do fornecedor (devolução de compra) · OUT: manual
  docType?: 'NF' | 'NCC' | 'NDF' | 'OUT'
  companyId: string | null
  customerId?: string | null
  supplierId?: string | null
  categoryId: string | null
  description: string
  document?: string | null
  issueDate: string
  parcels: { dueDate: string; amount: number }[]
  salesInvoiceId?: string | null
  invoiceId?: string | null
  notes?: string | null
  userId: string
}

export async function createTitles(tx: Db, t: NewTitle) {
  const ids: string[] = []
  for (const [i, parcel] of t.parcels.entries()) {
    const row = await one(
      tx,
      `INSERT INTO financial_titles (kind, company_id, customer_id, supplier_id, category_id, description, document, installment, installments,
                                     issue_date, due_date, amount, sales_invoice_id, invoice_id, notes, created_by, doc_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [t.kind, t.companyId, t.customerId ?? null, t.supplierId ?? null, t.categoryId, t.description, t.document ?? null, i + 1, t.parcels.length,
        t.issueDate, parcel.dueDate, parcel.amount, t.salesInvoiceId ?? null, t.invoiceId ?? null, t.notes ?? null, t.userId, t.docType ?? 'OUT'],
    )
    ids.push(row!.id)
  }
  return ids
}

// Título de crédito (NCC/NDF) tem o sinal invertido: NCC é dinheiro que sai, NDF é dinheiro que entra.
// SQL que vale 1 quando o título (alias t) é entrada de dinheiro e -1 quando é saída.
export const CASH_SIGN = (t = 't') => `(CASE WHEN (${t}.kind = 'R') = (${t}.doc_type NOT IN ('NCC', 'NDF')) THEN 1 ELSE -1 END)`
// SQL que vale -1 para títulos de crédito (abatem o saldo do seu lado).
export const BALANCE_SIGN = (t = 't') => `(CASE WHEN ${t}.doc_type IN ('NCC', 'NDF') THEN -1 ELSE 1 END)`

export const categoryByCode = async (db: Db, code: string) => (await one(db, `SELECT id FROM finance_categories WHERE code = $1`, [code]))?.id ?? null

// Valor pago = soma das baixas (valor + desconto − juros). Recalcula a situação.
export async function recalcTitle(tx: Db, id: string) {
  await tx.query(
    `UPDATE financial_titles t SET
       paid_amount = s.principal,
       status = CASE WHEN t.status = 'cancelado' THEN 'cancelado' WHEN s.principal >= t.amount - 0.005 THEN 'pago' WHEN s.principal > 0 THEN 'parcial' ELSE 'aberto' END
     FROM (SELECT coalesce(sum(amount + discount - interest), 0) AS principal FROM financial_payments WHERE title_id = $1) s
     WHERE t.id = $1`,
    [id],
  )
}

export function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${label} inválida`)
}
