import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { PartialType } from '@nestjs/mapped-types'
import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, Length } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { digits, one } from '../common/db'
import type { User } from '../users/user.entity'
import { branchForInsert, CurrentBranch, visibleIn } from '../branches/branch.context'
import { NO_BRANCH } from '../branches/branch-tables'
import { CustomFieldsService } from '../custom/custom-fields.service'
import { isValidDocument } from './documents'

class CreateSupplierDto {
  @IsString() cnpj: string
  @IsString() @Length(1, 200) name: string
  @IsOptional() @IsString() @Length(0, 200) tradeName?: string
  @IsOptional() @IsEmail() email?: string
  @IsOptional() @IsString() @Length(0, 30) phone?: string
  @IsOptional() @IsString() @Length(0, 100) city?: string
  @IsOptional() @IsString() @Length(0, 2) uf?: string
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsObject() custom?: Record<string, unknown>
}
class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

const COLUMNS = `id, cnpj, name, trade_name AS "tradeName", email, phone, city, uf, active, custom, created_at AS "createdAt"`

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly db: DataSource, private readonly custom: CustomFieldsService) {}

  @Get()
  list(@CurrentBranch() branch: string | null, @Query('q') q?: string) {
    const term = q?.trim()
    return this.db.query(
      `SELECT ${COLUMNS} FROM suppliers t
       WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR trade_name ILIKE '%' || $1 || '%' OR cnpj LIKE regexp_replace($1, '\\D', '', 'g') || '%')
         AND ${visibleIn('t', 2)}
       ORDER BY name LIMIT 300`,
      [term || null, branch],
    )
  }

  @Post()
  async create(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Body() dto: CreateSupplierDto) {
    requirePermission(me, 'comprador')
    const cnpj = this.document(dto.cnpj)
    const branchId = await branchForInsert(this.db, 'suppliers', branch)
    if (await one(this.db, `SELECT 1 FROM suppliers WHERE cnpj = $1 AND coalesce(branch_id, '${NO_BRANCH}') = coalesce($2::uuid, '${NO_BRANCH}')`, [cnpj, branchId])) {
      throw new ConflictException('Já existe um fornecedor com este CNPJ/CPF')
    }
    const custom = await this.custom.validate('suppliers', dto.custom, {}, true)
    return one(
      this.db,
      `INSERT INTO suppliers (cnpj, name, trade_name, email, phone, city, uf, active, custom, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, upper($7), coalesce($8, true), $9, $10) RETURNING ${COLUMNS}`,
      [cnpj, dto.name, dto.tradeName || null, dto.email || null, dto.phone || null, dto.city || null, dto.uf || null, dto.active ?? null, JSON.stringify(custom), branchId],
    )
  }

  @Patch(':id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    requirePermission(me, 'comprador')
    const cnpj = dto.cnpj === undefined ? null : this.document(dto.cnpj)
    const current = await one(this.db, `SELECT custom FROM suppliers WHERE id = $1`, [id])
    if (!current) throw new NotFoundException('Fornecedor não encontrado')
    const custom = await this.custom.validate('suppliers', dto.custom, current.custom ?? {})
    try {
      const row = await one(
        this.db,
        `UPDATE suppliers SET
           cnpj = coalesce($2, cnpj), name = coalesce($3, name),
           trade_name = CASE WHEN $4::boolean THEN $5 ELSE trade_name END,
           email = CASE WHEN $6::boolean THEN $7 ELSE email END,
           phone = CASE WHEN $8::boolean THEN $9 ELSE phone END,
           city = CASE WHEN $10::boolean THEN $11 ELSE city END,
           uf = CASE WHEN $12::boolean THEN upper($13) ELSE uf END,
           active = coalesce($14, active), custom = coalesce($15, custom), updated_at = now()
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [
          id, cnpj, dto.name ?? null,
          'tradeName' in dto, dto.tradeName || null,
          'email' in dto, dto.email || null,
          'phone' in dto, dto.phone || null,
          'city' in dto, dto.city || null,
          'uf' in dto, dto.uf || null,
          dto.active ?? null, custom ? JSON.stringify(custom) : null,
        ],
      )
      if (!row) throw new NotFoundException('Fornecedor não encontrado')
      return row
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('Já existe um fornecedor com este CNPJ/CPF')
      throw error
    }
  }

  private document(value: string) {
    const doc = digits(value)
    if (!isValidDocument(doc)) throw new BadRequestException('CNPJ/CPF inválido')
    return doc
  }
}
