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
import { ILike, QueryFailedError, Repository } from 'typeorm'
import { CreateProductDto, UpdateProductDto } from './product.dto'
import { Product } from './product.entity'

const UNIQUE_VIOLATION = '23505'

@Controller('products')
export class ProductsController {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  @Get()
  async list(@Query('q') q?: string) {
    const term = q?.trim()
    const rows = await this.products.find({
      where: term ? [{ name: ILike(`%${term}%`) }, { sku: ILike(`%${term}%`) }] : {},
      order: { name: 'ASC' },
      take: 500,
    })
    // Nome do tipo e do grupo para a tela (sem precisar de outra chamada).
    const [types, groups] = await Promise.all([
      this.products.query(`SELECT id, code || ' · ' || description AS label FROM product_types`),
      this.products.query(`SELECT id, code || ' · ' || name AS label FROM product_groups`),
    ])
    const label = (list: { id: string; label: string }[], id: string | null) => list.find((x) => x.id === id)?.label ?? null
    return rows.map((p) => ({ ...p, typeLabel: label(types, p.typeId), groupLabel: label(groups, p.groupId) }))
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const product = await this.products.findOneBy({ id })
    if (!product) throw new NotFoundException('Produto não encontrado')
    return product
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.save(this.products.create(dto))
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    const product = await this.get(id)
    return this.save(this.products.merge(product, dto))
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const { affected } = await this.products.delete({ id })
    if (!affected) throw new NotFoundException('Produto não encontrado')
  }

  private async save(product: Product) {
    try {
      return await this.products.save(product)
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('Já existe um produto com este código (SKU)')
      }
      if (error instanceof QueryFailedError && (error as { code?: string }).code === '23503') {
        throw new ConflictException('Tipo ou grupo de produto não encontrado')
      }
      throw error
    }
  }
}
