import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { isAdmin } from '../common/access'
import { numbers, one } from '../common/db'
import { resolveFiscal } from './fiscal'
import { ParametersService } from '../params/parameters.service'
import { computeTaxes, loadTaxContext } from '../taxes/tax-engine'
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

  // ---- Matriz fiscal: qual TES e CFOP usar numa operação; com produto e valor, também os impostos
  @Post('fiscal/resolve')
  async resolve(@Body() dto: ResolveDto) {
    const result = await resolveFiscal(this.db, dto, (await this.settings.company()).uf)
    if (!result) throw new NotFoundException('Nenhuma regra da matriz fiscal atende esta operação')
    if (!dto.productId || !dto.amount) return result
    const company = await one(this.db, `SELECT id FROM companies WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`, [dto.companyId ?? null])
    if (!company) return result
    const p = (await one(this.db, `SELECT id, ncm, type_id, group_id, origin FROM products WHERE id = $1`, [dto.productId]))!
    const ctx = await loadTaxContext(this.db, this.params, { companyId: company.id, destUf: dto.uf ?? null, taxpayer: dto.taxpayer ?? '9', operationTypeId: dto.operationTypeId, date: new Date().toISOString().slice(0, 10) })
    const taxes = computeTaxes(ctx, [{ key: '0', productId: p.id, ncm: p.ncm, typeId: p.type_id, groupId: p.group_id, origin: Number(p.origin), cfop: result.cfop, amount: dto.amount }], dto.freight ?? 0, 0)
    return { ...result, regime: ctx.regime, taxes: taxes.items[0]!.taxes, totals: taxes.totals, warnings: taxes.warnings }
  }
}
