import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { isAdmin } from '../common/access'
import { numbers, one } from '../common/db'
import { resolveFiscal } from './fiscal'
import { fillNcm } from './ncm'
import { ParametersService } from '../params/parameters.service'
import { computeTaxes, loadTaxContext } from '../taxes/tax-engine'
import { decodeCsv, readClassTribCsv, upsertClassTrib } from '../taxes/class-trib'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'
import { allowedBranches, branchList, CurrentBranch } from '../branches/branch.context'

class PriceItemDto {
  @IsUUID() productId: string
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) price: number
}
class PriceItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PriceItemDto) items: PriceItemDto[]
}
class ResolveDto {
  @IsUUID() operationTypeId: string
  @IsOptional() @IsUUID() companyId?: string
  @IsOptional() @IsString() uf?: string
  @IsOptional() @IsIn(['1', '2', '9']) taxpayer?: string
  @IsOptional() @IsUUID() productId?: string
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) freight?: number
}

const canEdit = (me: User, ...perms: string[]) => isAdmin(me) || perms.some((p) => me.permissions.includes(p as never))

@Controller()
export class ExtrasController {
  constructor(private readonly db: DataSource, private readonly settings: SettingsService, private readonly params: ParametersService) {}

  // ---- Itens da tabela de preço
  @Get('catalog/price-tables/:id/items')
  async priceItems(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db.query(
      `SELECT i.product_id AS "productId", p.sku, p.name, p.unit, p.cost_price AS "costPrice", i.price
       FROM price_table_items i JOIN products p ON p.id = i.product_id WHERE i.price_table_id = $1 ORDER BY p.name`,
      [id],
    )
    return rows.map((r: any) => numbers(r, 'price', 'costPrice'))
  }

  @Put('catalog/price-tables/:id/items')
  async savePriceItems(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceItemsDto) {
    if (!canEdit(me, 'cadastro')) throw new ForbiddenException('Seu usuário não pode alterar tabelas de preço')
    if (!(await one(this.db, `SELECT 1 FROM price_tables WHERE id = $1`, [id]))) throw new NotFoundException('Tabela não encontrada')
    if (new Set(dto.items.map((i) => i.productId)).size !== dto.items.length) throw new BadRequestException('Produto repetido na tabela')
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM price_table_items WHERE price_table_id = $1`, [id])
      for (const item of dto.items) {
        await tx.query(`INSERT INTO price_table_items (price_table_id, product_id, price) VALUES ($1, $2, $3)`, [id, item.productId, item.price])
      }
    })
    return this.priceItems(id)
  }

  // ---- Estoque: movimentações
  @Get('stock/movements')
  async movements(@CurrentBranch() branch: string | null, @Query('productId') productId?: string) {
    const rows = await this.db.query(
      `SELECT m.id, m.quantity, m.unit_cost AS "unitCost", m.kind, m.reference, m.created_at AS "createdAt",
              p.sku, p.name AS "productName", p.unit, u.name AS "userName", co.code AS "companyCode"
       FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id LEFT JOIN companies co ON co.id = m.company_id
       WHERE ($1::uuid IS NULL OR m.product_id = $1) AND ($2::uuid IS NULL OR m.company_id = $2) ORDER BY m.created_at DESC LIMIT 500`,
      [productId || null, branch],
    )
    return rows.map((r: any) => numbers(r, 'quantity', 'unitCost'))
  }

  // ---- Estoque: saldo do produto em cada filial liberada para o usuário
  @Get('stock/branches')
  async stockByBranch(@CurrentUser() me: User, @Query('productId', ParseUUIDPipe) productId: string) {
    const allowed = allowedBranches(me, await branchList(this.db))
    const rows = await this.db.query(`SELECT company_id AS "companyId", quantity, avg_cost AS "avgCost" FROM product_stock WHERE product_id = $1`, [productId])
    return allowed.map((b) => {
      const r = rows.find((x: any) => x.companyId === b.id)
      return { companyId: b.id, label: `${b.code} · ${b.tradeName || b.name}`, quantity: Number(r?.quantity ?? 0), avgCost: Number(r?.avgCost ?? 0) }
    })
  }

  // ---- Matriz fiscal: qual TES e CFOP usar numa operação; com produto e valor, também os impostos
  @Post('fiscal/resolve')
  async resolve(@Body() dto: ResolveDto) {
    const result = await resolveFiscal(this.db, dto, (await this.settings.company()).uf)
    if (!result) throw new NotFoundException('Nenhuma regra da matriz fiscal atende esta operação')
    if (!dto.productId || !dto.amount) return result
    const company = await one(this.db, `SELECT id FROM companies WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`, [dto.companyId ?? null])
    if (!company) return result
    const p = (await one(this.db, `SELECT id, ncm, type_id, group_id, origin, class_trib_id FROM products WHERE id = $1`, [dto.productId]))!
    const ctx = await loadTaxContext(this.db, this.params, { companyId: company.id, destUf: dto.uf ?? null, taxpayer: dto.taxpayer ?? '9', operationTypeId: dto.operationTypeId, date: new Date().toISOString().slice(0, 10) })
    const taxes = computeTaxes(ctx, [{ key: '0', productId: p.id, ncm: p.ncm, typeId: p.type_id, groupId: p.group_id, origin: Number(p.origin), cfop: result.cfop, amount: dto.amount, tesId: result.tes.id, classTribId: p.class_trib_id }], dto.freight ?? 0, 0)
    return { ...result, regime: ctx.regime, taxes: taxes.items[0]!.taxes, totals: taxes.totals, warnings: taxes.warnings }
  }

  // ---- NCM cadastrado sozinho: busca a descrição oficial com a IA
  @Post('catalog/ncm/:id/describe')
  async describeNcm(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    if (!canEdit(me, 'cadastro', 'fiscal')) throw new ForbiddenException('Seu usuário não pode alterar o cadastro de NCM')
    const row = await one(this.db, `SELECT code, pending FROM ncm WHERE id = $1`, [id])
    if (!row) throw new NotFoundException('NCM não encontrado')
    if (!row.pending) throw new BadRequestException('Este NCM já tem descrição')
    const result = await fillNcm(this.db, row.code, await this.settings.gemini())
    if (!result.ok) throw new BadRequestException(`Não foi possível buscar a descrição: ${result.reason}`)
    return numbers((await one(this.db, `SELECT id, code, description, ipi_rate AS "ipiRate", pending, source FROM ncm WHERE id = $1`, [id]))!, 'ipiRate')
  }

  // ---- cClassTrib (IBS/CBS): situação da tabela e atualização pelo CSV oficial da Receita
  @Get('catalog/class-trib/official')
  async classTribInfo() {
    const r = (await one(this.db, `SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active, max(source_date)::text AS "sourceDate", max(updated_at) AS "updatedAt" FROM class_trib`))!
    return r
  }

  @Post('catalog/class-trib/official/import')
  async classTribImport(@CurrentUser() me: User, @Body() body: { file?: string; commit?: boolean }) {
    if (!canEdit(me, 'fiscal')) throw new ForbiddenException('Seu usuário não pode alterar a tabela de classificação tributária')
    if (typeof body?.file !== 'string' || !body.file) throw new BadRequestException('Envie o arquivo CSV da tabela cClassTrib')
    const buffer = Buffer.from(body.file, 'base64')
    if (buffer.length > 4 * 1024 * 1024) throw new BadRequestException('Arquivo grande demais (máx. 4 MB)')
    let parsed: ReturnType<typeof readClassTribCsv>
    try { parsed = readClassTribCsv(decodeCsv(buffer)) } catch (e) { throw new BadRequestException((e as Error).message) }
    if (!parsed.rows.length) throw new BadRequestException('Nenhuma classificação encontrada no arquivo')
    const existing = new Map<string, any>((await this.db.query(`SELECT code, cst, name, p_red_ibs, p_red_cbs, aliquot_type FROM class_trib`)).map((r: any) => [r.code, r]))
    const changes = parsed.rows.map((r) => {
      const old = existing.get(r.code)
      const diff = !old ? [] : [
        old.cst !== r.cst && `CST ${old.cst} → ${r.cst}`,
        (Number(old.p_red_ibs) !== r.pRedIbs || Number(old.p_red_cbs) !== r.pRedCbs) && `redução ${Number(old.p_red_ibs)}/${Number(old.p_red_cbs)}% → ${r.pRedIbs}/${r.pRedCbs}%`,
        old.aliquot_type !== r.aliquotType && `alíquota ${old.aliquot_type} → ${r.aliquotType}`,
        old.name !== r.name && 'nome',
      ].filter(Boolean) as string[]
      return { code: r.code, cst: r.cst, name: r.name, action: old ? (diff.length ? 'alterar' : 'igual') : 'incluir', changes: diff }
    })
    const summary = {
      total: parsed.rows.length, create: changes.filter((c) => c.action === 'incluir').length, update: changes.filter((c) => c.action === 'alterar').length,
      same: changes.filter((c) => c.action === 'igual').length, missing: [...existing.keys()].filter((k) => !parsed.rows.some((r) => r.code === k)),
      sourceDate: parsed.rows.map((r) => r.sourceDate).filter(Boolean).sort().at(-1) ?? null, errors: parsed.errors,
      rows: changes.filter((c) => c.action !== 'igual'),
    }
    if (!body.commit || parsed.errors.length) return { committed: false, ...summary }
    await this.db.transaction((tx) => upsertClassTrib(tx, parsed.rows))
    return { committed: true, ...summary }
  }
}
