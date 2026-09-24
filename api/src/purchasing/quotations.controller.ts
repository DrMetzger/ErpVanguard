import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator'
import { DataSource, EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { numbers, one } from '../common/db'
import type { User } from '../users/user.entity'
import { createOrder } from './orders.logic'
import { buyerGroupIds, code, found, requireBuyerOf } from './purchasing.helpers'

class CreateQuotationDto {
  @IsArray() @ArrayMinSize(1, { message: 'Selecione pelo menos um item' }) @ArrayUnique() @IsUUID('all', { each: true }) requestItemIds: string[]
  @IsArray() @ArrayMinSize(1, { message: 'Selecione pelo menos um fornecedor' }) @ArrayUnique() @IsUUID('all', { each: true }) supplierIds: string[]
  @IsOptional() @IsDateString() deadline?: string
  @IsOptional() @IsString() @Length(0, 2000) notes?: string
}

class PriceDto {
  @IsUUID() quotationItemId: string
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitPrice?: number | null
}

class SupplierResponseDto {
  @IsUUID() quotationSupplierId: string
  @IsOptional() @IsString() @Length(0, 100) paymentTerms?: string
  @IsOptional() @IsInt() @Min(0) deliveryDays?: number | null
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) freight?: number
  @IsOptional() @IsString() @Length(0, 1000) notes?: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => PriceDto) prices: PriceDto[]
}

class ResponsesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SupplierResponseDto) suppliers: SupplierResponseDto[]
}

class WinnerDto {
  @IsUUID() quotationItemId: string
  @IsUUID() quotationSupplierId: string
}

class CloseDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WinnerDto) winners: WinnerDto[]
}

class AddSupplierDto {
  @IsUUID() supplierId: string
}

// Recalcula o status das solicitações envolvidas numa cotação:
// atendida = tudo virou pedido (ou foi cancelado); em_cotacao = algo andou; aberta = nada andou.
async function refreshRequestStatus(tx: EntityManager, quotationId: string) {
  await tx.query(
    `UPDATE purchase_requests r SET status = s.status
     FROM (
       SELECT request_id, CASE
         WHEN bool_and(status IN ('pedido', 'cancelado')) THEN 'atendida'
         WHEN bool_or(status IN ('cotacao', 'pedido')) THEN 'em_cotacao'
         ELSE 'aberta' END AS status
       FROM purchase_request_items GROUP BY request_id
     ) s
     WHERE s.request_id = r.id AND r.status <> 'cancelada'
       AND r.id IN (SELECT ri.request_id FROM purchase_request_items ri JOIN quotation_items qi ON qi.request_item_id = ri.id WHERE qi.quotation_id = $1)`,
    [quotationId],
  )
}

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentUser() me: User) {
    requirePermission(me, 'comprador')
    const groups = await buyerGroupIds(this.db, me)
    const rows = await this.db.query(
      `SELECT q.id, q.number, q.status, q.deadline, q.created_at AS "createdAt", g.name AS "purchaseGroupName", u.name AS "buyerName",
              (SELECT count(*)::int FROM quotation_items WHERE quotation_id = q.id) AS "itemCount",
              (SELECT count(*)::int FROM quotation_suppliers WHERE quotation_id = q.id) AS "supplierCount"
       FROM quotations q JOIN purchase_groups g ON g.id = q.purchase_group_id JOIN users u ON u.id = q.buyer_id
       WHERE $1::uuid[] IS NULL OR q.purchase_group_id = ANY($1)
       ORDER BY q.number DESC LIMIT 300`,
      [groups],
    )
    return rows.map((r: any) => ({ ...r, code: code('COT', r.number) }))
  }

  @Get(':id')
  get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'comprador')
    return this.load(this.db, id)
  }

  @Post()
  async create(@CurrentUser() me: User, @Body() dto: CreateQuotationDto) {
    requirePermission(me, 'comprador')
    return this.db.transaction(async (tx) => {
      const items = await tx.query(
        `SELECT i.id, i.product_id, i.description, i.unit, i.quantity, i.status, r.purchase_group_id, r.id AS request_id
         FROM purchase_request_items i JOIN purchase_requests r ON r.id = i.request_id
         WHERE i.id = ANY($1) FOR UPDATE OF i`,
        [dto.requestItemIds],
      )
      if (items.length !== dto.requestItemIds.length) throw new BadRequestException('Item de solicitação não encontrado')
      if (items.some((i: any) => i.status !== 'pendente')) throw new BadRequestException('Algum item já está em outra cotação')
      const groupIds = [...new Set(items.map((i: any) => i.purchase_group_id))]
      if (groupIds.length > 1) throw new BadRequestException('Os itens de uma cotação devem ser do mesmo grupo de compras')
      await requireBuyerOf(tx, me, groupIds[0] as string)

      const suppliers = await tx.query(`SELECT id FROM suppliers WHERE id = ANY($1) AND active`, [dto.supplierIds])
      if (suppliers.length !== dto.supplierIds.length) throw new BadRequestException('Fornecedor não encontrado ou inativo')

      const { id } = (await one(tx, `INSERT INTO quotations (purchase_group_id, buyer_id, deadline, notes) VALUES ($1, $2, $3, $4) RETURNING id`, [
        groupIds[0], me.id, dto.deadline || null, dto.notes || null,
      ]))!
      for (const item of items) {
        await tx.query(
          `INSERT INTO quotation_items (quotation_id, request_item_id, product_id, description, unit, quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, item.id, item.product_id, item.description, item.unit, item.quantity],
        )
      }
      for (const supplierId of dto.supplierIds) await this.addSupplierTx(tx, id, supplierId)
      await tx.query(`UPDATE purchase_request_items SET status = 'cotacao' WHERE id = ANY($1)`, [dto.requestItemIds])
      await tx.query(`UPDATE purchase_requests SET status = 'em_cotacao' WHERE id = ANY($1) AND status = 'aberta'`, [
        [...new Set(items.map((i: any) => i.request_id))],
      ])
      return this.load(tx, id)
    })
  }

  @Post(':id/suppliers')
  async addSupplier(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddSupplierDto) {
    return this.db.transaction(async (tx) => {
      await this.openForBuyer(tx, me, id)
      if (await one(tx, `SELECT 1 FROM quotation_suppliers WHERE quotation_id = $1 AND supplier_id = $2`, [id, dto.supplierId])) {
        throw new BadRequestException('Fornecedor já está nesta cotação')
      }
      found(await one(tx, `SELECT 1 FROM suppliers WHERE id = $1 AND active`, [dto.supplierId]), 'Fornecedor não encontrado ou inativo')
      await this.addSupplierTx(tx, id, dto.supplierId)
      return this.load(tx, id)
    })
  }

  // Grava os preços e condições informados por cada fornecedor.
  @Put(':id/responses')
  async saveResponses(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponsesDto) {
    return this.db.transaction(async (tx) => {
      await this.openForBuyer(tx, me, id)
      for (const s of dto.suppliers) {
        const row = await one(
          tx,
          `UPDATE quotation_suppliers SET payment_terms = $3, delivery_days = $4, freight = coalesce($5, 0), notes = $6
           WHERE id = $2 AND quotation_id = $1 RETURNING id`,
          [id, s.quotationSupplierId, s.paymentTerms || null, s.deliveryDays ?? null, s.freight ?? null, s.notes || null],
        )
        found(row, 'Fornecedor não pertence a esta cotação')
        for (const p of s.prices) {
          const updated = await one(
            tx,
            `UPDATE quotation_prices SET unit_price = $3
             WHERE quotation_supplier_id = $1 AND quotation_item_id = $2 RETURNING 1`,
            [s.quotationSupplierId, p.quotationItemId, p.unitPrice ?? null],
          )
          found(updated, 'Item não pertence a esta cotação')
        }
      }
      return this.load(tx, id)
    })
  }

  // Finaliza a análise: marca os vencedores e gera um pedido por fornecedor.
  @Post(':id/close')
  async close(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDto) {
    return this.db.transaction(async (tx) => {
      const quotation = await this.openForBuyer(tx, me, id)
      const full = await this.load(tx, id)
      const winners = new Map(dto.winners.map((w) => [w.quotationItemId, w.quotationSupplierId]))
      if (winners.size !== dto.winners.length) throw new BadRequestException('Cada item só pode ter um vencedor')

      const bySupplier = new Map<string, any[]>()
      for (const item of full.items) {
        const supplierRowId = winners.get(item.id)
        if (!supplierRowId) continue // item sem vencedor volta a ficar pendente
        const price = item.prices.find((p: any) => p.quotationSupplierId === supplierRowId)
        if (!price) throw new BadRequestException('Fornecedor vencedor não pertence a esta cotação')
        if (price.unitPrice === null) throw new BadRequestException(`O fornecedor escolhido não cotou "${item.description}"`)
        bySupplier.set(supplierRowId, [...(bySupplier.get(supplierRowId) ?? []), { ...item, unitPrice: price.unitPrice }])
      }
      if (!bySupplier.size) throw new BadRequestException('Escolha o vencedor de pelo menos um item')

      const orders = []
      for (const [supplierRowId, items] of bySupplier) {
        const s = full.suppliers.find((x: any) => x.id === supplierRowId)
        await tx.query(`UPDATE quotation_prices SET winner = true WHERE quotation_supplier_id = $1 AND quotation_item_id = ANY($2)`, [
          supplierRowId, items.map((i) => i.id),
        ])
        const order = await createOrder(tx, {
          supplierId: s.supplierId,
          purchaseGroupId: quotation.purchase_group_id,
          quotationId: id,
          buyerId: me.id,
          paymentTerms: s.paymentTerms,
          deliveryDays: s.deliveryDays,
          freight: s.freight,
          items: items.map((i) => ({
            requestItemId: i.requestItemId, productId: i.productId, description: i.description,
            unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice,
          })),
        })
        orders.push({ ...order, code: code('PC', order.number), supplierName: s.name })
      }

      const wonRequestItems = full.items.filter((i: any) => winners.has(i.id)).map((i: any) => i.requestItemId)
      const lostRequestItems = full.items.filter((i: any) => !winners.has(i.id)).map((i: any) => i.requestItemId)
      await tx.query(`UPDATE purchase_request_items SET status = 'pedido' WHERE id = ANY($1)`, [wonRequestItems])
      await tx.query(`UPDATE purchase_request_items SET status = 'pendente' WHERE id = ANY($1)`, [lostRequestItems])
      await refreshRequestStatus(tx, id)
      await tx.query(`UPDATE quotations SET status = 'finalizada' WHERE id = $1`, [id])
      return { quotation: await this.load(tx, id), orders }
    })
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.transaction(async (tx) => {
      await this.openForBuyer(tx, me, id)
      await tx.query(
        `UPDATE purchase_request_items SET status = 'pendente'
         WHERE id IN (SELECT request_item_id FROM quotation_items WHERE quotation_id = $1)`,
        [id],
      )
      await refreshRequestStatus(tx, id)
      await tx.query(`UPDATE quotations SET status = 'cancelada' WHERE id = $1`, [id])
      return this.load(tx, id)
    })
  }

  private async openForBuyer(tx: EntityManager, me: User, id: string) {
    requirePermission(me, 'comprador')
    const quotation = found(await one(tx, `SELECT purchase_group_id, status FROM quotations WHERE id = $1 FOR UPDATE`, [id]), 'Cotação não encontrada')
    await requireBuyerOf(tx, me, quotation.purchase_group_id)
    if (quotation.status !== 'aberta') throw new BadRequestException('A cotação não está mais aberta')
    return quotation
  }

  private async addSupplierTx(tx: EntityManager, quotationId: string, supplierId: string) {
    const { id } = (await one(tx, `INSERT INTO quotation_suppliers (quotation_id, supplier_id) VALUES ($1, $2) RETURNING id`, [quotationId, supplierId]))!
    await tx.query(
      `INSERT INTO quotation_prices (quotation_item_id, quotation_supplier_id) SELECT id, $2 FROM quotation_items WHERE quotation_id = $1`,
      [quotationId, id],
    )
  }

  // Cotação completa com o mapa comparativo (menor preço por item e total por fornecedor).
  private async load(db: DataSource | EntityManager, id: string) {
    const q = found(
      await one(
        db,
        `SELECT q.id, q.number, q.status, q.deadline, q.notes, q.created_at AS "createdAt",
                q.purchase_group_id AS "purchaseGroupId", g.name AS "purchaseGroupName", u.name AS "buyerName"
         FROM quotations q JOIN purchase_groups g ON g.id = q.purchase_group_id JOIN users u ON u.id = q.buyer_id WHERE q.id = $1`,
        [id],
      ),
      'Cotação não encontrada',
    )
    const suppliers = (
      await db.query(
        `SELECT qs.id, qs.supplier_id AS "supplierId", s.name, s.cnpj, qs.payment_terms AS "paymentTerms",
                qs.delivery_days AS "deliveryDays", qs.freight, qs.notes
         FROM quotation_suppliers qs JOIN suppliers s ON s.id = qs.supplier_id WHERE qs.quotation_id = $1 ORDER BY s.name`,
        [id],
      )
    ).map((s: any) => numbers(s, 'freight'))
    const items = (
      await db.query(
        `SELECT qi.id, qi.request_item_id AS "requestItemId", qi.product_id AS "productId", p.sku, qi.description, qi.unit, qi.quantity,
                r.number AS "requestNumber"
         FROM quotation_items qi
         LEFT JOIN products p ON p.id = qi.product_id
         LEFT JOIN purchase_request_items ri ON ri.id = qi.request_item_id
         LEFT JOIN purchase_requests r ON r.id = ri.request_id
         WHERE qi.quotation_id = $1 ORDER BY qi.description`,
        [id],
      )
    ).map((i: any) => numbers(i, 'quantity'))
    const prices = (
      await db.query(
        `SELECT qp.quotation_item_id AS "quotationItemId", qp.quotation_supplier_id AS "quotationSupplierId", qp.unit_price AS "unitPrice", qp.winner
         FROM quotation_prices qp JOIN quotation_items qi ON qi.id = qp.quotation_item_id WHERE qi.quotation_id = $1`,
        [id],
      )
    ).map((p: any) => numbers(p, 'unitPrice'))

    for (const item of items) {
      item.prices = suppliers.map((s: any) => {
        const p = prices.find((x: any) => x.quotationItemId === item.id && x.quotationSupplierId === s.id)
        return { quotationSupplierId: s.id, unitPrice: p?.unitPrice ?? null, winner: p?.winner ?? false }
      })
      const quoted = item.prices.filter((p: any) => p.unitPrice !== null)
      const best = quoted.length ? Math.min(...quoted.map((p: any) => p.unitPrice)) : null
      item.bestPrice = best
      item.bestSupplierIds = item.prices.filter((p: any) => best !== null && p.unitPrice === best).map((p: any) => p.quotationSupplierId)
      item.requestCode = item.requestNumber ? code('SC', item.requestNumber) : null
    }
    for (const s of suppliers) {
      const lines = items.map((i: any) => ({ qty: i.quantity, price: i.prices.find((p: any) => p.quotationSupplierId === s.id).unitPrice }))
      s.quotedItems = lines.filter((l: any) => l.price !== null).length
      s.itemsTotal = Math.round(lines.reduce((sum: number, l: any) => sum + (l.price ?? 0) * l.qty, 0) * 100) / 100
      s.total = Math.round((s.itemsTotal + s.freight) * 100) / 100
    }
    return { ...q, code: code('COT', q.number), suppliers, items }
  }
}
