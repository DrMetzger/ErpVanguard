import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { RESOURCES } from '../catalog/resources'
import { requireAdmin } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'
import { CUSTOMIZABLE, CustomFieldsService } from './custom-fields.service'

class FieldDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'Nome interno: letras minúsculas, números e _ (ex.: limite_credito)' }) key: string
  @IsString() @Length(2, 80, { message: 'Rótulo com 2 a 80 caracteres' }) label: string
  @IsIn(['text', 'number', 'date', 'bool', 'select']) type: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[]
  @IsOptional() @IsBoolean() required?: boolean
  @IsOptional() @IsBoolean() showInList?: boolean
  @IsOptional() @IsString() @MaxLength(200) help?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) position?: number
  @IsOptional() @IsBoolean() active?: boolean
}
class UpdateFieldDto {
  @IsOptional() @IsString() @Length(2, 80) label?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[]
  @IsOptional() @IsBoolean() required?: boolean
  @IsOptional() @IsBoolean() showInList?: boolean
  @IsOptional() @IsString() @MaxLength(200) help?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) position?: number
  @IsOptional() @IsBoolean() active?: boolean
}
class LayoutDto {
  @IsArray() @ArrayMaxSize(80) @IsString({ each: true }) hidden: string[]
  @IsArray() @ArrayMaxSize(120) @IsString({ each: true }) order: string[]
  @IsObject() labels: Record<string, string>
}

// Campos padrão de cada cadastro (para o ajuste de formulário). Produtos e fornecedores têm tela própria.
const STANDARD: Record<string, { key: string; label: string; required?: boolean }[]> = {
  products: [
    { key: 'sku', label: 'Código (SKU)', required: true }, { key: 'name', label: 'Descrição', required: true }, { key: 'unit', label: 'Unidade', required: true },
    { key: 'barcode', label: 'Código de barras' }, { key: 'ncm', label: 'NCM' }, { key: 'typeId', label: 'Tipo (SPED)' }, { key: 'groupId', label: 'Grupo' },
    { key: 'origin', label: 'Origem da mercadoria' }, { key: 'costPrice', label: 'Custo' }, { key: 'salePrice', label: 'Preço de venda' },
    { key: 'minStock', label: 'Estoque mínimo' },
  ],
  suppliers: [
    { key: 'cnpj', label: 'CNPJ/CPF', required: true }, { key: 'name', label: 'Razão social', required: true }, { key: 'tradeName', label: 'Nome fantasia' },
    { key: 'email', label: 'E-mail' }, { key: 'phone', label: 'Telefone' }, { key: 'city', label: 'Cidade' }, { key: 'uf', label: 'UF' },
  ],
}
const standardFields = (resource: string) =>
  STANDARD[resource] ?? RESOURCES.find((r) => r.name === resource)?.fields.filter((f) => f.key !== 'active').map((f) => ({ key: f.key, label: f.label, required: !!f.required })) ?? []

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly db: DataSource, private readonly custom: CustomFieldsService) {}

  // Cadastros personalizáveis, com campos padrão, personalizados e ajuste do formulário.
  @Get()
  async all() {
    return Promise.all(Object.entries(CUSTOMIZABLE).map(async ([resource, r]) => ({
      resource, title: r.title, standard: standardFields(resource), fields: await this.custom.definitions(resource, this.db, false), layout: await this.custom.layout(resource),
    })))
  }

  @Get(':resource')
  async get(@Param('resource') resource: string) {
    this.check(resource)
    return { resource, title: CUSTOMIZABLE[resource]!.title, standard: standardFields(resource), fields: await this.custom.definitions(resource), layout: await this.custom.layout(resource) }
  }

  @Post(':resource')
  async create(@CurrentUser() me: User, @Param('resource') resource: string, @Body() dto: FieldDto) {
    requireAdmin(me)
    this.check(resource)
    if (standardFields(resource).some((f) => f.key === dto.key)) throw new BadRequestException('Já existe um campo padrão com este nome')
    const options = (dto.options ?? []).map((o) => o.trim()).filter(Boolean)
    if (dto.type === 'select' && !options.length) throw new BadRequestException('Informe as opções da lista')
    try {
      await this.db.query(
        `INSERT INTO custom_fields (resource, key, label, type, options, required, show_in_list, help, position, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [resource, dto.key, dto.label.trim(), dto.type, options, dto.required ?? false, dto.showInList ?? false, dto.help?.trim() || null, dto.position ?? 0, dto.active ?? true],
      )
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('Já existe um campo com este nome interno')
      throw error
    }
    return this.get(resource)
  }

  @Patch(':resource/:id')
  async update(@CurrentUser() me: User, @Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFieldDto) {
    requireAdmin(me)
    this.check(resource)
    const field = await one(this.db, `SELECT type FROM custom_fields WHERE id = $1 AND resource = $2`, [id, resource])
    if (!field) throw new NotFoundException('Campo não encontrado')
    const options = dto.options?.map((o) => o.trim()).filter(Boolean)
    if (field.type === 'select' && options && !options.length) throw new BadRequestException('Informe as opções da lista')
    await this.db.query(
      `UPDATE custom_fields SET label = coalesce($3, label), options = coalesce($4, options), required = coalesce($5, required), show_in_list = coalesce($6, show_in_list),
              help = coalesce($7, help), position = coalesce($8, position), active = coalesce($9, active) WHERE id = $1 AND resource = $2`,
      [id, resource, dto.label?.trim() ?? null, options ?? null, dto.required ?? null, dto.showInList ?? null, dto.help ?? null, dto.position ?? null, dto.active ?? null],
    )
    return this.get(resource)
  }

  // Excluir apaga a definição; os valores já gravados ficam guardados (reaparecem se o campo for recriado).
  @Delete(':resource/:id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(me)
    const [, count] = await this.db.query(`DELETE FROM custom_fields WHERE id = $1 AND resource = $2`, [id, resource])
    if (!count) throw new NotFoundException('Campo não encontrado')
  }

  @Put(':resource/layout')
  async saveLayout(@CurrentUser() me: User, @Param('resource') resource: string, @Body() dto: LayoutDto) {
    requireAdmin(me)
    this.check(resource)
    const std = standardFields(resource)
    const custom = await this.custom.definitions(resource, this.db, false)
    const known = new Set([...std.map((f) => f.key), ...custom.map((f) => `custom.${f.key}`)])
    const bad = [...dto.hidden, ...dto.order, ...Object.keys(dto.labels)].filter((k) => !known.has(k))
    if (bad.length) throw new BadRequestException(`Campo desconhecido: ${[...new Set(bad)].join(', ')}`)
    const requiredHidden = dto.hidden.filter((k) => std.find((f) => f.key === k)?.required)
    if (requiredHidden.length) throw new BadRequestException(`Campo obrigatório não pode ser escondido: ${requiredHidden.join(', ')}`)
    const labels = Object.fromEntries(Object.entries(dto.labels).map(([k, v]) => [k, String(v).trim().slice(0, 80)]).filter(([, v]) => v))
    await this.db.query(
      `INSERT INTO form_layouts (resource, hidden, field_order, labels, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (resource) DO UPDATE SET hidden = EXCLUDED.hidden, field_order = EXCLUDED.field_order, labels = EXCLUDED.labels, updated_at = now()`,
      [resource, dto.hidden, dto.order, JSON.stringify(labels)],
    )
    return this.get(resource)
  }

  private check(resource: string) {
    if (!CUSTOMIZABLE[resource]) throw new NotFoundException('Este cadastro não aceita personalização')
  }
}
