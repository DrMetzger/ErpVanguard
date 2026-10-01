import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { Public } from './auth'
import { control } from './control-config'
import { SLUG, TenantsService } from './tenants'

// Rotas do agente da VPS. Só ele chama, pelo 127.0.0.1 do servidor:
//  - o Caddy bloqueia /api/agent na internet;
//  - pedido que passou pelo Caddy (tem X-Forwarded-For) é recusado;
//  - exige a senha do agente (AGENT_TOKEN, gerada no próprio servidor).
// Respostas em texto simples para o script do agente não precisar interpretar JSON.
function checkAgent(req: Request) {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) throw new ForbiddenException()
  const [type, token] = req.headers.authorization?.split(' ') ?? []
  const want = createHash('sha256').update(control.agentToken).digest()
  const got = createHash('sha256').update(String(token ?? '')).digest()
  if (type !== 'Bearer' || !timingSafeEqual(want, got)) throw new UnauthorizedException()
}

const IMAGE = /^sha256:[a-f0-9]{64}$/

@Controller('agent')
export class AgentController {
  constructor(private readonly tenants: TenantsService) {}

  // Uma linha: "<pedido> <ação> <cliente> <e-mail>" ou vazio (204) se não tem nada.
  @Public() @Get('next')
  async next(@Req() req: Request, @Res() res: Response) {
    checkAgent(req)
    const job = await this.tenants.nextJob()
    if (!job) return res.status(204).end()
    res.type('text/plain').send(`${job.id} ${job.kind} ${job.slug} ${job.email}\n`)
  }

  @Public() @Post('jobs/:id') @HttpCode(204)
  async finish(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, string>) {
    checkAgent(req)
    const pass = typeof body.adminPassword === 'string' && /^[A-Za-z0-9]{12,40}$/.test(body.adminPassword) ? body.adminPassword : undefined
    await this.tenants.finishJob(id, body.status === 'ok', String(body.message ?? '').slice(0, 2000), pass)
  }

  // Situação dos sistemas: "main=<imagem>" e "tenants=<cliente>:<rodando|parado>:<imagem>,..."
  @Public() @Post('state') @HttpCode(204)
  async state(@Req() req: Request, @Body() body: Record<string, string>) {
    checkAgent(req)
    const main = IMAGE.test(String(body.main ?? '')) ? String(body.main) : null
    const tenants = String(body.tenants ?? '').split(',').map((s) => s.trim().split(':')).filter((p) => p.length >= 2 && SLUG.test(p[0]!))
      .map(([slug, st, ...img]) => ({ slug: slug!, running: st === 'rodando', image: IMAGE.test(img.join(':')) ? img.join(':') : null }))
    await this.tenants.saveState(main, tenants.slice(0, 500))
  }

  @Public() @Post('idle') @HttpCode(204)
  async idle(@Req() req: Request) { checkAgent(req); await this.tenants.idle() }
}
