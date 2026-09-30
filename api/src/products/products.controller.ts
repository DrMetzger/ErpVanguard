import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, QueryFailedError, Repository } from 'typeorm'
import { branchForInsert, CurrentBranch } from '../branches/branch.context'
import { branchStock, branchStocks, moveStock } from '../stock/stock'
import { CurrentUser } from '../auth/current-user.decorator'
import { ensureNcm } from '../catalog/ncm'
import { requirePermission } from '../common/access'
import type { User } from '../users/user.entity'
import { CustomFieldsService } from '../custom/custom-fields.service'
import { SettingsService } from '../settings/settings.service'
import { CreateProductDto, UpdateProductDto } from './product.dto'
import { removeVideoFile } from './product-videos.controller'
import { Product } from './product.entity'

const UNIQUE_VIOLATION = '23505'

@Controller('products')
export class ProductsController {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly custom: CustomFieldsService,
    private readonly db: DataSource,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async list(@CurrentBranch() branch: string | null, @Query('q') q?: string) {
    const term = q?.trim()
    const qb = this.products.createQueryBuilder('p').where('(p.branch_id IS NULL OR p.branch_id = :branch)', { branch }).orderBy('p.name', 'ASC').take(500)
    if (term) qb.andWhere('(p.name ILIKE :t OR p.sku ILIKE :t)', { t: `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%` })
    const rows = await this.withBranchStock(await qb.getMany(), branch)
    // Nome do tipo e do grupo para a tela (sem precisar de outra chamada).
    const [types, groups] = await Promise.all([
      this.products.query(`SELECT id, code || ' · ' || description AS label FROM product_types`),
      this.products.query(`SELECT id, code || ' · ' || name AS label FROM product_groups`),
    ])
    const label = (list: { id: string; label: string }[], id: string | null) => list.find((x) => x.id === id)?.label ?? null
    return rows.map((p) => ({ ...p, typeLabel: label(types, p.typeId), groupLabel: label(groups, p.groupId) }))
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentBranch() branch?: string | null) {
    const product = await this.products.findOneBy({ id })
    // Produto exclusivo de outra filial não aparece
    if (!product || (product.branchId && branch !== undefined && product.branchId !== branch)) throw new NotFoundException('Produto não encontrado')
    return branch === undefined ? product : (await this.withBranchStock([product], branch))[0]!
  }

  // Incluir, alterar e excluir: perfil "Cadastros" (Administração › Usuários). Em empresa pequena,
  // o mesmo usuário pode ter Cadastros e Faturamento marcados.
  @Post()
  async create(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Body() dto: CreateProductDto) {
    requirePermission(me, 'cadastro')
    const custom = await this.custom.validate('products', dto.custom, {}, true)
    const { stock, ...fields } = dto
    const saved = await this.save(this.products.create({ ...fields, custom, branchId: await branchForInsert(this.db, 'products', branch) }), branch ? undefined : stock)
    if (stock !== undefined && branch) await this.setBranchStock(saved.id, branch, stock, me.id)
    return this.get(saved.id, branch)
  }

  @Patch(':id')
  async update(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    requirePermission(me, 'cadastro')
    const product = await this.products.findOneByOrFail({ id: (await this.get(id, branch)).id })
    const custom = await this.custom.validate('products', dto.custom, product.custom ?? {})
    const { stock, ...fields } = dto
    await this.save(this.products.merge(product, { ...fields, custom: custom ?? product.custom }), branch ? undefined : stock)
    if (stock !== undefined && branch) await this.setBranchStock(id, branch, stock, me.id)
    // O total é a soma das filiais (a gravação acima não pode deixar um total antigo)
    await this.db.query(`UPDATE products SET stock = (SELECT sum(quantity) FROM product_stock WHERE product_id = $1) WHERE id = $1 AND EXISTS (SELECT 1 FROM product_stock WHERE product_id = $1)`, [id])
    return this.get(id, branch)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @CurrentBranch() branch: string | null, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'cadastro')
    await this.get(id, branch)
    const files: { storage_key: string }[] = await this.products.query(`SELECT storage_key FROM product_videos WHERE product_id = $1 AND kind = 'file'`, [id])
    const { affected } = await this.products.delete({ id })
    for (const f of files) removeVideoFile(f.storage_key)
    if (!affected) throw new NotFoundException('Produto não encontrado')
  }

  // Saldo e custo da filial atual (stock/branchCost); o total de todas as filiais vai em stockTotal.
  private async withBranchStock(rows: Product[], branch: string | null) {
    if (!branch) return rows.map((p) => ({ ...p, stockTotal: p.stock, branchCost: p.costPrice }))
    const map = await branchStocks(this.db, rows.map((p) => p.id), branch)
    return rows.map((p) => ({ ...p, stockTotal: p.stock, stock: map.get(p.id)?.quantity ?? 0, branchCost: map.get(p.id)?.avgCost ?? p.costPrice }))
  }

  // "Estoque atual" digitado no cadastro = saldo da filial; a diferença vira um movimento de ajuste.
  private async setBranchStock(productId: string, branch: string, quantity: number, userId: string) {
    await this.db.transaction(async (tx) => {
      const current = await branchStock(tx, productId, branch)
      const delta = Math.round((quantity - current.quantity) * 10000) / 10000
      if (delta) await moveStock(tx, { productId, companyId: branch, quantity: delta, kind: 'ajuste', reference: 'Ajuste pelo cadastro do produto', userId })
    })
  }

  // Sem filial (nenhuma empresa cadastrada) o saldo digitado vai direto no produto, como antes.
  private async save(product: Product, stock?: number) {
    if (stock !== undefined) product.stock = stock
    try {
      const saved = await this.products.save(product)
      // NCM novo entra no cadastro sozinho, sem atrasar a resposta (a IA completa a descrição depois).
      void ensureNcm(this.db, saved.ncm, () => this.settings.gemini())
      return saved
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('Já existe um produto com este código (SKU)')
      }
      if (error instanceof QueryFailedError && (error as { code?: string }).code === '23503') {
        throw new ConflictException('Tipo, grupo ou classificação tributária (cClassTrib) não encontrado')
      }
      throw error
    }
  }
}
