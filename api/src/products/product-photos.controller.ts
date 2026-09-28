import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { IsString, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'

const MAX_PHOTOS = 6
const MAX_BYTES = 1_500_000
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/

class PhotoDto {
  // Foto já reduzida no navegador (até ~1600 px) e a miniatura (até 160 px)
  @IsString() @MaxLength(2_100_000) image: string
  @IsString() @MaxLength(60_000) thumb: string
}

function parse(dataUrl: string, max: number, label: string) {
  const m = DATA_URL.exec(dataUrl)
  if (!m) throw new BadRequestException(`${label}: envie JPG, PNG ou WebP`)
  const data = Buffer.from(m[2]!, 'base64')
  if (data.length > max) throw new BadRequestException(`${label} muito grande`)
  return { type: m[1]!, data }
}

// Fotos do produto: a de posição 0 é a principal e a miniatura dela vai para a lista de produtos.
@Controller('products/:id/photos')
export class ProductPhotosController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db.query(`SELECT id, position, content_type, encode(data, 'base64') AS b64 FROM product_photos WHERE product_id = $1 ORDER BY position, created_at`, [id])
    return rows.map((r: any) => ({ id: r.id, position: r.position, url: `data:${r.content_type};base64,${r.b64}` }))
  }

  @Post()
  async add(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDto) {
    requirePermission(me, 'cadastro')
    if (!(await one(this.db, `SELECT 1 FROM products WHERE id = $1`, [id]))) throw new NotFoundException('Produto não encontrado')
    const image = parse(dto.image, MAX_BYTES, 'Foto')
    parse(dto.thumb, 45_000, 'Miniatura')
    await this.db.transaction(async (tx) => {
      const [{ n }] = await tx.query(`SELECT count(*)::int AS n FROM product_photos WHERE product_id = $1`, [id])
      if (n >= MAX_PHOTOS) throw new BadRequestException(`No máximo ${MAX_PHOTOS} fotos por produto`)
      await tx.query(`INSERT INTO product_photos (product_id, position, content_type, data, thumb) VALUES ($1, $2, $3, $4, $5)`, [id, n, image.type, image.data, dto.thumb])
      await this.syncThumb(tx, id)
    })
    return this.list(id)
  }

  // Torna a foto a principal (vai para a posição 0).
  @Post(':photoId/main')
  @HttpCode(200)
  async main(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    requirePermission(me, 'cadastro')
    await this.db.transaction(async (tx) => {
      const photos = await tx.query(`SELECT id FROM product_photos WHERE product_id = $1 ORDER BY position, created_at`, [id])
      if (!photos.some((p: any) => p.id === photoId)) throw new NotFoundException('Foto não encontrada')
      const order = [photoId, ...photos.map((p: any) => p.id).filter((x: string) => x !== photoId)]
      for (const [i, pid] of order.entries()) await tx.query(`UPDATE product_photos SET position = $2 WHERE id = $1`, [pid, i])
      await this.syncThumb(tx, id)
    })
    return this.list(id)
  }

  @Delete(':photoId')
  async remove(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    requirePermission(me, 'cadastro')
    await this.db.transaction(async (tx) => {
      const [, count] = await tx.query(`DELETE FROM product_photos WHERE id = $1 AND product_id = $2`, [photoId, id])
      if (!count) throw new NotFoundException('Foto não encontrada')
      const rest = await tx.query(`SELECT id FROM product_photos WHERE product_id = $1 ORDER BY position, created_at`, [id])
      for (const [i, p] of rest.entries()) await tx.query(`UPDATE product_photos SET position = $2 WHERE id = $1`, [p.id, i])
      await this.syncThumb(tx, id)
    })
    return this.list(id)
  }

  private async syncThumb(tx: any, id: string) {
    await tx.query(`UPDATE products SET thumb = (SELECT thumb FROM product_photos WHERE product_id = $1 ORDER BY position, created_at LIMIT 1) WHERE id = $1`, [id])
  }
}
