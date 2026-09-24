import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { isAdmin } from '../common/access'
import { numbers, one } from '../common/db'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'

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
}

const canEdit = (me: User, ...perms: string[]) => isAdmin(me) || perms.some((p) => me.permissions.includes(p as never))

@Controller()
export class ExtrasController {
  constructor(private readonly db: DataSource, private readonly settings: SettingsService) {}

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
  async movements(@Query('productId') productId?: string) {
    const rows = await this.db.query(
      `SELECT m.id, m.quantity, m.unit_cost AS "unitCost", m.kind, m.reference, m.created_at AS "createdAt",
              p.sku, p.name AS "productName", p.unit, u.name AS "userName"
       FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
       WHERE ($1::uuid IS NULL OR m.product_id = $1) ORDER BY m.created_at DESC LIMIT 500`,
      [productId || null],
    )
    return rows.map((r: any) => numbers(r, 'quantity', 'unitCost'))
  }

  // ---- Matriz fiscal: qual TES e CFOP usar numa operação
  @Post('fiscal/resolve')
  async resolve(@Body() dto: ResolveDto) {
    // UF de origem: filial informada, senão a matriz (ou a primeira empresa), senão Configurações.
    const branch = await one(
      this.db,
      `SELECT code, uf FROM companies WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`,
      [dto.companyId ?? null],
    )
    if (dto.companyId && !branch) throw new NotFoundException('Empresa/filial não encontrada')
    const companyUf = branch?.uf ?? (await this.settings.company()).uf
    const product = dto.productId
      ? await one(this.db, `SELECT type_id, group_id, ncm FROM products WHERE id = $1`, [dto.productId])
      : undefined
    if (dto.productId && !product) throw new NotFoundException('Produto não encontrado')

    // Vence a regra mais específica (mais campos preenchidos, NCM mais longo).
    const rules = await this.db.query(
      `SELECT m.*, t.code AS tes_code, t.description AS tes_description, t.cfop_internal, t.cfop_interstate, t.updates_stock, t.generates_financial
       FROM fiscal_matrix m JOIN tes t ON t.id = m.tes_id
       WHERE m.active AND t.active AND m.operation_type_id = $1
         AND (m.uf IS NULL OR m.uf = $2)
         AND (m.taxpayer IS NULL OR m.taxpayer = $3)
         AND (m.product_type_id IS NULL OR m.product_type_id = $4)
         AND (m.product_group_id IS NULL OR m.product_group_id = $5)
         AND (m.ncm_prefix IS NULL OR $6 LIKE m.ncm_prefix || '%')`,
      [dto.operationTypeId, dto.uf?.toUpperCase() ?? null, dto.taxpayer ?? null, product?.type_id ?? null, product?.group_id ?? null, product?.ncm ?? ''],
    )
    const score = (r: any) =>
      ['uf', 'taxpayer', 'product_type_id', 'product_group_id'].filter((k) => r[k] !== null).length * 10 + (r.ncm_prefix?.length ?? 0)
    const best = rules.sort((a: any, b: any) => score(b) - score(a))[0]
    if (!best) throw new NotFoundException('Nenhuma regra da matriz fiscal atende esta operação')
    const interstate = !!dto.uf && dto.uf.toUpperCase() !== companyUf
    return {
      tes: { id: best.tes_id, code: best.tes_code, description: best.tes_description },
      cfop: interstate && best.cfop_interstate ? best.cfop_interstate : best.cfop_internal,
      interstate,
      updatesStock: best.updates_stock,
      generatesFinancial: best.generates_financial,
      rule: best.notes,
      companyUf,
    }
  }
}
