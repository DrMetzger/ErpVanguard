import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { isAdmin } from '../common/access'
import { digits, one } from '../common/db'
import { isValidDocument } from '../purchasing/documents'
import { ieValida, municipioPorCodigo, municipioPorNome } from '../common/br'
import type { User } from '../users/user.entity'
import { CUSTOMIZABLE, CustomFieldsService } from '../custom/custom-fields.service'
import { PRODUCT_SHEET, REF_TARGETS, resource, RESOURCES, UFS, type FieldDef, type ResourceDef } from './resources'
import { buildWorkbook, optionLabel, readWorkbook, sheetBool, sheetDate, sheetNumber, sheetOption, type SheetColumn } from '../common/sheet'
import { ensureNcm } from './ncm'
import { SettingsService } from '../settings/settings.service'
import { branchForInsert, CurrentBranch, forgetBranches, visibleIn } from '../branches/branch.context'
import { branchTable } from '../branches/branch-tables'

// Filtro de filial: nos cadastros que podem ser exclusivos, só os compartilhados e os da filial atual.
function scope(table: string, alias: string, params: unknown[], branch: string | null) {
  if (!branchTable(table)) return ''
  params.push(branch)
  return ` AND ${visibleIn(alias, params.length)}`
}

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
  private readonly log = new Logger('Planilha')
  constructor(private readonly db: DataSource, private readonly custom: CustomFieldsService, private readonly settings: SettingsService) {}

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
  async options(@Param('name') name: string, @CurrentBranch() branch: string | null, @Query('q') q?: string) {
    const target = refTarget(name)
    if (!target) throw new NotFoundException('Cadastro não encontrado')
    const search = REF_TARGETS[name]?.search ?? resource(name)!.search
    const term = q?.trim()
    const params: unknown[] = [term || null]
    const where = scope(target.table, 't', params, branch)
    return this.db.query(
      `SELECT id AS value, ${target.labelExpr} AS label FROM ${target.table} t
       WHERE ($1::text IS NULL OR ${search.map((c) => `${c}::text ILIKE '%' || $1 || '%'`).join(' OR ')})${where}
       ORDER BY 2 LIMIT 300`,
      params,
    )
  }

  @Get(':name')
  async list(@Param('name') name: string, @CurrentBranch() branch: string | null, @Query('q') q?: string) {
    const def = this.def(name)
    const term = q?.trim()
    const params: unknown[] = [term || null]
    const where = scope(def.table, 't', params, branch)
    return this.db.query(
      `SELECT ${this.select(def)} FROM ${def.table} t
       WHERE ($1::text IS NULL OR ${def.search.map((c) => `t.${c}::text ILIKE '%' || $1 || '%'`).join(' OR ')})${where}
       ORDER BY ${def.order.split(',').map((o) => `t.${o.trim()}`).join(', ')} LIMIT 1000`,
      params,
    ).then((rows) => rows.map((r: any) => this.out(def, r)))
  }

  @Post(':name')
  async create(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Body() body: Record<string, unknown>) {
    const def = this.def(name)
    this.canWrite(me, def)
    const { custom, ...rest } = body
    const values = this.values(def, rest, true)
    if (branchTable(def.table)) values.branch_id = await branchForInsert(this.db, def.table, branch)
    if (CUSTOMIZABLE[def.name]) values.custom = JSON.stringify(await this.custom.validate(def.name, custom, {}, true))
    else if (custom !== undefined) throw new BadRequestException('Este cadastro não tem campos personalizados')
    const cols = Object.keys(values)
    const row = await this.run(def, () =>
      one(this.db, `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(values)),
    )
    if (def.table === 'companies') {
      forgetBranches()
      // Primeira empresa: o estoque que estava só no produto passa a ser o saldo dela.
      await this.db.query(
        `INSERT INTO product_stock (product_id, company_id, quantity, avg_cost)
         SELECT id, $1, stock, cost_price FROM products WHERE stock <> 0 AND NOT EXISTS (SELECT 1 FROM product_stock)`, [row!.id])
    }
    return this.get(def, row!.id)
  }

  @Patch(':name/:id')
  async update(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const def = this.def(name)
    this.canWrite(me, def)
    const params: unknown[] = [id]
    const current = await one(this.db, `SELECT * FROM ${def.table} t WHERE t.id = $1${scope(def.table, 't', params, branch)}`, params)
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
    if (def.table === 'companies') forgetBranches()
    return this.get(def, id)
  }

  @Delete(':name/:id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Param('id', ParseUUIDPipe) id: string) {
    const def = this.def(name)
    this.canWrite(me, def)
    try {
      const params: unknown[] = [id]
      const rows = await this.db.query(`DELETE FROM ${def.table} t WHERE t.id = $1${scope(def.table, 't', params, branch)} RETURNING id`, params)
      if (def.table === 'companies') forgetBranches()
      if (!rows.length) throw new NotFoundException(`${def.singular} não encontrado(a)`)
    } catch (error: any) {
      if (error?.code === '23503') throw new ConflictException(`Não dá para excluir: este(a) ${def.singular} está em uso. Desative em vez de excluir.`)
      throw error
    }
  }

  // ── Importação e exportação por planilha (Excel) ──────────────────────────────

  // Modelo em branco com instruções e listas de opções.
  @Get(':name/sheet/template')
  async template(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Res() res: Response) {
    const def = this.sheetDef(name)
    this.canWrite(me, def)
    const { columns } = await this.sheetColumns(def, branch)
    this.sendXlsx(res, `modelo-${def.name}.xlsx`, await buildWorkbook(def.title, columns))
  }

  // Todos os registros no mesmo formato do modelo (dá para editar e importar de volta).
  @Get(':name/sheet/export')
  async export(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Res() res: Response) {
    const def = this.sheetDef(name)
    if (def.name === 'companies' && !isAdmin(me)) throw new ForbiddenException('Só o administrador exporta empresas')
    const { columns, customDefs } = await this.sheetColumns(def, branch)
    const params: unknown[] = []
    const where = scope(def.table, 't', params, branch).replace(' AND ', 'WHERE ')
    const rows = (await this.db.query(`SELECT ${this.select(def)} FROM ${def.table} t ${where} ORDER BY ${def.order.split(',').map((o) => `t.${o.trim()}`).join(', ')} LIMIT 50000`, params)).map((r: any) => this.out(def, r))
    const fmt = (f: FieldDef, row: any) => {
      const v = row[f.key]
      if (v === null || v === undefined || v === '') return null
      switch (f.type) {
        case 'bool': return v ? 'Sim' : 'Não'
        case 'enum': { const o = f.options!.find((x) => x.value === String(v)); return o ? optionLabel(o) : String(v) }
        case 'ref': return row[`${f.key}Label`] ?? null
        case 'date': return String(v).split('-').reverse().join('/')
        case 'int': case 'decimal': return Number(v)
        default: return String(v)
      }
    }
    const data = rows.map((row: any) => columns.map((c) => {
      if (c.key.startsWith('custom.')) {
        const v = row.custom?.[c.key.slice(7)]
        const d = customDefs.find((x) => `custom.${x.key}` === c.key)
        if (v === undefined || v === null) return null
        if (Array.isArray(v)) return v.join('; ')
        if (d?.type === 'bool') return v ? 'Sim' : 'Não'
        return v
      }
      return fmt(def.fields.find((f) => f.key === c.key)!, row)
    }))
    const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    this.sendXlsx(res, `${def.name}-${stamp}.xlsx`, await buildWorkbook(def.title, columns, data))
  }

  // Confere (commit=false) ou grava (commit=true) a planilha. Grava tudo ou nada: com erro, nada é gravado.
  @Post(':name/sheet/import')
  async import(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('name') name: string, @Body() body: { file?: string; commit?: boolean }) {
    const def = this.sheetDef(name)
    this.canWrite(me, def)
    if (typeof body?.file !== 'string' || !body.file) throw new BadRequestException('Envie a planilha')
    const buffer = Buffer.from(body.file, 'base64')
    if (buffer.length > 3.5 * 1024 * 1024) throw new BadRequestException('Planilha grande demais (máx. 3,5 MB): divida em partes')
    const { columns, customDefs, refs } = await this.sheetColumns(def, branch)
    const lines = await readWorkbook(buffer, columns)
    const newBranch = branchTable(def.table) ? await branchForInsert(this.db, def.table, branch) : undefined
    if (!lines.length) throw new BadRequestException('A planilha não tem linhas preenchidas (comece na linha 3 da aba Dados)')
    const keyFields = (def.importKey ?? [['code'], ['document'], ['cnpj'], ['sku'], ['uf']].find((k) => def.fields.some((f) => f.key === k[0])) ?? [])
      .map((k) => def.fields.find((f) => f.key === k)!).filter(Boolean)
    const results: { line: number; action: 'incluir' | 'atualizar'; label: string; errors: string[] }[] = []
    const runner = this.db.createQueryRunner()
    await runner.connect()
    await runner.startTransaction()
    const tx = runner.manager
    const seen = new Map<string, number>()
    try {
      for (const { line, values } of lines) {
        const errors: string[] = []
        const input: Record<string, unknown> = {}
        const custom: Record<string, unknown> = {}
        for (const [key, raw] of Object.entries(values)) {
          try {
            if (key.startsWith('custom.')) {
              const d = customDefs.find((x) => x.key === key.slice(7))!
              custom[d.key] = d.type === 'multiselect' ? String(raw).split(/[;,]/).map((x) => x.trim()).filter(Boolean)
                : d.type === 'bool' ? sheetBool(raw) : d.type === 'date' ? sheetDate(raw) : ['number', 'integer', 'currency'].includes(d.type) ? sheetNumber(raw) : String(raw)
              continue
            }
            const f = def.fields.find((x) => x.key === key)!
            input[key] = this.cellToValue(f, raw, refs)
          } catch (error: any) {
            errors.push(`${columns.find((c) => c.key === key)?.label ?? key}: ${error.message}`)
          }
        }
        // Já existe? Procura pelos campos-chave (código, documento, SKU…).
        let current: Record<string, any> | undefined
        const keyValues = keyFields.map((f) => { try { return input[f.key] === undefined ? undefined : this.convert(f, input[f.key]) } catch { return undefined } })
        if (keyFields.length && keyValues.every((v) => v !== undefined && v !== null)) {
          const dup = keyValues.join('|')
          if (seen.has(dup)) errors.push(`repetido na planilha (mesmo ${keyFields.map((f) => f.label).join(' + ')} da linha ${seen.get(dup)})`)
          seen.set(dup, line)
          const params: unknown[] = [...keyValues]
          current = await one(tx, `SELECT * FROM ${def.table} t WHERE ${keyFields.map((f, i) => `t.${f.column} = $${i + 1}`).join(' AND ')}${scope(def.table, 't', params, branch)}`, params)
        }
        const label = String(input.name ?? input.description ?? input[keyFields[0]?.key ?? ''] ?? `linha ${line}`)
        // Atualização: só confere e grava o que mudou (dado antigo igual ao da planilha não trava a importação).
        if (current) {
          const same = (a: unknown, b: unknown) => (a instanceof Date ? a.toISOString().slice(0, 10) : a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b))
          for (const f of def.fields) {
            if (!(f.key in input) || keyFields.includes(f)) continue
            try { if (same(current[f.column], this.convert(f, input[f.key]))) delete input[f.key] } catch { /* o erro aparece na conferência */ }
          }
          for (const [k, v] of Object.entries(custom)) if (JSON.stringify(current.custom?.[k]) === JSON.stringify(v)) delete custom[k]
        }
        if (!errors.length) {
          await runner.query('SAVEPOINT linha')
          try {
            const cols = this.values(def, input, !current, current)
            if (!current && newBranch !== undefined) cols.branch_id = newBranch
            if (CUSTOMIZABLE[def.name] && (customDefs.length || !current)) cols.custom = JSON.stringify(await this.custom.validate(def.name, custom, current?.custom ?? {}, !current, tx))
            const names = Object.keys(cols)
            if (current) {
              if (names.length) await tx.query(`UPDATE ${def.table} SET ${names.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [current.id, ...Object.values(cols)])
            } else {
              await tx.query(`INSERT INTO ${def.table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols))
            }
            await runner.query('RELEASE SAVEPOINT linha')
          } catch (error: any) {
            await runner.query('ROLLBACK TO SAVEPOINT linha')
            const custom = error?.constraint && def.constraints?.[error.constraint]
            errors.push(custom || (error?.code === '23505' ? 'já existe um registro com este código' : error?.code === '23503' ? 'registro relacionado não encontrado' : error?.response?.message ?? error.message))
          }
        }
        results.push({ line, action: current ? 'atualizar' : 'incluir', label, errors })
      }
      const failed = results.filter((r) => r.errors.length)
      if (body.commit && !failed.length) {
        await runner.commitTransaction()
        this.log.log(`${def.name}: ${results.length} linha(s) importada(s) por ${me.email}`)
        if (def.name === 'products') for (const ncm of new Set(lines.map((l) => String(l.values.ncm ?? '').replace(/\D/g, '')).filter((n) => n.length === 8))) void ensureNcm(this.db, ncm, () => this.settings.gemini())
      } else {
        await runner.rollbackTransaction()
      }
      return {
        committed: !!body.commit && !failed.length, total: results.length,
        create: results.filter((r) => r.action === 'incluir').length, update: results.filter((r) => r.action === 'atualizar').length,
        errors: failed.length, rows: results.slice(0, 2000),
      }
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  // ── Sincronização do app do celular: só o que mudou desde a última vez ──────────────
  // Cursor = (updated_at, id) da última linha recebida; a primeira página também traz as exclusões.
  @Get(':name/sync')
  async sync(@Param('name') name: string, @CurrentBranch() branch: string | null, @Query('since') since?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    const n = Math.min(5000, Math.max(100, Number(limit) || 2000))
    const from = since && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/.test(since) ? since : '1970-01-01 00:00:00+00'
    if (name === 'price-table-items') {
      const rows = await this.db.query(
        `SELECT i.price_table_id::text || ':' || i.product_id::text AS id, i.price_table_id AS "priceTableId", i.product_id AS "productId", i.price, i.updated_at::text AS "_at"
         FROM price_table_items i
         WHERE i.updated_at > $1::timestamptz OR (i.updated_at = $1::timestamptz AND i.price_table_id::text || ':' || i.product_id::text > $2)
         ORDER BY i.updated_at, 1 LIMIT $3`, [from, after ?? '', n])
      rows.forEach((r: any) => { r.price = Number(r.price) })
      return this.syncPage('price_table_items', rows, n, from, after)
    }
    const def = name === 'products' ? PRODUCT_SHEET : this.def(name)
    const params: unknown[] = [from, after ?? '', n]
    const where = scope(def.table, 't', params, branch)
    const rows = await this.db.query(
      `SELECT ${this.select(def)}, t.updated_at::text AS "_at", (${def.labelExpr}) AS "_label",
              lower(concat_ws(' ', ${def.search.map((c) => `t.${c}::text`).join(', ')})) AS "_search", t.${def.order.split(',')[0]!.trim().split(' ')[0]}::text AS "_sort"
       FROM ${def.table} t
       WHERE (t.updated_at > $1::timestamptz OR (t.updated_at = $1::timestamptz AND t.id::text > $2))${where}
       ORDER BY t.updated_at, t.id LIMIT $3`, params)
    return this.syncPage(def.table, rows.map((r: any) => this.out(def, r)), n, from, after)
  }

  private async syncPage(table: string, rows: any[], n: number, since: string, after?: string) {
    const deleted = after ? [] : (await this.db.query(`SELECT row_key FROM sync_deletions WHERE tbl = $1 AND deleted_at > $2::timestamptz`, [table, since])).map((r: any) => r.row_key)
    const last = rows.at(-1)
    // Terminou: o próximo começa um pouco antes de agora (cobre gravações que estavam em andamento).
    const [{ safe }] = await this.db.query(`SELECT (now() - interval '2 minutes')::text AS safe`)
    return { rows, deleted, next: rows.length === n ? { since: last._at, after: last.id } : null, resume: safe }
  }

  private sheetDef(name: string) {
    return name === 'products' ? PRODUCT_SHEET : this.def(name)
  }

  private sendXlsx(res: Response, file: string, buffer: Buffer) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
    res.send(buffer)
  }

  // Colunas da planilha: campos do cadastro (menos os internos) + campos personalizados.
  private async sheetColumns(def: ResourceDef, branch: string | null) {
    const TYPE: Record<string, string> = { text: 'Texto', int: 'Número inteiro', decimal: 'Número', bool: 'Sim/Não', date: 'Data', enum: 'Lista', ref: 'Lista', uf: 'UF',
      document: 'CPF/CNPJ', phone: 'Telefone', zip: 'CEP', city: 'Cidade', ie: 'Inscrição estadual' }
    const refs: Record<string, { byLabel: Map<string, string>; byCode: Map<string, string> }> = {}
    const columns: SheetColumn[] = []
    for (const f of def.fields.filter((x) => !x.hidden && x.type !== 'json')) {
      const col: SheetColumn = { key: f.key, label: f.label, required: f.required && f.default === undefined, type: TYPE[f.type] ?? f.type }
      const help: string[] = []
      if (f.help) help.push(f.help)
      if (f.max && f.type === 'text') help.push(`até ${f.max} caracteres`)
      if (f.patternMessage) help.push(f.patternMessage)
      if (f.type === 'enum') col.options = f.options!.map(optionLabel)
      if (f.type === 'uf') col.options = UFS
      if (f.type === 'bool') { col.options = ['Sim', 'Não']; if (f.default !== undefined) help.push(`em branco = ${f.default ? 'Sim' : 'Não'}`) }
      if (f.type === 'date') { help.push('dd/mm/aaaa'); col.example = '31/12/2026' }
      if (f.type === 'document') { help.push('só números ou com pontuação'); col.example = '11.222.333/0001-81' }
      if (f.type === 'phone') { help.push('DDD + número'); col.example = '(17) 99999-0000' }
      if (f.type === 'zip') col.example = '15015-100'
      if (f.type === 'city') help.push('nome oficial do município (IBGE); a UF precisa estar preenchida')
      if (f.type === 'ie') help.push('só números ou ISENTO; conferida pela regra da UF')
      if (f.type === 'decimal') { help.push('use vírgula para decimais'); col.example = '1.234,56' }
      if (f.type === 'ref') {
        const target = refTarget(f.ref!)!
        const code = (REF_TARGETS[f.ref!]?.search ?? resource(f.ref!)?.search ?? ['id'])[0]
        const params: unknown[] = []
        const where = scope(target.table, 't', params, branch).replace(' AND ', 'WHERE ')
        const list: { id: string; label: string; code: string }[] = await this.db.query(`SELECT id, ${target.labelExpr} AS label, ${code}::text AS code FROM ${target.table} t ${where} ORDER BY 2 LIMIT 5000`, params)
        refs[f.key] = { byLabel: new Map(list.map((r) => [r.label.toLowerCase(), r.id])), byCode: new Map(list.map((r) => [String(r.code).toLowerCase(), r.id])) }
        if (list.length <= 1000) col.options = list.map((r) => r.label)
        help.push('escolha da lista (ou digite o código)')
      }
      if (f.default !== undefined && f.type !== 'bool') help.push(`em branco = ${f.type === 'enum' ? optionLabel(f.options!.find((o) => o.value === String(f.default))!) : f.default}`)
      col.help = help.join('; ')
      columns.push(col)
    }
    const customDefs = CUSTOMIZABLE[def.name] ? await this.custom.definitions(def.name) : []
    for (const d of customDefs) {
      columns.push({ key: `custom.${d.key}`, label: d.label, required: d.required, type: `Personalizado (${d.type})`,
        options: ['select', 'radio'].includes(d.type) ? d.options : d.type === 'bool' ? ['Sim', 'Não'] : undefined,
        help: [d.help, d.type === 'multiselect' ? `separe por ; (opções: ${d.options.join(', ')})` : '', d.type === 'date' ? 'dd/mm/aaaa' : ''].filter(Boolean).join('; ') })
    }
    return { columns, customDefs, refs }
  }

  // Célula da planilha → valor aceito pelo cadastro (o resto da conferência é a mesma da tela).
  private cellToValue(f: FieldDef, raw: unknown, refs: Record<string, { byLabel: Map<string, string>; byCode: Map<string, string> }>): unknown {
    const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim()
    switch (f.type) {
      case 'bool': return sheetBool(raw)
      case 'int': case 'decimal': return sheetNumber(raw)
      case 'date': return sheetDate(raw)
      case 'enum': return sheetOption(raw, f.options!)
      case 'uf': return text.toUpperCase()
      case 'ref': {
        const r = refs[f.key]!
        const id = r.byLabel.get(text.toLowerCase()) ?? r.byCode.get(text.split(' · ')[0]!.trim().toLowerCase())
        if (!id) throw new Error(`"${text}" não encontrado no cadastro`)
        return id
      }
      case 'document': { const d = digits(text); return d.length > 11 ? d.padStart(14, '0') : d.padStart(11, '0') }
      case 'zip': return digits(text).padStart(8, '0')
      default: return typeof raw === 'number' ? String(raw) : text
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
    this.address(def, out, current)
    // Empresa: o CRT da nota sai do regime tributário.
    if (def.name === 'companies' && out.tax_regime) out.crt = { simples: '1', simples_excesso: '2', mei: '4' }[out.tax_regime as string] ?? '3'
    const rule = RULES[def.name]
    const message = rule?.({ ...(current ?? {}), ...out })
    if (message) throw new BadRequestException(message)
    return out
  }

  // Cidade com código IBGE (vai no XML da nota) e inscrição estadual conferida pela UF.
  private address(def: ResourceDef, out: Record<string, any>, current?: Record<string, any>) {
    const has = (t: string) => def.fields.some((f) => f.type === t)
    const val = (col: string) => (col in out ? out[col] : current?.[col] ?? null)
    if (has('city') && ('city' in out || 'uf' in out || 'city_code' in out)) {
      const city = val('city'), uf = val('uf')
      if (!city) out.city_code = null
      else {
        if (!uf) throw new BadRequestException('Informe a UF antes da cidade')
        const byCode = out.city_code ? municipioPorCodigo(out.city_code) : undefined
        const m = byCode && byCode.uf === uf ? byCode : municipioPorNome(uf, city)
        if (!m) throw new BadRequestException(`Cidade "${city}" não encontrada em ${uf} (lista do IBGE)`)
        out.city = m.name
        out.city_code = m.code
      }
    }
    if (has('ie') && ('ie' in out || 'uf' in out)) {
      const ie = val('ie'), uf = val('uf')
      if (ie) {
        if (!uf) throw new BadRequestException('Informe a UF para conferir a inscrição estadual')
        if (!ieValida(ie, uf)) throw new BadRequestException(`Inscrição estadual inválida para ${uf}`)
      }
    }
    if ('taxpayer' in out || 'ie' in out) {
      const taxpayer = val('taxpayer'), ie = val('ie')
      if (taxpayer === '1' && (!ie || ie === 'ISENTO')) throw new BadRequestException('Contribuinte de ICMS precisa da inscrição estadual')
    }
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
      case 'phone': {
        const d = digits(String(v))
        if (!d) return null
        if (d.length < 10 || d.length > 11) fail('use DDD + número (10 ou 11 dígitos)')
        return d
      }
      case 'zip': {
        const d = digits(String(v))
        if (!d) return null
        if (d.length !== 8) fail('CEP com 8 dígitos')
        return d
      }
      case 'city':
        if (typeof v !== 'string') fail('cidade inválida')
        return (v as string).trim() || null
      case 'ie': {
        if (typeof v !== 'string') fail('inscrição inválida')
        const s = (v as string).trim().toUpperCase()
        if (!s) return null
        if (s === 'ISENTO') return s
        const d = digits(s)
        if (!d || d.length > 14) fail('use só números ou ISENTO')
        return d
      }
      case 'json':
        if (typeof v !== 'object' || Array.isArray(v)) fail('dados inválidos')
        if (JSON.stringify(v).length > 20000) fail('dados grandes demais')
        return JSON.stringify(v)
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
