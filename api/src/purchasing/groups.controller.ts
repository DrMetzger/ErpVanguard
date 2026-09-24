import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator'
import { DataSource, EntityManager } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { numbers, one } from '../common/db'
import type { User } from '../users/user.entity'

class LevelDto {
  @IsInt() @Min(1) level: number
  // Vazio = sem limite (último nível costuma ser a diretoria).
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) limitAmount?: number | null
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) userIds: string[]
}

class ApprovalGroupDto {
  @IsString() @Length(1, 100) name: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => LevelDto) levels: LevelDto[]
}

class PurchaseGroupDto {
  @IsString() @Length(1, 100) name: string
  @IsOptional() @IsUUID() approvalGroupId?: string | null
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) buyerIds: string[]
  @IsOptional() @IsBoolean() active?: boolean
}

const unique = (error: any, message: string) => {
  if (error?.code === '23505') throw new ConflictException(message)
  throw error
}

@Controller()
export class GroupsController {
  constructor(private readonly db: DataSource) {}

  // ---- Grupos de aprovação (alçadas)

  @Get('approval-groups')
  async listApprovalGroups() {
    const groups = await this.db.query(`SELECT id, name FROM approval_groups ORDER BY name`)
    const levels = await this.db.query(`
      SELECT l.group_id, l.level, l.limit_amount AS "limitAmount",
             coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS users
      FROM approval_levels l
      LEFT JOIN approval_level_members m ON m.level_id = l.id
      LEFT JOIN users u ON u.id = m.user_id
      GROUP BY l.id ORDER BY l.level`)
    return groups.map((g: any) => ({
      ...g,
      levels: levels.filter((l: any) => l.group_id === g.id).map(({ group_id, ...l }: any) => numbers(l, 'limitAmount')),
    }))
  }

  @Post('approval-groups')
  async createApprovalGroup(@CurrentUser() me: User, @Body() dto: ApprovalGroupDto) {
    requireAdmin(me)
    this.checkLevels(dto)
    try {
      return await this.db.transaction(async (tx) => {
        const { id } = (await one(tx, `INSERT INTO approval_groups (name) VALUES ($1) RETURNING id`, [dto.name]))!
        await this.saveLevels(tx, id, dto.levels)
        return { id }
      })
    } catch (error) {
      unique(error, 'Já existe um grupo de aprovação com este nome')
    }
  }

  @Put('approval-groups/:id')
  async updateApprovalGroup(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalGroupDto) {
    requireAdmin(me)
    this.checkLevels(dto)
    try {
      return await this.db.transaction(async (tx) => {
        const row = await one(tx, `UPDATE approval_groups SET name = $2 WHERE id = $1 RETURNING id`, [id, dto.name])
        if (!row) throw new NotFoundException('Grupo de aprovação não encontrado')
        await tx.query(`DELETE FROM approval_levels WHERE group_id = $1`, [id])
        await this.saveLevels(tx, id, dto.levels)
        return { id }
      })
    } catch (error) {
      unique(error, 'Já existe um grupo de aprovação com este nome')
    }
  }

  @Delete('approval-groups/:id')
  @HttpCode(204)
  async deleteApprovalGroup(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(me)
    await this.db.query(`DELETE FROM approval_groups WHERE id = $1`, [id])
  }

  private checkLevels(dto: ApprovalGroupDto) {
    const levels = [...dto.levels].sort((a, b) => a.level - b.level)
    if (!levels.length) throw new BadRequestException('Informe pelo menos um nível de aprovação')
    if (new Set(levels.map((l) => l.level)).size !== levels.length) throw new BadRequestException('Níveis repetidos')
    levels.forEach((l, i) => {
      if (!l.userIds.length) throw new BadRequestException(`O nível ${l.level} precisa de pelo menos um aprovador`)
      const unlimited = l.limitAmount === null || l.limitAmount === undefined
      if (unlimited && i < levels.length - 1) throw new BadRequestException('Só o último nível pode ficar sem limite de valor')
      const prev = levels[i - 1]?.limitAmount
      if (i > 0 && !unlimited && prev !== null && prev !== undefined && l.limitAmount! <= prev) {
        throw new BadRequestException('Os limites precisam crescer a cada nível')
      }
    })
  }

  private async saveLevels(tx: EntityManager, groupId: string, levels: LevelDto[]) {
    for (const l of levels) {
      const { id } = (await one(tx, `INSERT INTO approval_levels (group_id, level, limit_amount) VALUES ($1, $2, $3) RETURNING id`, [
        groupId, l.level, l.limitAmount ?? null,
      ]))!
      for (const userId of l.userIds) {
        await tx.query(`INSERT INTO approval_level_members (level_id, user_id) VALUES ($1, $2)`, [id, userId])
      }
    }
  }

  // ---- Grupos de compras

  @Get('purchase-groups')
  listPurchaseGroups() {
    return this.db.query(`
      SELECT g.id, g.name, g.active, g.approval_group_id AS "approvalGroupId", ag.name AS "approvalGroupName",
             coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS buyers
      FROM purchase_groups g
      LEFT JOIN approval_groups ag ON ag.id = g.approval_group_id
      LEFT JOIN purchase_group_members m ON m.group_id = g.id
      LEFT JOIN users u ON u.id = m.user_id
      GROUP BY g.id, ag.name ORDER BY g.name`)
  }

  @Post('purchase-groups')
  async createPurchaseGroup(@CurrentUser() me: User, @Body() dto: PurchaseGroupDto) {
    requireAdmin(me)
    try {
      return await this.db.transaction(async (tx) => {
        const { id } = (await one(tx, `INSERT INTO purchase_groups (name, approval_group_id, active) VALUES ($1, $2, coalesce($3, true)) RETURNING id`, [
          dto.name, dto.approvalGroupId ?? null, dto.active ?? null,
        ]))!
        await this.saveBuyers(tx, id, dto.buyerIds)
        return { id }
      })
    } catch (error) {
      unique(error, 'Já existe um grupo de compras com este nome')
    }
  }

  @Put('purchase-groups/:id')
  async updatePurchaseGroup(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseGroupDto) {
    requireAdmin(me)
    try {
      return await this.db.transaction(async (tx) => {
        const row = await one(tx, `UPDATE purchase_groups SET name = $2, approval_group_id = $3, active = coalesce($4, active) WHERE id = $1 RETURNING id`, [
          id, dto.name, dto.approvalGroupId ?? null, dto.active ?? null,
        ])
        if (!row) throw new NotFoundException('Grupo de compras não encontrado')
        await tx.query(`DELETE FROM purchase_group_members WHERE group_id = $1`, [id])
        await this.saveBuyers(tx, id, dto.buyerIds)
        return { id }
      })
    } catch (error) {
      unique(error, 'Já existe um grupo de compras com este nome')
    }
  }

  private async saveBuyers(tx: EntityManager, groupId: string, userIds: string[]) {
    for (const userId of userIds) {
      await tx.query(`INSERT INTO purchase_group_members (group_id, user_id) VALUES ($1, $2)`, [groupId, userId])
    }
  }
}
