import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, ServiceUnavailableException,
} from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator'
import { DataSource, EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { digits, numbers, one } from '../common/db'
import type { User } from '../users/user.entity'
import { isValidDocument } from './documents'
import { aiEnabled, matchWithGemini } from './gemini'
import { parseNfe } from './nfe'
import { code, found } from './purchasing.helpers'
import { similarity } from './similarity'

class ImportDto {
  @IsString() @MaxLength(5_000_000) xml: string
}

class ItemMatchDto {
  @IsUUID() id: string
  @IsOptional() @IsUUID() productId?: string | null
  @IsOptional() @IsUUID() orderItemId?: string | null
}

class UpdateInvoiceDto {
  @IsOptional() @IsUUID() purchaseOrderId?: string | null
  @IsArray() @ValidateNested({ each: true }) @Type(() => ItemMatchDto) items: ItemMatchDto[]
}

type Tx = DataSource | EntityManager
const RECEIVABLE = ['aprovado', 'recebido_parcial']

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentUser() me: User) {
    requirePermission(me, 'comprador')
    return (
      await this.db.query(
        `SELECT i.id, i.number, i.series, i.issue_date AS "issueDate", i.total, i.status, i.created_at AS "createdAt",
                s.name AS "supplierName", o.number AS "orderNumber"
         FROM invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
         ORDER BY i.created_at DESC LIMIT 300`,
      )
    ).map((r: any) => ({ ...numbers(r, 'total'), orderCode: r.orderNumber ? code('PC', r.orderNumber) : null }))
  }

  @Get(':id')
  get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'comprador')
    return this.load(this.db, id)
  }

  // Lê o XML, cadastra o fornecedor se preciso, encontra o pedido e amarra os itens.
  @Post('import')
  async import(@CurrentUser() me: User, @Body() dto: ImportDto) {
    requirePermission(me, 'comprador')
    const nfe = parseNfe(dto.xml)
    const existing = await one(this.db, `SELECT id FROM invoices WHERE access_key = $1`, [nfe.accessKey])
    if (existing) throw new ConflictException({ message: 'Esta nota já foi importada', invoiceId: existing.id })

    const cnpj = digits(nfe.supplier.cnpj)
    if (!isValidDocument(cnpj)) throw new BadRequestException('CNPJ do emitente inválido no XML')

    return this.db.transaction(async (tx) => {
      let supplier = await one(tx, `SELECT id FROM suppliers WHERE cnpj = $1`, [cnpj])
      if (!supplier) {
        const s = nfe.supplier
        supplier = await one(
          tx,
          `INSERT INTO suppliers (cnpj, name, trade_name, email, phone, city, uf) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [cnpj, s.name, s.tradeName, s.email, s.phone, s.city, s.uf],
        )
      }

      // Pedido informado pelo fornecedor (xPed), se for dele e estiver aprovado.
      let orderId: string | null = null
      const orderNumber = Number(digits(nfe.orderNumber))
      if (orderNumber) {
        const order = await one(tx, `SELECT id, status FROM purchase_orders WHERE number = $1 AND supplier_id = $2`, [orderNumber, supplier!.id])
        if (order && RECEIVABLE.includes(order.status)) orderId = order.id
      }

      const { id } = (await one(
        tx,
        `INSERT INTO invoices (access_key, number, series, issue_date, supplier_id, purchase_order_id, total, xml, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [nfe.accessKey, nfe.number, nfe.series, nfe.issueDate, supplier!.id, orderId, nfe.total, dto.xml, me.id],
      ))!
      for (const item of nfe.items) {
        await tx.query(
          `INSERT INTO invoice_items (invoice_id, item_number, supplier_code, ean, description, ncm, cfop, unit, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, item.itemNumber, item.supplierCode, item.ean, item.description, item.ncm, item.cfop, item.unit, item.quantity, item.unitPrice, item.total],
        )
      }
      await this.autoMatch(tx, id)
      return this.load(tx, id)
    })
  }

  // Ajustes manuais do comprador (produto e item do pedido de cada linha).
  @Put(':id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    requirePermission(me, 'comprador')
    return this.db.transaction(async (tx) => {
      const invoice = await this.pending(tx, id)
      if (dto.purchaseOrderId !== undefined) {
        if (dto.purchaseOrderId) {
          const order = found(await one(tx, `SELECT supplier_id, status FROM purchase_orders WHERE id = $1`, [dto.purchaseOrderId]), 'Pedido não encontrado')
          if (order.supplier_id !== invoice.supplier_id) throw new BadRequestException('O pedido é de outro fornecedor')
          if (!RECEIVABLE.includes(order.status)) throw new BadRequestException('Só pedidos aprovados podem receber nota')
        }
        if (dto.purchaseOrderId !== invoice.purchase_order_id) {
          await tx.query(`UPDATE invoices SET purchase_order_id = $2 WHERE id = $1`, [id, dto.purchaseOrderId])
          await tx.query(`UPDATE invoice_items SET order_item_id = NULL WHERE invoice_id = $1`, [id])
        }
      }
      for (const item of dto.items) {
        const sets: string[] = []
        const params: unknown[] = [item.id, id]
        if (item.productId !== undefined) {
          params.push(item.productId)
          sets.push(`product_id = $${params.length}, match_source = CASE WHEN $${params.length}::uuid IS NULL THEN NULL ELSE 'manual' END, match_note = NULL`)
        }
        if (item.orderItemId !== undefined) {
          params.push(item.orderItemId)
          sets.push(`order_item_id = $${params.length}`)
        }
        if (!sets.length) continue
        found(await one(tx, `UPDATE invoice_items SET ${sets.join(', ')} WHERE id = $1 AND invoice_id = $2 RETURNING 1`, params), 'Item não pertence a esta nota')
      }
      await this.autoMatch(tx, id)
      return this.load(tx, id)
    })
  }

  // Usa o Gemini para amarrar os itens que a regra automática não conseguiu.
  @Post(':id/ai-match')
  async aiMatch(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'comprador')
    if (!aiEnabled()) throw new ServiceUnavailableException('A IA ainda não foi configurada (GEMINI_API_KEY)')
    await this.pending(this.db, id)

    const items = await this.db.query(
      `SELECT item_number AS "itemNumber", description, supplier_code AS "supplierCode", ean, ncm, unit
       FROM invoice_items WHERE invoice_id = $1 AND product_id IS NULL ORDER BY item_number`,
      [id],
    )
    if (!items.length) return this.load(this.db, id)

    // Candidatos: produtos mais parecidos com cada item + produtos do pedido.
    const products = await this.db.query(`SELECT id, sku, name, ncm, unit FROM products WHERE active`)
    const orderProducts = await this.db.query(
      `SELECT DISTINCT oi.product_id FROM purchase_order_items oi JOIN invoices i ON i.purchase_order_id = oi.order_id WHERE i.id = $1`,
      [id],
    )
    const picked = new Set<string>(orderProducts.map((r: any) => r.product_id).filter(Boolean))
    for (const item of items) {
      products
        .map((p: any) => ({ id: p.id, score: similarity(item.description, p.name) + (item.ncm && item.ncm === p.ncm ? 0.3 : 0) }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 25)
        .forEach((p: any) => picked.add(p.id))
    }
    const candidates = products.filter((p: any) => picked.has(p.id)).slice(0, 200)

    let matches
    try {
      matches = await matchWithGemini(items, candidates)
    } catch (error: any) {
      throw new ServiceUnavailableException(error.message)
    }
    await this.db.transaction(async (tx) => {
      for (const m of matches) {
        if (!m.productId || m.confidence < 0.5) continue
        await tx.query(
          `UPDATE invoice_items SET product_id = $3, match_source = 'ia', match_note = $4
           WHERE invoice_id = $1 AND item_number = $2 AND product_id IS NULL`,
          [id, m.itemNumber, m.productId, `${Math.round(m.confidence * 100)}% · ${m.reason}`],
        )
      }
      await this.autoMatch(tx, id)
    })
    return this.load(this.db, id)
  }

  // Lança a nota: entrada no estoque, custo médio, baixa no pedido e amarração produto x fornecedor.
  @Post(':id/post')
  async post(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'comprador')
    return this.db.transaction(async (tx) => {
      const invoice = await this.pending(tx, id)
      const items = await tx.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY item_number`, [id])
      const missing = items.filter((i: any) => !i.product_id)
      if (missing.length) throw new BadRequestException(`Faltam produtos para os itens: ${missing.map((i: any) => i.item_number).join(', ')}`)

      if (invoice.purchase_order_id) {
        const order = found(await one(tx, `SELECT status FROM purchase_orders WHERE id = $1 FOR UPDATE`, [invoice.purchase_order_id]), 'Pedido não encontrado')
        if (!RECEIVABLE.includes(order.status)) throw new BadRequestException('O pedido vinculado não está aprovado')
      }

      const reference = `NF ${invoice.number}${invoice.series ? `/${invoice.series}` : ''}`
      for (const item of items) {
        const qty = Number(item.quantity)
        const unitCost = qty > 0 ? Number(item.total) / qty : Number(item.unit_price)
        const product = (await one(tx, `SELECT stock, cost_price FROM products WHERE id = $1 FOR UPDATE`, [item.product_id]))!
        const stock = Number(product.stock)
        const cost = Number(product.cost_price)
        const newCost = stock > 0 ? (stock * cost + qty * unitCost) / (stock + qty) : unitCost
        await tx.query(`UPDATE products SET stock = stock + $2, cost_price = $3, updated_at = now() WHERE id = $1`, [item.product_id, qty, newCost])
        await tx.query(
          `INSERT INTO stock_movements (product_id, quantity, unit_cost, kind, reference, user_id) VALUES ($1, $2, $3, 'entrada_nf', $4, $5)`,
          [item.product_id, qty, unitCost, reference, me.id],
        )
        if (item.supplier_code) {
          await tx.query(
            `INSERT INTO supplier_products (supplier_id, supplier_code, product_id) VALUES ($1, $2, $3)
             ON CONFLICT (supplier_id, supplier_code) DO UPDATE SET product_id = EXCLUDED.product_id`,
            [invoice.supplier_id, item.supplier_code, item.product_id],
          )
        }
        if (item.order_item_id) {
          await tx.query(`UPDATE purchase_order_items SET received_quantity = received_quantity + $2 WHERE id = $1`, [item.order_item_id, qty])
        }
      }
      if (invoice.purchase_order_id) {
        await tx.query(
          `UPDATE purchase_orders SET status = CASE
             WHEN (SELECT bool_and(received_quantity >= quantity) FROM purchase_order_items WHERE order_id = $1) THEN 'recebido'
             ELSE 'recebido_parcial' END
           WHERE id = $1`,
          [invoice.purchase_order_id],
        )
      }
      await tx.query(`UPDATE invoices SET status = 'lancada', posted_at = now() WHERE id = $1`, [id])
      return this.load(tx, id)
    })
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'comprador')
    await this.pending(this.db, id)
    await this.db.query(`DELETE FROM invoices WHERE id = $1`, [id])
  }

  private async pending(tx: Tx, id: string) {
    const invoice = found(await one(tx, `SELECT * FROM invoices WHERE id = $1`, [id]), 'Nota não encontrada')
    if (invoice.status !== 'pendente') throw new BadRequestException('Esta nota já foi lançada')
    return invoice
  }

  // Amarração automática, sem IA: código do fornecedor já conhecido, código de
  // barras e descrição parecida com um item do pedido. Depois liga ao item do pedido.
  private async autoMatch(tx: Tx, invoiceId: string) {
    const invoice = (await one(tx, `SELECT supplier_id, purchase_order_id FROM invoices WHERE id = $1`, [invoiceId]))!
    await tx.query(
      `UPDATE invoice_items ii SET product_id = sp.product_id, match_source = 'amarracao', match_note = NULL
       FROM supplier_products sp
       WHERE ii.invoice_id = $1 AND ii.product_id IS NULL AND sp.supplier_id = $2 AND sp.supplier_code = ii.supplier_code`,
      [invoiceId, invoice.supplier_id],
    )
    await tx.query(
      `UPDATE invoice_items ii SET product_id = p.id, match_source = 'ean', match_note = NULL
       FROM products p
       WHERE ii.invoice_id = $1 AND ii.product_id IS NULL AND ii.ean IS NOT NULL AND p.barcode = ii.ean AND p.active`,
      [invoiceId],
    )

    // Sem pedido vinculado: escolhe o pedido aprovado do fornecedor que mais combina com a nota.
    let orderId = invoice.purchase_order_id
    const invoiceItems = await tx.query(`SELECT id, description, product_id, quantity, order_item_id FROM invoice_items WHERE invoice_id = $1 ORDER BY item_number`, [invoiceId])
    if (!orderId) {
      const orders = await tx.query(
        `SELECT o.id, array_agg(oi.product_id) AS products FROM purchase_orders o JOIN purchase_order_items oi ON oi.order_id = o.id
         WHERE o.supplier_id = $1 AND o.status = ANY($2) GROUP BY o.id ORDER BY o.number`,
        [invoice.supplier_id, RECEIVABLE],
      )
      let best = { id: null as string | null, score: 0 }
      for (const o of orders) {
        const score = invoiceItems.filter((i: any) => i.product_id && o.products.includes(i.product_id)).length
        if (score > best.score) best = { id: o.id, score }
      }
      if (!best.id && orders.length === 1) best.id = orders[0].id
      if (best.id) {
        orderId = best.id
        await tx.query(`UPDATE invoices SET purchase_order_id = $2 WHERE id = $1`, [invoiceId, orderId])
      }
    }
    if (!orderId) return

    const orderItems = await tx.query(
      `SELECT id, product_id, description, quantity - received_quantity AS open FROM purchase_order_items WHERE order_id = $1`,
      [orderId],
    )
    const used = new Set(invoiceItems.map((i: any) => i.order_item_id).filter(Boolean))
    for (const item of invoiceItems) {
      if (item.order_item_id) continue
      let target = item.product_id && orderItems.find((oi: any) => oi.product_id === item.product_id && !used.has(oi.id))
      let source: string | null = null
      if (!target && !item.product_id) {
        // Descrição da nota parecida com a do pedido: sugere o produto do pedido.
        const scored = orderItems
          .filter((oi: any) => oi.product_id && !used.has(oi.id))
          .map((oi: any) => ({ oi, score: similarity(item.description, oi.description) }))
          .sort((a: any, b: any) => b.score - a.score)[0]
        if (scored && scored.score >= 0.5) {
          target = scored.oi
          source = 'pedido'
        }
      }
      if (!target) continue
      used.add(target.id)
      await tx.query(
        `UPDATE invoice_items SET order_item_id = $2, product_id = coalesce(product_id, $3),
           match_source = CASE WHEN product_id IS NULL THEN $4 ELSE match_source END
         WHERE id = $1`,
        [item.id, target.id, target.product_id, source],
      )
    }
  }

  private async load(tx: Tx, id: string) {
    const invoice = found(
      await one(
        tx,
        `SELECT i.id, i.access_key AS "accessKey", i.number, i.series, i.issue_date AS "issueDate", i.total, i.status,
                i.posted_at AS "postedAt", i.created_at AS "createdAt", i.supplier_id AS "supplierId",
                s.name AS "supplierName", s.cnpj AS "supplierCnpj", i.purchase_order_id AS "purchaseOrderId",
                o.number AS "orderNumber", o.status AS "orderStatus"
         FROM invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
         WHERE i.id = $1`,
        [id],
      ),
      'Nota não encontrada',
    )
    const items = (
      await tx.query(
        `SELECT ii.id, ii.item_number AS "itemNumber", ii.supplier_code AS "supplierCode", ii.ean, ii.description, ii.ncm, ii.cfop,
                ii.unit, ii.quantity, ii.unit_price AS "unitPrice", ii.total, ii.product_id AS "productId", p.sku AS "productSku",
                p.name AS "productName", p.unit AS "productUnit", ii.order_item_id AS "orderItemId", ii.match_source AS "matchSource",
                ii.match_note AS "matchNote", oi.quantity - oi.received_quantity AS "orderOpenQuantity", oi.unit_price AS "orderUnitPrice"
         FROM invoice_items ii
         LEFT JOIN products p ON p.id = ii.product_id
         LEFT JOIN purchase_order_items oi ON oi.id = ii.order_item_id
         WHERE ii.invoice_id = $1 ORDER BY ii.item_number`,
        [id],
      )
    ).map((i: any) => numbers(i, 'quantity', 'unitPrice', 'total', 'orderOpenQuantity', 'orderUnitPrice'))

    // Alertas para o comprador conferir antes de lançar.
    const warnings: string[] = []
    for (const i of items) {
      if (i.orderItemId && i.quantity > i.orderOpenQuantity + 1e-9) warnings.push(`Item ${i.itemNumber}: quantidade maior que o saldo do pedido (${i.orderOpenQuantity})`)
      if (i.orderItemId && i.orderUnitPrice && i.unitPrice > i.orderUnitPrice * 1.005) {
        warnings.push(`Item ${i.itemNumber}: preço acima do pedido (${i.unitPrice.toFixed(2)} × ${i.orderUnitPrice.toFixed(2)})`)
      }
      if (i.productUnit && i.unit && i.productUnit.toUpperCase() !== i.unit.toUpperCase()) {
        warnings.push(`Item ${i.itemNumber}: unidade da nota (${i.unit}) diferente da do produto (${i.productUnit})`)
      }
    }
    if (invoice.status === 'pendente' && !invoice.purchaseOrderId) warnings.push('Nota sem pedido de compra vinculado')

    const orders = (
      await tx.query(
        `SELECT id, number, status, total FROM purchase_orders WHERE supplier_id = $1 AND status = ANY($2) ORDER BY number DESC`,
        [invoice.supplierId, RECEIVABLE],
      )
    ).map((o: any) => ({ ...numbers(o, 'total'), code: code('PC', o.number) }))
    const orderItems = invoice.purchaseOrderId
      ? (
          await tx.query(
            `SELECT id, description, unit, quantity, received_quantity AS "receivedQuantity", unit_price AS "unitPrice"
             FROM purchase_order_items WHERE order_id = $1 ORDER BY description`,
            [invoice.purchaseOrderId],
          )
        ).map((o: any) => numbers(o, 'quantity', 'receivedQuantity', 'unitPrice'))
      : []

    return {
      ...numbers(invoice, 'total'),
      orderCode: invoice.orderNumber ? code('PC', invoice.orderNumber) : null,
      items,
      warnings,
      orders,
      orderItems,
      aiEnabled: aiEnabled(),
    }
  }
}
