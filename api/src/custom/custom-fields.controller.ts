import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { RESOURCES } from '../catalog/resources'
import { requireAdmin } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'
import { convertValue, CUSTOMIZABLE, CustomFieldsService, FIELD_TYPES, type FieldType } from './custom-fields.service'
import { MASK_PRESETS, validCustomMask } from './masks'

class FieldDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'Nome interno: letras minúsculas, números e _ (ex.: limite_credito)' }) key: string
  @IsString() @Length(2, 80, { message: 'Rótulo com 2 a 80 caracteres' }) label: string
  @IsIn(FIELD_TYPES) type: FieldType
  @IsOptional() @IsString() @MaxLength(40) mask?: string | null
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[]
  @IsOptional() @IsBoolean() required?: boolean
  @IsOptional() @IsBoolean() showInList?: boolean
  @IsOptional() @IsString() @MaxLength(200) help?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) position?: number
  @IsOptional() @IsBoolean() active?: boolean
}
class UpdateFieldDto {
  @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'Nome interno: letras minúsculas, números e _ (ex.: limite_credito)' }) key?: string
  @IsOptional() @IsIn(FIELD_TYPES) type?: FieldType
  @IsOptional() @IsString() @MaxLength(40) mask?: string | null
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
    { key: 'origin', label: 'Origem da mercadoria' }, { key: 'classTribId', label: 'cClassTrib (IBS/CBS)' }, { key: 'costPrice', label: 'Custo' }, { key: 'salePrice', label: 'Preço de venda' },
    { key: 'minStock', label: 'Estoque mínimo' },
  ],
}
const HAS_OPTIONS: string[] = ['select', 'radio', 'multiselect']
const standardFields = (resource: string) =>
  STANDARD[resource] ?? RESOURCES.find((r) => r.name === resource)?.fields.filter((f) => f.key !== 'active' && !f.hidden).map((f) => ({ key: f.key, label: f.label, required: !!f.required })) ?? []

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
    if (HAS_OPTIONS.includes(dto.type) && !options.length) throw new BadRequestException('Informe as opções')
    const mask = this.mask(dto.type, dto.mask)
    try {
      await this.db.query(
        `INSERT INTO custom_fields (resource, key, label, type, options, required, show_in_list, help, position, active, mask) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [resource, dto.key, dto.label.trim(), dto.type, options, dto.required ?? false, dto.showInList ?? false, dto.help?.trim() || null, dto.position ?? 0, dto.active ?? true, mask],
      )
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('Já existe um campo com este nome interno')
      throw error
    }
    return this.get(resource)
  }

  // Edita tudo, inclusive nome interno e tipo: os valores já gravados são renomeados e convertidos.
  @Patch(':resource/:id')
  async update(@CurrentUser() me: User, @Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFieldDto) {
    requireAdmin(me)
    this.check(resource)
    const field = await one(this.db, `SELECT key, type, options, mask FROM custom_fields WHERE id = $1 AND resource = $2`, [id, resource])
    if (!field) throw new NotFoundException('Campo não encontrado')
    const key = dto.key ?? field.key
    const type: FieldType = dto.type ?? field.type
    const options = dto.options !== undefined ? dto.options.map((o) => o.trim()).filter(Boolean) : field.options
    // Máscara só existe em texto: trocando para outro tipo, ela sai.
    const mask = type !== 'text' && dto.mask === undefined ? null : this.mask(type, dto.mask !== undefined ? dto.mask : field.mask)
    if (HAS_OPTIONS.includes(type) && !options.length) throw new BadRequestException('Informe as opções')
    if (key !== field.key) {
      if (standardFields(resource).some((f) => f.key === key)) throw new BadRequestException('Já existe um campo padrão com este nome')
      if (await one(this.db, `SELECT 1 FROM custom_fields WHERE resource = $1 AND key = $2 AND id <> $3`, [resource, key, id])) throw new ConflictException('Já existe um campo com este nome interno')
    }
    const table = CUSTOMIZABLE[resource]!.table
    await this.db.transaction(async (tx) => {
      // Converte os valores gravados para o novo tipo/opções/máscara; se algum não servir, não muda nada.
      const changedShape = type !== field.type || JSON.stringify(options) !== JSON.stringify(field.options) || mask !== field.mask
      const rows: { id: string; v: unknown }[] = await tx.query(`SELECT id, custom -> $1 AS v FROM ${table} WHERE custom ? $1`, [field.key])
      const converted: { id: string; v: unknown }[] = []
      const bad: string[] = []
      for (const r of rows) {
        if (r.v === null) continue
        try {
          converted.push({ id: r.id, v: changedShape ? convertValue(field.type, { type, options, mask }, r.v) : r.v })
        } catch (error: any) {
          if (bad.length < 3) bad.push(`"${Array.isArray(r.v) ? r.v.join(', ') : String(r.v)}" (${error.message})`)
          else bad.push('')
        }
      }
      if (bad.length) throw new BadRequestException(`${bad.length} registro(s) têm valor que não serve para o novo formato: ${bad.filter(Boolean).join('; ')}. Corrija esses registros ou mantenha o formato atual.`)
      for (const c of converted) {
        await tx.query(`UPDATE ${table} SET custom = (custom - $2::text) || jsonb_build_object($3::text, $4::jsonb) WHERE id = $1`, [c.id, field.key, key, JSON.stringify(c.v)])
      }
      if (key !== field.key) {
        await tx.query(`UPDATE form_layouts SET field_order = array_replace(field_order, $2, $3), hidden = array_replace(hidden, $2, $3),
                          labels = CASE WHEN labels ? $2 THEN (labels - $2) || jsonb_build_object($3, labels -> $2) ELSE labels END WHERE resource = $1`,
          [resource, `custom.${field.key}`, `custom.${key}`])
      }
      await tx.query(
        `UPDATE custom_fields SET key = $3, type = $4, options = $5, mask = $6, label = coalesce($7, label), required = coalesce($8, required), show_in_list = coalesce($9, show_in_list),
                help = CASE WHEN $10::boolean THEN $11 ELSE help END, position = coalesce($12, position), active = coalesce($13, active) WHERE id = $1 AND resource = $2`,
        [id, resource, key, type, options, mask, dto.label?.trim() ?? null, dto.required ?? null, dto.showInList ?? null, dto.help !== undefined, dto.help?.trim() || null, dto.position ?? null, dto.active ?? null],
      )
    })
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

  // Máscara só em texto: preset (cpf, cnpj, cep…) ou padrão com 9 (dígito), A (letra) e * (qualquer).
  private mask(type: string, mask: string | null | undefined) {
    const m = mask?.trim() || null
    if (!m) return null
    if (type !== 'text') throw new BadRequestException('Máscara só vale para campo de texto')
    if (!MASK_PRESETS[m] && !validCustomMask(m)) throw new BadRequestException('Máscara inválida: use 9 para dígito, A para letra e * para qualquer caractere (ex.: 999-AAA)')
    return m
  }

  private check(resource: string) {
    if (!CUSTOMIZABLE[resource]) throw new NotFoundException('Este cadastro não aceita personalização')
  }
}
