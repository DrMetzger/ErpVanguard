import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { can, isAdmin, requirePermission } from '../common/access'
import { numbers, one } from '../common/db'
import type { User } from '../users/user.entity'
import { buyerGroupIds, code, found } from './purchasing.helpers'

class RequestItemDto {
  @IsOptional() @IsUUID() productId?: string
  @IsOptional() @IsString() @Length(1, 200) description?: string
  @IsOptional() @IsString() @Length(1, 6) unit?: string
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity: number
}

class CreateRequestDto {
  @IsUUID() purchaseGroupId: string
  @IsOptional() @IsDateString() neededBy?: string
  @IsOptional() @IsString() @Length(0, 2000) notes?: string
  @IsArray() @ArrayMinSize(1, { message: 'Informe pelo menos um item' }) @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items: RequestItemDto[]
}

const SELECT = `
  SELECT r.id, r.number, r.status, r.needed_by AS "neededBy", r.notes, r.created_at AS "createdAt",
         r.purchase_group_id AS "purchaseGroupId", g.name AS "purchaseGroupName",
         r.requester_id AS "requesterId", u.name AS "requesterName",
         (SELECT json_agg(json_build_object('id', i.id, 'productId', i.product_id, 'sku', p.sku, 'description', i.description,
                 'unit', i.unit, 'quantity', i.quantity, 'status', i.status) ORDER BY i.description)
          FROM purchase_request_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.request_id = r.id) AS items
  FROM purchase_requests r
  JOIN purchase_groups g ON g.id = r.purchase_group_id
  JOIN users u ON u.id = r.requester_id`

const shape = (r: any) => ({
  ...r,
  code: code('SC', r.number),
  items: (r.items ?? []).map((i: any) => numbers(i, 'quantity')),
})

@Controller('purchase-requests')
export class RequestsController {
  constructor(private readonly db: DataSource) {}

  // Solicitante vê as suas; comprador vê as dos seus grupos; admin vê todas.
  @Get()
  async list(@CurrentUser() me: User, @Query('status') status?: string) {
    const groups = can(me, 'comprador') ? await buyerGroupIds(this.db, me) : []
    const rows = await this.db.query(
      `${SELECT}
       WHERE ($1::uuid[] IS NULL OR r.requester_id = $2 OR r.purchase_group_id = ANY($1))
         AND ($3::text IS NULL OR r.status = $3)
       ORDER BY r.number DESC LIMIT 300`,
      [groups, me.id, status || null],
    )
    return rows.map(shape)
  }

  // Itens ainda sem cotação, para o comprador montar uma cotação.
  @Get('pending-items')
  async pendingItems(@CurrentUser() me: User) {
    requirePermission(me, 'comprador')
    const groups = await buyerGroupIds(this.db, me)
    const rows = await this.db.query(
      `SELECT i.id, i.product_id AS "productId", p.sku, i.description, i.unit, i.quantity,
              r.id AS "requestId", r.number AS "requestNumber", r.needed_by AS "neededBy",
              r.purchase_group_id AS "purchaseGroupId", g.name AS "purchaseGroupName", u.name AS "requesterName"
       FROM purchase_request_items i
       JOIN purchase_requests r ON r.id = i.request_id
       JOIN purchase_groups g ON g.id = r.purchase_group_id
       JOIN users u ON u.id = r.requester_id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.status = 'pendente' AND r.status IN ('aberta', 'em_cotacao')
         AND ($1::uuid[] IS NULL OR r.purchase_group_id = ANY($1))
       ORDER BY r.number, i.description`,
      [groups],
    )
    return rows.map((r: any) => ({ ...numbers(r, 'quantity'), requestCode: code('SC', r.requestNumber) }))
  }

  @Get(':id')
  async get(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    const row = shape(found(await one(this.db, `${SELECT} WHERE r.id = $1`, [id]), 'Solicitação não encontrada'))
    if (row.requesterId !== me.id && !can(me, 'comprador')) throw new ForbiddenException()
    return row
  }

  @Post()
  async create(@CurrentUser() me: User, @Body() dto: CreateRequestDto) {
    requirePermission(me, 'solicitante')
    found(await one(this.db, `SELECT 1 FROM purchase_groups WHERE id = $1 AND active`, [dto.purchaseGroupId]), 'Grupo de compras não encontrado')

    return this.db.transaction(async (tx) => {
      const { id } = (await one(tx, `INSERT INTO purchase_requests (requester_id, purchase_group_id, needed_by, notes) VALUES ($1, $2, $3, $4) RETURNING id`, [
        me.id, dto.purchaseGroupId, dto.neededBy || null, dto.notes || null,
      ]))!
      for (const item of dto.items) {
        let { description, unit } = item
        if (item.productId) {
          const product = found(await one(tx, `SELECT name, unit FROM products WHERE id = $1`, [item.productId]), 'Produto não encontrado')
          description ||= product.name
          unit ||= product.unit
        }
        if (!description) throw new BadRequestException('Informe o produto ou a descrição de cada item')
        await tx.query(`INSERT INTO purchase_request_items (request_id, product_id, description, unit, quantity) VALUES ($1, $2, $3, $4, $5)`, [
          id, item.productId ?? null, description, unit || 'UN', item.quantity,
        ])
      }
      return shape(await one(tx, `${SELECT} WHERE r.id = $1`, [id]))
    })
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    const request = found(await one(this.db, `SELECT requester_id, status FROM purchase_requests WHERE id = $1`, [id]), 'Solicitação não encontrada')
    if (request.requester_id !== me.id && !isAdmin(me)) throw new ForbiddenException('Só quem abriu a solicitação pode cancelá-la')
    const busy = await one(this.db, `SELECT 1 FROM purchase_request_items WHERE request_id = $1 AND status <> 'pendente'`, [id])
    if (request.status !== 'aberta' || busy) throw new BadRequestException('A solicitação já está em cotação ou atendida e não pode ser cancelada')
    await this.db.query(`UPDATE purchase_requests SET status = 'cancelada' WHERE id = $1`, [id])
    await this.db.query(`UPDATE purchase_request_items SET status = 'cancelado' WHERE request_id = $1`, [id])
    return this.get(me, id)
  }
}
