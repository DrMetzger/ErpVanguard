import { BadRequestException } from '@nestjs/common'
import type { Db } from '../common/db'

// Desfaz a nota no sistema: devolve o estoque, cancela os títulos e o pedido volta a "aberto".
// Usado no cancelamento interno e no cancelamento homologado pela SEFAZ.
export async function checkReversible(tx: Db, invoiceId: string) {
  const [{ paid }] = await tx.query(`SELECT coalesce(sum(paid_amount), 0) AS paid FROM financial_titles WHERE sales_invoice_id = $1`, [invoiceId])
  if (Number(paid) > 0) throw new BadRequestException('A nota tem recebimentos baixados; estorne as baixas no Financeiro antes')
}

export async function reverseInvoice(tx: Db, invoice: Record<string, any>, reason: string, userId: string) {
  const reference = `Cancelamento NF ${invoice.number}/${invoice.series}`
  const items = await tx.query(`SELECT product_id, quantity, unit_cost FROM sales_invoice_items WHERE invoice_id = $1 AND updates_stock`, [invoice.id])
  for (const item of items) {
    await tx.query(`UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1`, [item.product_id, item.quantity])
    await tx.query(
      `INSERT INTO stock_movements (product_id, quantity, unit_cost, kind, reference, user_id) VALUES ($1, $2, $3, 'cancelamento_nf', $4, $5)`,
      [item.product_id, item.quantity, item.unit_cost, reference, userId],
    )
  }
  await tx.query(`UPDATE financial_titles SET status = 'cancelado' WHERE sales_invoice_id = $1`, [invoice.id])
  await tx.query(`UPDATE sales_invoices SET status = 'cancelada', cancel_reason = $2 WHERE id = $1`, [invoice.id, reason.trim()])
  if (invoice.order_id) await tx.query(`UPDATE sales_orders SET status = 'aberto', updated_at = now() WHERE id = $1`, [invoice.order_id])
}
