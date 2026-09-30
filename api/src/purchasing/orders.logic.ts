import { EntityManager } from 'typeorm'
import { numbers, one } from '../common/db'
import { requiredLevels } from './approval'

export interface NewOrderItem {
  requestItemId: string | null
  productId: string | null
  description: string
  unit: string
  quantity: number
  unitPrice: number
}

export interface NewOrder {
  supplierId: string
  purchaseGroupId: string
  quotationId: string | null
  buyerId: string
  companyId?: string | null // filial do pedido (a da cotação)
  paymentTerms: string | null
  deliveryDays: number | null
  freight: number
  items: NewOrderItem[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Cria o pedido e define a alçada pelo grupo de aprovação do grupo de compras.
// Sem grupo de aprovação configurado, o pedido já nasce aprovado.
export async function createOrder(tx: EntityManager, order: NewOrder) {
  const total = round2(order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) + order.freight)

  const levels = await tx.query(
    `SELECT l.level, l.limit_amount AS "limitAmount"
     FROM purchase_groups g JOIN approval_levels l ON l.group_id = g.approval_group_id
     WHERE g.id = $1`,
    [order.purchaseGroupId],
  )
  const required = requiredLevels(levels.map((l: any) => numbers(l, 'limitAmount')), total)
  const status = required.length ? 'aguardando_aprovacao' : 'aprovado'

  const { id, number } = (await one(
    tx,
    `INSERT INTO purchase_orders (supplier_id, purchase_group_id, quotation_id, buyer_id, status, payment_terms, delivery_days, freight, total, required_levels, company_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, number`,
    [order.supplierId, order.purchaseGroupId, order.quotationId, order.buyerId, status, order.paymentTerms, order.deliveryDays, order.freight, total, required, order.companyId ?? null],
  ))!
  for (const item of order.items) {
    await tx.query(
      `INSERT INTO purchase_order_items (order_id, request_item_id, product_id, description, unit, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, item.requestItemId, item.productId, item.description, item.unit, item.quantity, item.unitPrice],
    )
  }
  return { id, number, total, status }
}
