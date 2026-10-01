import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser } from '../auth/current-user.decorator'
import { Public } from '../auth/public.decorator'
import { requireAdmin, requirePermission } from '../common/access'
import type { User } from '../users/user.entity'
import { MercadoLivreService } from './mercadolivre.service'

class LinkDto { @IsUUID() productId: string; @IsString() @Length(4, 30) itemId: string }
class AttrDto { @IsString() @Length(1, 60) id: string; @IsString() @MaxLength(255) value: string }
class PublishDto {
  @IsUUID() productId: string
  @IsString() @Length(3, 30) categoryId: string
  @IsOptional() @IsString() @MaxLength(60) title?: string
  @IsOptional() @IsString() @MaxLength(30) listingType?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttrDto) attributes?: AttrDto[]
}

// Endereço público do ERP (atrás do Caddy chega como http; o navegador usa https).
const origin = (req: Request) => `${req.headers['x-forwarded-proto'] ?? req.protocol}://${req.headers['x-forwarded-host'] ?? req.headers.host}`

@Controller()
export class MercadoLivreController {
  constructor(private readonly ml: MercadoLivreService) {}

  // ── Conta ──
  @Post('integrations/mercadolivre/authorize')
  @HttpCode(200)
  authorize(@CurrentUser() me: User, @Req() req: Request) { requireAdmin(me); return this.ml.authorize(me, origin(req)) }

  // Volta do login do Mercado Livre: troca o código pelo token e leva de volta à tela.
  @Public()
  @Get('integrations/mercadolivre/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Res() res: Response) {
    let to = '/integracoes?ml='
    try {
      if (error || !code) throw new Error(error === 'access_denied' ? 'acesso negado no Mercado Livre' : 'o Mercado Livre não devolveu a autorização')
      to += 'ok&conta=' + encodeURIComponent(await this.ml.callback(code, state))
    } catch (e) { to += 'erro&motivo=' + encodeURIComponent((e as Error).message) }
    res.redirect(302, to)
  }

  @Post('integrations/mercadolivre/disconnect')
  @HttpCode(204)
  disconnect(@CurrentUser() me: User) { requireAdmin(me); return this.ml.disconnect(me) }

  // Situação para as telas de vendas e anúncios (sem chaves).
  @Get('marketplace/mercadolivre/status')
  status() { return this.ml.status() }

  // ── Anúncios (perfil cadastro) ──
  @Get('marketplace/mercadolivre/listings')
  listings(@CurrentUser() me: User, @Query('q') q?: string) { requirePermission(me, 'cadastro'); return this.ml.listings(q) }

  @Post('marketplace/mercadolivre/link')
  link(@CurrentUser() me: User, @Body() dto: LinkDto) { requirePermission(me, 'cadastro'); return this.ml.link(dto.productId, dto.itemId, me) }

  @Delete('marketplace/mercadolivre/listings/:id')
  @HttpCode(204)
  unlink(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) { requirePermission(me, 'cadastro'); return this.ml.unlink(id, me) }

  @Get('marketplace/mercadolivre/categories')
  categories(@CurrentUser() me: User, @Query('q') q: string) { requirePermission(me, 'cadastro'); return this.ml.categories(q) }

  @Get('marketplace/mercadolivre/categories/:id/attributes')
  attributes(@CurrentUser() me: User, @Param('id') id: string) { requirePermission(me, 'cadastro'); return this.ml.requiredAttributes(id) }

  @Post('marketplace/mercadolivre/publish')
  publish(@CurrentUser() me: User, @Body() dto: PublishDto) { requirePermission(me, 'cadastro'); return this.ml.publish(dto, me) }

  @Post('marketplace/mercadolivre/listings/:id/sync')
  @HttpCode(200)
  sync(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) { requirePermission(me, 'cadastro'); return this.ml.syncListing(id) }

  @Post('marketplace/mercadolivre/sync')
  @HttpCode(200)
  syncAll(@CurrentUser() me: User) { requirePermission(me, 'cadastro'); return this.ml.syncAll(true) }

  // ── Vendas (perfil faturamento) ──
  @Get('marketplace/mercadolivre/orders')
  orders(@CurrentUser() me: User) { requirePermission(me, 'faturamento'); return this.ml.orders() }

  @Post('marketplace/mercadolivre/orders/import')
  @HttpCode(200)
  importRecent(@CurrentUser() me: User) { requirePermission(me, 'faturamento'); return this.ml.importRecent(me) }

  @Post('marketplace/mercadolivre/orders/:externalId/retry')
  @HttpCode(200)
  async retry(@CurrentUser() me: User, @Param('externalId') externalId: string) {
    requirePermission(me, 'faturamento')
    return { result: await this.ml.importOrder(externalId.replace(/\D/g, '')) }
  }

  // Avisos do Mercado Livre (configure no app: https://app.erpvanguard.com.br/api/webhooks/mercadolivre, tópico orders_v2).
  @Public()
  @Post('webhooks/mercadolivre')
  @HttpCode(200)
  async notification(@Body() body: unknown) {
    await this.ml.notification(body)
    return { ok: true }
  }

  // Só para os testes: espera as importações disparadas pelos avisos.
  @Post('marketplace/mercadolivre/idle')
  @HttpCode(204)
  async idle(@CurrentUser() me: User) { requireAdmin(me); await this.ml.idle() }
}
