import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Logger, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { Public } from '../auth/public.decorator'
import { isAdmin, requireAdmin } from '../common/access'
import type { User } from '../users/user.entity'
import { IntegrationsService } from './integrations.service'
import { phoneInfo, sendTemplate, waNumber, WhatsAppError } from './whatsapp'

class SaveDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsObject() config?: Record<string, unknown>
  @IsOptional() @IsObject() secrets?: Record<string, unknown>
}
class TestDto { @IsOptional() @IsString() @MaxLength(20) to?: string }

// Administração › Integrações. Chaves só o administrador vê (mascaradas) e altera.
@Controller()
export class IntegrationsController {
  private readonly log = new Logger('Integrações')
  constructor(private readonly integrations: IntegrationsService, private readonly db: DataSource) {}

  @Get('integrations')
  list(@CurrentUser() me: User) {
    requireAdmin(me)
    return this.integrations.list()
  }

  @Put('integrations/:provider')
  async save(@CurrentUser() me: User, @Param('provider') provider: string, @Body() dto: SaveDto) {
    requireAdmin(me)
    await this.integrations.save(provider, dto, me.id)
    return (await this.integrations.list()).find((i) => i.provider === provider)
  }

  @Get('integrations/logs')
  logs(@CurrentUser() me: User, @Query('provider') provider?: string) {
    if (!isAdmin(me)) throw new ForbiddenException('Só o administrador vê o histórico das integrações')
    return this.integrations.logs(provider || null)
  }

  // Confere token e número; com "to", manda o modelo hello_world (já vem aprovado em toda conta da Meta).
  @Post('integrations/whatsapp/test')
  @HttpCode(200)
  async testWhatsApp(@CurrentUser() me: User, @Body() dto: TestDto) {
    requireAdmin(me)
    const it = await this.integrations.get('whatsapp')
    if (!it.config.phoneNumberId || !it.secrets.accessToken) throw new BadRequestException('Preencha o ID do número e o token de acesso')
    const cfg = { phoneNumberId: it.config.phoneNumberId, accessToken: it.secrets.accessToken, apiVersion: it.config.apiVersion }
    try {
      const info = await phoneInfo(cfg)
      let sent: string | null = null
      if (dto.to) {
        const to = waNumber(dto.to)
        if (!to) throw new BadRequestException('Número de teste inválido')
        sent = await sendTemplate(cfg, to, 'hello_world', 'en_US', [])
        await this.integrations.log({ provider: 'whatsapp', direction: 'out', kind: 'teste', status: 'enviado', externalId: sent, target: to, summary: 'Mensagem de teste (modelo hello_world)', userId: me.id })
      }
      await this.integrations.setStatus('whatsapp', 'conectado', null)
      return { ok: true, number: info.display_phone_number ?? null, name: info.verified_name ?? null, quality: info.quality_rating ?? null, sent }
    } catch (e) {
      if (e instanceof BadRequestException) throw e
      const message = e instanceof WhatsAppError ? e.message : (e as Error).message
      await this.integrations.setStatus('whatsapp', 'erro', message)
      throw new BadRequestException(message)
    }
  }

  // ── Webhook da Meta (configurado no app: URL https://app.erpvanguard.com.br/api/webhooks/whatsapp) ──
  @Public()
  @Get('webhooks/whatsapp')
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const it = await this.integrations.get('whatsapp')
    if (mode === 'subscribe' && it.secrets.verifyToken && token === it.secrets.verifyToken) return res.status(200).type('text/plain').send(challenge)
    return res.status(403).send('forbidden')
  }

  @Public()
  @Post('webhooks/whatsapp')
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: any) {
    const it = await this.integrations.get('whatsapp')
    // Assinatura da Meta (X-Hub-Signature-256) com o App Secret: sem ela, ignora.
    const sig = String(req.headers['x-hub-signature-256'] ?? '')
    const secret = it.secrets.appSecret
    if (!secret || !req.rawBody) { this.log.warn('Webhook do WhatsApp sem App Secret configurado: ignorado'); return { ok: false } }
    const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex')
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) { this.log.warn('Webhook do WhatsApp com assinatura inválida'); return { ok: false } }

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {}
        // Situação das mensagens enviadas: sent → delivered → read (ou failed)
        for (const st of v.statuses ?? []) {
          const status = ({ sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'erro' } as Record<string, string>)[st.status] ?? st.status
          const error = st.errors?.[0] ? `${st.errors[0].title ?? ''} ${st.errors[0].error_data?.details ?? ''}`.trim() : null
          // Não volta de "lido" para "entregue" se os avisos chegarem fora de ordem
          await this.db.query(
            `UPDATE integration_logs SET status = $3, error = coalesce($4, error), updated_at = now()
             WHERE provider = 'whatsapp' AND external_id = $1 AND direction = 'out'
               AND NOT (status = 'lido' AND $2 IN ('sent', 'delivered')) AND NOT (status = 'entregue' AND $2 = 'sent')`,
            [st.id, st.status, status, error])
        }
        // Mensagens recebidas dos clientes
        for (const m of v.messages ?? []) {
          const name = v.contacts?.find((c: any) => c.wa_id === m.from)?.profile?.name
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`
          await this.integrations.log({ provider: 'whatsapp', direction: 'in', kind: 'mensagem', status: 'recebido', externalId: m.id, target: m.from, summary: `${name ? name + ': ' : ''}${text}` })
        }
      }
    }
    return { ok: true }
  }
}
