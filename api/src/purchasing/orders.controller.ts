import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { IsOptional, IsString, Length } from 'class-validator'
import { DataSource, EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { can, isAdmin, requirePermission } from '../common/access'
import { numbers, one } from '../common/db'
import type { User } from '../users/user.entity'
import { nextLevel } from './approval'
import { code, found, requireBuyerOf } from './purchasing.helpers'

class DecisionDto {
  @IsOptional() @IsString() @Length(0, 1000) comment?: string
}

const SELECT = `
  SELECT o.id, o.number, o.status, o.total, o.freight, o.payment_terms AS "paymentTerms", o.delivery_days AS "deliveryDays",
         o.required_levels AS "requiredLevels", o.notes, o.created_at AS "createdAt",
         o.supplier_id AS "supplierId", s.name AS "supplierName", s.cnpj AS "supplierCnpj",
         o.purchase_group_id AS "purchaseGroupId", g.name AS "purchaseGroupName", g.approval_group_id AS "approvalGroupId",
         o.buyer_id AS "buyerId", u.name AS "buyerName", q.number AS "quotationNumber",
         (SELECT coalesce(array_agg(level), '{}') FROM purchase_order_approvals WHERE order_id = o.id AND decision = 'aprovado') AS "approvedLevels"
  FROM purchase_orders o
  JOIN suppliers s ON s.id = o.supplier_id
  JOIN purchase_groups g ON g.id = o.purchase_group_id
  JOIN users u ON u.id = o.buyer_id
  LEFT JOIN quotations q ON q.id = o.quotation_id`

@Controller('purchase-orders')
export class OrdersController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentUser() me: User, @Query('status') status?: string) {
    if (!can(me, 'comprador') && !can(me, 'aprovador')) throw new ForbiddenException()
    const rows = await this.db.query(`${SELECT} WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.number DESC LIMIT 300`, [status || null])
    return Promise.all(rows.map((r: any) => this.shape(this.db, r, me)))
  }

  // Pedidos cujo próximo nível de aprovação inclui o usuário.
  @Get('pending-approval')
  async pending(@CurrentUser() me: User) {
    const rows = await this.db.query(`${SELECT} WHERE o.status = 'aguardando_aprovacao' ORDER BY o.number`)
    const shaped = await Promise.all(rows.map((r: any) => this.shape(this.db, r, me)))
    return shaped.filter((o) => o.canApprove)
  }

  @Get(':id')
  async get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    if (!can(me, 'comprador') && !can(me, 'aprovador')) throw new ForbiddenException()
    return this.load(this.db, id, me)
  }

  @Post(':id/approve')
  approve(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.decide(me, id, 'aprovado', dto.comment)
  }

  @Post(':id/reject')
  reject(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    if (!dto.comment?.trim()) throw new BadRequestException('Informe o motivo da reprovação')
    return this.decide(me, id, 'reprovado', dto.comment)
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.db.transaction(async (tx) => {
      const order = found(await one(tx, `SELECT purchase_group_id, status FROM purchase_orders WHERE id = $1 FOR UPDATE`, [id]), 'Pedido não encontrado')
      await requireBuyerOf(tx, me, order.purchase_group_id)
      if (!['aguardando_aprovacao', 'aprovado', 'reprovado'].includes(order.status)) {
        throw new BadRequestException('Pedido com recebimento não pode ser cancelado')
      }
      await tx.query(`UPDATE purchase_orders SET status = 'cancelado', notes = coalesce($2, notes) WHERE id = $1`, [id, dto.comment || null])
      // Itens voltam a ficar disponíveis para nova cotação.
      await tx.query(
        `UPDATE purchase_request_items SET status = 'pendente' WHERE id IN (SELECT request_item_id FROM purchase_order_items WHERE order_id = $1)`,
        [id],
      )
      await tx.query(
        `UPDATE purchase_requests SET status = 'em_cotacao'
         WHERE status = 'atendida' AND id IN (SELECT ri.request_id FROM purchase_request_items ri JOIN purchase_order_items oi ON oi.request_item_id = ri.id WHERE oi.order_id = $1)`,
        [id],
      )
      return this.load(tx, id, me)
    })
  }

  private async decide(me: User, id: string, decision: 'aprovado' | 'reprovado', comment?: string) {
    return this.db.transaction(async (tx) => {
      const order = await this.load(tx, id, me, true)
      if (order.status !== 'aguardando_aprovacao') throw new BadRequestException('O pedido não está aguardando aprovação')
      if (!order.canApprove) {
        throw new ForbiddenException(
          order.buyerId === me.id ? 'Quem gerou o pedido não pode aprová-lo' : `Você não é aprovador do nível ${order.pendingLevel}`,
        )
      }
      await tx.query(`INSERT INTO purchase_order_approvals (order_id, level, user_id, decision, comment) VALUES ($1, $2, $3, $4, $5)`, [
        id, order.pendingLevel, me.id, decision, comment || null,
      ])
      const approved = [...order.approvedLevels, order.pendingLevel]
      const status = decision === 'reprovado' ? 'reprovado' : nextLevel(order.requiredLevels, approved) === null ? 'aprovado' : 'aguardando_aprovacao'
      await tx.query(`UPDATE purchase_orders SET status = $2 WHERE id = $1`, [id, status])
      return this.load(tx, id, me)
    })
  }

  private async load(db: DataSource | EntityManager, id: string, me: User, lock = false) {
    if (lock) await db.query(`SELECT 1 FROM purchase_orders WHERE id = $1 FOR UPDATE`, [id])
    const row = found(await one(db, `${SELECT} WHERE o.id = $1`, [id]), 'Pedido não encontrado')
    const order: any = await this.shape(db, row, me)
    order.items = (
      await db.query(
        `SELECT oi.id, oi.product_id AS "productId", p.sku, oi.description, oi.unit, oi.quantity, oi.unit_price AS "unitPrice",
                oi.received_quantity AS "receivedQuantity", r.number AS "requestNumber"
         FROM purchase_order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN purchase_request_items ri ON ri.id = oi.request_item_id
         LEFT JOIN purchase_requests r ON r.id = ri.request_id
         WHERE oi.order_id = $1 ORDER BY oi.description`,
        [id],
      )
    ).map((i: any) => ({ ...numbers(i, 'quantity', 'unitPrice', 'receivedQuantity'), requestCode: i.requestNumber ? code('SC', i.requestNumber) : null }))
    order.approvals = await db.query(
      `SELECT a.level, a.decision, a.comment, a.created_at AS "createdAt", u.name AS "userName"
       FROM purchase_order_approvals a JOIN users u ON u.id = a.user_id WHERE a.order_id = $1 ORDER BY a.created_at`,
      [id],
    )
    order.levels = (
      await db.query(
        `SELECT l.level, l.limit_amount AS "limitAmount", coalesce(json_agg(u.name ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS approvers
         FROM approval_levels l LEFT JOIN approval_level_members m ON m.level_id = l.id LEFT JOIN users u ON u.id = m.user_id
         WHERE l.group_id = $1 AND l.level = ANY($2) GROUP BY l.id ORDER BY l.level`,
        [row.approvalGroupId, row.requiredLevels],
      )
    ).map((l: any) => numbers(l, 'limitAmount'))
    return order
  }

  private async shape(db: DataSource | EntityManager, row: any, me: User) {
    const order = { ...numbers(row, 'total', 'freight'), code: code('PC', row.number) }
    order.pendingLevel = order.status === 'aguardando_aprovacao' ? nextLevel(order.requiredLevels, order.approvedLevels) : null
    order.canApprove = false
    if (order.pendingLevel !== null && order.buyerId !== me.id && (can(me, 'aprovador') || isAdmin(me))) {
      order.canApprove = !!(await one(
        db,
        `SELECT 1 FROM approval_levels l JOIN approval_level_members m ON m.level_id = l.id
         WHERE l.group_id = $1 AND l.level = $2 AND m.user_id = $3`,
        [row.approvalGroupId, order.pendingLevel, me.id],
      ))
    }
    order.quotationCode = row.quotationNumber ? code('COT', row.quotationNumber) : null
    return order
  }
}
