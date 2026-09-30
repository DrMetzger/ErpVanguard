import type { Db } from '../common/db'

// Estoque por filial. Toda entrada e saída passa por aqui: saldo e custo médio da filial (product_stock),
// movimento registrado (stock_movements) e o total do produto (products.stock) atualizado pelo gatilho do banco.
// Sem filial (sistema ainda sem empresa cadastrada) mexe direto no saldo do produto, como antes.

export interface Movement {
  productId: string
  companyId: string | null
  quantity: number // + entra, − sai
  kind: 'entrada_nf' | 'devolucao_venda' | 'saida_nf' | 'cancelamento_nf' | 'ajuste'
  reference: string
  userId: string
  costCenterId?: string | null
  unitCost?: number // entrada de compra: custo do item (recalcula o custo médio da filial)
  averageCost?: boolean // true: recalcula o custo médio com unitCost
}

const n4 = (v: number) => Math.round(v * 10000) / 10000

export async function branchStock(db: Db, productId: string, companyId: string | null) {
  if (!companyId) {
    const p = (await db.query(`SELECT stock, cost_price FROM products WHERE id = $1`, [productId]))[0]
    return { quantity: Number(p?.stock ?? 0), avgCost: Number(p?.cost_price ?? 0) }
  }
  const r = (await db.query(`SELECT quantity, avg_cost FROM product_stock WHERE product_id = $1 AND company_id = $2`, [productId, companyId]))[0]
  if (r) return { quantity: Number(r.quantity), avgCost: Number(r.avg_cost) }
  const p = (await db.query(`SELECT cost_price FROM products WHERE id = $1`, [productId]))[0]
  return { quantity: 0, avgCost: Number(p?.cost_price ?? 0) }
}

// Saldos da filial para vários produtos de uma vez (produtos sem linha na filial = 0).
export async function branchStocks(db: Db, productIds: string[], companyId: string | null) {
  const map = new Map<string, { quantity: number; avgCost: number }>()
  if (!companyId || !productIds.length) return map
  const rows = await db.query(`SELECT product_id, quantity, avg_cost FROM product_stock WHERE company_id = $1 AND product_id = ANY($2::uuid[])`, [companyId, productIds])
  for (const r of rows) map.set(r.product_id, { quantity: Number(r.quantity), avgCost: Number(r.avg_cost) })
  return map
}

// Movimenta o estoque (dentro de uma transação). Devolve o custo unitário usado no movimento.
export async function moveStock(tx: Db, m: Movement) {
  let unitCost: number
  if (!m.companyId) {
    const p = (await tx.query(`SELECT stock, cost_price FROM products WHERE id = $1 FOR UPDATE`, [m.productId]))[0]
    const stock = Number(p.stock), cost = Number(p.cost_price)
    unitCost = m.unitCost ?? cost
    const newCost = m.averageCost ? (stock > 0 ? (stock * cost + m.quantity * unitCost) / (stock + m.quantity) : unitCost) : cost
    await tx.query(`UPDATE products SET stock = stock + $2, cost_price = $3, updated_at = now() WHERE id = $1`, [m.productId, m.quantity, n4(newCost)])
  } else {
    await tx.query(
      `INSERT INTO product_stock (product_id, company_id, quantity, avg_cost) SELECT id, $2, 0, cost_price FROM products WHERE id = $1 ON CONFLICT DO NOTHING`,
      [m.productId, m.companyId],
    )
    const s = (await tx.query(`SELECT quantity, avg_cost FROM product_stock WHERE product_id = $1 AND company_id = $2 FOR UPDATE`, [m.productId, m.companyId]))[0]
    const stock = Number(s.quantity), cost = Number(s.avg_cost)
    unitCost = m.unitCost ?? cost
    const newCost = m.averageCost ? (stock > 0 ? (stock * cost + m.quantity * unitCost) / (stock + m.quantity) : unitCost) : cost
    await tx.query(`UPDATE product_stock SET quantity = quantity + $3, avg_cost = $4, updated_at = now() WHERE product_id = $1 AND company_id = $2`, [m.productId, m.companyId, m.quantity, n4(newCost)])
    // O custo do cadastro acompanha a última entrada (referência para preço e simulações).
    if (m.averageCost) await tx.query(`UPDATE products SET cost_price = $2, updated_at = now() WHERE id = $1`, [m.productId, n4(newCost)])
  }
  await tx.query(
    `INSERT INTO stock_movements (product_id, company_id, quantity, unit_cost, kind, reference, user_id, cost_center_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [m.productId, m.companyId, m.quantity, unitCost, m.kind, m.reference, m.userId, m.costCenterId ?? null],
  )
  return unitCost
}
