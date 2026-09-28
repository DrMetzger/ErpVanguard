import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { diskStorage } from 'multer'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { Public } from '../auth/public.decorator'
import { requirePermission } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'
import { checkSignature, parseVideoLink, signedVideoUrl, VIDEO_DIR } from './media'

const MAX_VIDEOS = 3
const MAX_BYTES = 100 * 1024 * 1024
const TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v' }

class LinkDto {
  @IsString() @MaxLength(500) url: string
  @IsOptional() @IsString() @MaxLength(120) title?: string
}
class UploadDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string
}

export function removeVideoFile(key: string | null) {
  if (!key) return
  const path = join(VIDEO_DIR, key)
  if (existsSync(path)) unlinkSync(path)
}

// Vídeos do produto: link (YouTube/Vimeo/URL) ou arquivo enviado (até 100 MB).
@Controller()
export class ProductVideosController {
  constructor(private readonly db: DataSource) {}

  @Get('products/:id/videos')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db.query(
      `SELECT id, position, kind, provider, title, url, file_name AS "fileName", content_type AS "contentType", size FROM product_videos
       WHERE product_id = $1 ORDER BY position, created_at`,
      [id],
    )
    return rows.map((r: any) => ({ ...r, size: r.size === null ? null : Number(r.size), src: r.kind === 'file' ? signedVideoUrl(r.id) : r.url }))
  }

  @Post('products/:id/videos/link')
  async addLink(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    requirePermission(me, 'cadastro')
    const link = parseVideoLink(dto.url)
    if (!link) throw new BadRequestException('Use um link do YouTube, do Vimeo ou de um arquivo de vídeo (https, .mp4/.webm/.mov)')
    await this.insert(id, { kind: 'link', provider: link.provider, url: link.url, title: dto.title?.trim() || null })
    return this.list(id)
  }

  @Post('products/:id/videos/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: VIDEO_DIR, filename: (_req, file, cb) => cb(null, `${randomUUID()}.${TYPES[file.mimetype] ?? 'bin'}`) }),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(TYPES[file.mimetype] ? null : new BadRequestException('Envie vídeo MP4, WebM ou MOV'), !!TYPES[file.mimetype]),
  }))
  async upload(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: UploadDto) {
    if (!file) throw new BadRequestException('Escolha o arquivo do vídeo')
    try {
      requirePermission(me, 'cadastro')
      await this.insert(id, { kind: 'file', title: dto.title?.trim() || null, fileName: file.originalname.slice(0, 200), contentType: file.mimetype, size: file.size, key: file.filename })
    } catch (error) {
      removeVideoFile(file.filename)
      throw error
    }
    return this.list(id)
  }

  @Delete('products/:id/videos/:videoId')
  async remove(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    requirePermission(me, 'cadastro')
    const video = await one(this.db, `DELETE FROM product_videos WHERE id = $1 AND product_id = $2 RETURNING storage_key`, [videoId, id])
    if (!video) throw new NotFoundException('Vídeo não encontrado')
    removeVideoFile(video.storage_key)
    const rest = await this.db.query(`SELECT id FROM product_videos WHERE product_id = $1 ORDER BY position, created_at`, [id])
    for (const [i, v] of rest.entries()) await this.db.query(`UPDATE product_videos SET position = $2 WHERE id = $1`, [v.id, i])
    return this.list(id)
  }

  // Arquivo do vídeo por link assinado (o navegador pede pedaços: Range).
  @Public()
  @Get('media/videos/:videoId')
  async stream(@Param('videoId', ParseUUIDPipe) videoId: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!checkSignature(videoId, exp, sig)) throw new NotFoundException('Link do vídeo expirado; abra o produto de novo')
    const video = await one(this.db, `SELECT storage_key, content_type FROM product_videos WHERE id = $1 AND kind = 'file'`, [videoId])
    if (!video || !existsSync(join(VIDEO_DIR, video.storage_key))) throw new NotFoundException('Vídeo não encontrado')
    res.sendFile(video.storage_key, { root: VIDEO_DIR, headers: { 'Content-Type': video.content_type, 'Cache-Control': 'private, max-age=3600' } })
  }

  private async insert(id: string, v: { kind: 'link' | 'file'; provider?: string; url?: string; title: string | null; fileName?: string; contentType?: string; size?: number; key?: string }) {
    await this.db.transaction(async (tx) => {
      if (!(await one(tx, `SELECT 1 FROM products WHERE id = $1 FOR UPDATE`, [id]))) throw new NotFoundException('Produto não encontrado')
      const [{ n }] = await tx.query(`SELECT count(*)::int AS n FROM product_videos WHERE product_id = $1`, [id])
      if (n >= MAX_VIDEOS) throw new BadRequestException(`No máximo ${MAX_VIDEOS} vídeos por produto`)
      await tx.query(
        `INSERT INTO product_videos (product_id, position, kind, provider, title, url, file_name, content_type, size, storage_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, n, v.kind, v.provider ?? null, v.title, v.url ?? null, v.fileName ?? null, v.contentType ?? null, v.size ?? null, v.key ?? null],
      )
    })
  }
}
