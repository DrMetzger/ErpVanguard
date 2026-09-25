import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { isAdmin } from '../common/access'
import { digits, one } from '../common/db'
import { isValidDocument } from '../purchasing/documents'
import type { User } from '../users/user.entity'
import { CUSTOMIZABLE, CustomFieldsService } from '../custom/custom-fields.service'
import { REF_TARGETS, resource, RESOURCES, UFS, type FieldDef, type ResourceDef } from './resources'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refTarget(name: string) {
  const r = resource(name)
  return r ? { table: r.table, labelExpr: r.labelExpr } : REF_TARGETS[name]
}

// Regras de negócio além do formato de cada campo.
const RULES: Record<string, (row: Record<string, any>) => string | null> = {
  tes: (row) => {
    const n = Number(row.code)
    if (row.kind === 'E' && n >= 500) return 'TES de entrada usa códigos de 001 a 499'
    if (row.kind === 'S' && n < 500) return 'TES de saída usa códigos de 500 a 999'
    for (const cfop of [row.cfop_internal, row.cfop_interstate].filter(Boolean)) {
      const entrada = ['1', '2', '3'].includes(cfop[0])
      if ((row.kind === 'E') !== entrada) return `CFOP ${cfop} não é de ${row.kind === 'E' ? 'entrada' : 'saída'}`
    }
    return null
  },
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly db: DataSource, private readonly custom: CustomFieldsService) {}

  // Descrição das telas (campos, rótulos, tipos) para o front montar formulários e tabelas.
  @Get('meta')
  meta() {
    return RESOURCES.map(({ table: _t, labelExpr: _l, search: _s, order: _o, fields, ...r }) => ({
      ...r,
      customizable: !!CUSTOMIZABLE[r.name],
      fields: fields.map(({ column: _c, ...f }) => (f.type === 'uf' ? { ...f, options: UFS.map((u) => ({ value: u, label: u })) } : f)),
    }))
  }

  // Opções para campos de seleção (ativos primeiro).
  @Get(':name/options')
  async options(@Param('name') name: string, @Query('q') q?: string) {
    const target = refTarget(name)
    if (!target) throw new NotFoundException('Cadastro não encontrado')
    const search = REF_TARGETS[name]?.search ?? resource(name)!.search
    const term = q?.trim()
    return this.db.query(
      `SELECT id AS value, ${target.labelExpr} AS label FROM ${target.table}
       WHERE ($1::text IS NULL OR ${search.map((c) => `${c}::text ILIKE '%' || $1 || '%'`).join(' OR ')})
       ORDER BY 2 LIMIT 300`,
      [term || null],
    )
  }

  @Get(':name')
  async list(@Param('name') name: string, @Query('q') q?: string) {
    const def = this.def(name)
    const term = q?.trim()
    return this.db.query(
      `SELECT ${this.select(def)} FROM ${def.table} t
       WHERE ($1::text IS NULL OR ${def.search.map((c) => `t.${c}::text ILIKE '%' || $1 || '%'`).join(' OR ')})
       ORDER BY ${def.order.split(',').map((o) => `t.${o.trim()}`).join(', ')} LIMIT 1000`,
      [term || null],
    ).then((rows) => rows.map((r: any) => this.out(def, r)))
  }

  @Post(':name')
  async create(@CurrentUser() me: User, @Param('name') name: string, @Body() body: Record<string, unknown>) {
    const def = this.def(name)
    this.canWrite(me, def)
    const { custom, ...rest } = body
    const values = this.values(def, rest, true)
    if (CUSTOMIZABLE[def.name]) values.custom = JSON.stringify(await this.custom.validate(def.name, custom, {}, true))
    else if (custom !== undefined) throw new BadRequestException('Este cadastro não tem campos personalizados')
    const cols = Object.keys(values)
    const row = await this.run(def, () =>
      one(this.db, `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(values)),
    )
    return this.get(def, row!.id)
  }

  @Patch(':name/:id')
  async update(@CurrentUser() me: User, @Param('name') name: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const def = this.def(name)
    this.canWrite(me, def)
    const current = await one(this.db, `SELECT * FROM ${def.table} WHERE id = $1`, [id])
    if (!current) throw new NotFoundException(`${def.singular} não encontrado(a)`)
    const { custom, ...rest } = body
    const values = this.values(def, rest, false, current)
    if (custom !== undefined) {
      if (!CUSTOMIZABLE[def.name]) throw new BadRequestException('Este cadastro não tem campos personalizados')
      values.custom = JSON.stringify(await this.custom.validate(def.name, custom, current.custom ?? {}))
    }
    const cols = Object.keys(values)
    if (cols.length) {
      await this.run(def, () => this.db.query(`UPDATE ${def.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(values)]))
    }
    return this.get(def, id)
  }

  @Delete(':name/:id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @Param('name') name: string, @Param('id', ParseUUIDPipe) id: string) {
    const def = this.def(name)
    this.canWrite(me, def)
    try {
      const rows = await this.db.query(`DELETE FROM ${def.table} WHERE id = $1 RETURNING id`, [id])
      if (!rows.length) throw new NotFoundException(`${def.singular} não encontrado(a)`)
    } catch (error: any) {
      if (error?.code === '23503') throw new ConflictException(`Não dá para excluir: este(a) ${def.singular} está em uso. Desative em vez de excluir.`)
      throw error
    }
  }

  private def(name: string) {
    const def = resource(name)
    if (!def) throw new NotFoundException('Cadastro não encontrado')
    return def
  }

  private canWrite(me: User, def: ResourceDef) {
    if (!isAdmin(me) && !def.write.some((p) => me.permissions.includes(p))) {  // write vazio = só administrador
      throw new ForbiddenException(`Seu usuário não pode alterar ${def.title.toLowerCase()}`)
    }
  }

  private select(def: ResourceDef) {
    const cols = ['t.id', ...def.fields.map((f) => `t.${f.column} AS "${f.key}"`), ...(CUSTOMIZABLE[def.name] ? ['t.custom'] : [])]
    for (const f of def.fields.filter((f) => f.type === 'ref')) {
      const target = refTarget(f.ref!)!
      cols.push(`(SELECT ${target.labelExpr} FROM ${target.table} r WHERE r.id = t.${f.column}) AS "${f.key}Label"`)
    }
    return cols.join(', ')
  }

  private out(def: ResourceDef, row: any) {
    for (const f of def.fields) {
      if (f.type === 'decimal' && row[f.key] !== null) row[f.key] = Number(row[f.key])
      if (f.type === 'date' && row[f.key] instanceof Date) row[f.key] = row[f.key].toISOString().slice(0, 10)
    }
    return row
  }

  private async get(def: ResourceDef, id: string) {
    return this.out(def, await one(this.db, `SELECT ${this.select(def)} FROM ${def.table} t WHERE t.id = $1`, [id]))
  }

  // Valida e converte o corpo recebido para colunas do banco.
  private values(def: ResourceDef, body: Record<string, unknown>, creating: boolean, current?: Record<string, any>) {
    const unknown = Object.keys(body).filter((k) => !def.fields.some((f) => f.key === k))
    if (unknown.length) throw new BadRequestException(`Campo(s) desconhecido(s): ${unknown.join(', ')}`)
    const out: Record<string, unknown> = {}
    for (const f of def.fields) {
      let v = body[f.key]
      if (v === undefined) {
        if (!creating) continue
        v = f.default ?? null
      }
      out[f.column] = this.convert(f, v)
      if (f.required && (out[f.column] === null || out[f.column] === '')) throw new BadRequestException(`Informe ${f.label}`)
    }
    // Empresa: o CRT da nota sai do regime tributário.
    if (def.name === 'companies' && out.tax_regime) out.crt = { simples: '1', simples_excesso: '2', mei: '4' }[out.tax_regime as string] ?? '3'
    const rule = RULES[def.name]
    const message = rule?.({ ...(current ?? {}), ...out })
    if (message) throw new BadRequestException(message)
    return out
  }

  private convert(f: FieldDef, v: unknown): unknown {
    const fail = (msg: string) => { throw new BadRequestException(`${f.label}: ${msg}`) }
    if (v === null || v === '') return f.type === 'bool' ? false : null
    switch (f.type) {
      case 'text': {
        if (typeof v !== 'string') return fail('texto inválido')
        let s = v.trim()
        if (f.upper) s = s.toUpperCase()
        if (!s) return null
        if (f.max && s.length > f.max) fail(`máximo de ${f.max} caracteres`)
        if (f.pattern && !new RegExp(f.pattern).test(s)) fail(f.patternMessage ?? 'formato inválido')
        return s
      }
      case 'int':
      case 'decimal': {
        const n = Number(v)
        if (!Number.isFinite(n) || (f.type === 'int' && !Number.isInteger(n))) fail('número inválido')
        return n
      }
      case 'bool':
        if (typeof v !== 'boolean') fail('use verdadeiro ou falso')
        return v
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('data inválida')
        return v
      case 'enum':
        if (!f.options!.some((o) => o.value === v)) fail('opção inválida')
        return v
      case 'uf':
        if (typeof v !== 'string' || !UFS.includes(v.toUpperCase())) fail('UF inválida')
        return (v as string).toUpperCase()
      case 'document': {
        const d = digits(String(v))
        if (!isValidDocument(d)) fail('CPF/CNPJ inválido')
        return d
      }
      case 'ref':
        if (typeof v !== 'string' || !UUID.test(v)) fail('seleção inválida')
        return v
    }
  }

  private async run<T>(def: ResourceDef, fn: () => Promise<T>) {
    try {
      return await fn()
    } catch (error: any) {
      const custom = error?.constraint && def.constraints?.[error.constraint]
      if (custom) throw new ConflictException(custom)
      if (error?.code === '23505') throw new ConflictException('Já existe um registro com este código')
      if (error?.code === '23503') throw new BadRequestException('Registro relacionado não encontrado')
      throw error
    }
  }
}
