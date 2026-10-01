import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common'
import { promises as dns } from 'node:dns'
import { IsEmail, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator'
import type { Request, Response } from 'express'
import { Public } from './auth'
import { control } from './control-config'
import { open, seal } from './crypto'
import { sendMail } from './mailer'
import { q, q1 } from './store'

// Endereços que nunca podem ser de cliente (inclui os nomes internos dos serviços).
export const RESERVED = ['app', 'admin', 'www', 'api', 'db', 'web', 'control', 'vanguard', 'mail', 'smtp', 'ftp', 'webmail', 'cpanel', 'ns1', 'ns2', 'demo', 'status', 'suporte', 'help', 'static', 'cdn', 'download']
export const SLUG = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/
const UF = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const SHARED = ['products', 'product_groups', 'customers', 'suppliers', 'price_tables', 'payment_terms', 'finance_categories', 'cost_centers', 'bank_accounts']
// Ações que o painel pode pedir ao agente. Excluir cliente não existe aqui de propósito (só manual, na VPS).
export const ACTIONS = ['suspender', 'reativar', 'reiniciar', 'atualizar', 'backup', 'refazer'] as const

export class TenantDto {
  @Matches(SLUG, { message: 'Endereço: 3 a 30 letras minúsculas, números ou hífen (ex.: stark)' }) slug: string
  @IsString() @Length(2, 200) name: string
  @Matches(/^\d{14}$/, { message: 'CNPJ com 14 dígitos' }) document: string
  // Vai para a configuração do sistema do cliente: só caracteres comuns de e-mail.
  @IsEmail() @Matches(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i, { message: 'E-mail com caracteres não aceitos' }) @Length(5, 120) adminEmail: string
  @IsOptional() @IsString() @Length(2, 120) adminName?: string
  @IsIn(UF) uf: string
  @Matches(/^\d{8}$/, { message: 'CEP com 8 dígitos' }) zip: string
  @IsIn(['simples', 'simples_excesso', 'mei', 'presumido', 'real']) taxRegime: string
  @IsOptional() @IsObject() modes?: Record<string, 'C' | 'E'>
}

const cnpjOk = (c: string) => {
  if (/^(\d)\1{13}$/.test(c)) return false
  const dv = (s: string, w: number[]) => { const r = s.split('').reduce((a, d, i) => a + Number(d) * w[i]!, 0) % 11; return r < 2 ? 0 : 11 - r }
  const d1 = dv(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(c[12]) && dv(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(c[13])
}
const url = (slug: string) => `https://${slug}.${control.baseDomain}`
// API do cliente pela rede interna (apelido <cliente>-api). TENANT_API_URL só para testes.
const tenantApi = (slug: string) => (process.env.TENANT_API_URL ?? 'http://{slug}-api:3000/api').replace('{slug}', slug)

@Injectable()
export class TenantsService {
  private readonly log = new Logger('Clientes')
  private running = new Map<string, Promise<void>>()

  async event(tenantId: string | null, kind: string, message: string, admin?: string) {
    await q(`INSERT INTO tenant_events (tenant_id, kind, message, admin_email) VALUES ($1, $2, $3, $4)`, [tenantId, kind, message.slice(0, 2000), admin ?? null])
  }

  private async mainImage() {
    return (await q1(`SELECT main_image, seen_at FROM agent_state WHERE id = 1`)) ?? null
  }

  async list() {
    const rows = await q(`SELECT id, slug, name, document, admin_email AS "adminEmail", status, step, running, image_id AS "imageId", last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt",
        (SELECT kind FROM agent_jobs j WHERE j.tenant_id = t.id AND j.status IN ('pendente','executando') ORDER BY created_at LIMIT 1) AS "pendingJob"
      FROM tenants t WHERE status <> 'excluido' ORDER BY name`)
    const main = await this.mainImage()
    return Promise.all(rows.map(async (t) => ({ ...t, url: url(t.slug), updateAvailable: !!main?.main_image && !!t.imageId && t.imageId !== main.main_image, online: await this.online(t.slug) })))
  }

  async get(id: string) {
    const t = await q1(`SELECT id, slug, name, document, admin_email AS "adminEmail", admin_name AS "adminName", status, step, setup, running, image_id AS "imageId", state_at AS "stateAt", last_error AS "lastError", created_at AS "createdAt", created_by AS "createdBy" FROM tenants WHERE id = $1`, [id])
    if (!t) throw new NotFoundException('Cliente não encontrado')
    const events = await q(`SELECT kind, message, admin_email AS "adminEmail", created_at AS "createdAt" FROM tenant_events WHERE tenant_id = $1 ORDER BY id DESC LIMIT 100`, [id])
    const jobs = await q(`SELECT kind, status, message, requested_by AS "requestedBy", created_at AS "createdAt", finished_at AS "finishedAt" FROM agent_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`, [id])
    const main = await this.mainImage()
    const ips = await dns.resolve4(`${t.slug}.${control.baseDomain}`).catch(() => [] as string[])
    return {
      ...t, url: url(t.slug), dnsRecord: { type: 'A', name: t.slug, value: control.publicIp }, dnsOk: ips.includes(control.publicIp), dnsIps: ips,
      online: await this.online(t.slug), updateAvailable: !!main?.main_image && !!t.imageId && t.imageId !== main.main_image, events, jobs,
    }
  }

  async online(slug: string) {
    return fetch(`${tenantApi(slug)}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false)
  }

  // Situação do agente: se ele parou de responder, os pedidos ficam na fila.
  async agent() {
    const s = await this.mainImage()
    const pending = await q1(`SELECT count(*)::int AS n FROM agent_jobs WHERE status IN ('pendente','executando')`)
    return { seenAt: s?.seen_at ?? null, online: !!s?.seen_at && Date.now() - new Date(s.seen_at).getTime() < 3 * 60_000, pending: pending?.n ?? 0 }
  }

  async create(dto: TenantDto, admin: string) {
    const slug = dto.slug.toLowerCase()
    if (RESERVED.includes(slug)) throw new BadRequestException(`"${slug}" é reservado: escolha outro endereço`)
    if (!cnpjOk(dto.document)) throw new BadRequestException('CNPJ inválido')
    if (await q1(`SELECT 1 FROM tenants WHERE slug = $1`, [slug])) throw new BadRequestException(`Já existe um cliente em ${slug}.${control.baseDomain}`)
    const modes = Object.fromEntries(Object.entries(dto.modes ?? {}).filter(([k, v]) => SHARED.includes(k) && ['C', 'E'].includes(v)))
    const t = await q1(
      `INSERT INTO tenants (slug, name, document, admin_email, admin_name, setup, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [slug, dto.name.trim(), dto.document, dto.adminEmail.toLowerCase(), dto.adminName?.trim() || null, JSON.stringify({ uf: dto.uf, zip: dto.zip, taxRegime: dto.taxRegime, modes }), admin])
    await this.event(t.id, 'criacao', `Cliente cadastrado: ${dto.name} (${slug}.${control.baseDomain})`, admin)
    await this.enqueue(t.id, 'criar', admin)
    return this.get(t.id)
  }

  // Um pedido por vez para cada cliente.
  private async enqueue(tenantId: string, kind: string, admin: string) {
    const busy = await q1(`SELECT kind FROM agent_jobs WHERE tenant_id = $1 AND status IN ('pendente','executando')`, [tenantId])
    if (busy) throw new BadRequestException(`Já tem um pedido em andamento (${busy.kind}): espere terminar`)
    await q(`INSERT INTO agent_jobs (tenant_id, kind, requested_by) VALUES ($1, $2, $3)`, [tenantId, kind, admin])
    await q(`UPDATE tenants SET step = $2, updated_at = now() WHERE id = $1`, [tenantId, `aguardando: ${kind}`])
  }

  async action(id: string, action: string, admin: string) {
    if (!(ACTIONS as readonly string[]).includes(action)) throw new BadRequestException('Ação desconhecida')
    const t = await q1(`SELECT id, status FROM tenants WHERE id = $1`, [id])
    if (!t) throw new NotFoundException('Cliente não encontrado')
    if (action === 'refazer') {
      if (!['erro', 'criando'].includes(t.status)) throw new BadRequestException('Só para cliente com erro na criação')
      await q(`UPDATE tenants SET status = 'criando', last_error = NULL WHERE id = $1`, [id])
      await this.enqueue(id, 'criar', admin)
    } else {
      if (['criando', 'erro'].includes(t.status) && action !== 'backup') throw new BadRequestException('Cliente ainda não foi criado: use "Refazer criação"')
      if (action === 'reiniciar' && t.status === 'suspenso') throw new BadRequestException('Cliente suspenso: reative primeiro')
      await this.enqueue(id, action, admin)
    }
    await this.event(id, 'acao', `Pedido: ${action}`, admin)
    return this.get(id)
  }

  async updateAll(admin: string) {
    const main = await this.mainImage()
    const rows = await q(`SELECT id FROM tenants t WHERE status IN ('ativo','suspenso') AND image_id IS DISTINCT FROM $1
      AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.tenant_id = t.id AND j.status IN ('pendente','executando'))`, [main?.main_image ?? null])
    for (const r of rows) { await this.enqueue(r.id, 'atualizar', admin); await this.event(r.id, 'acao', 'Pedido: atualizar (todos)', admin) }
    return { queued: rows.length }
  }

  // ---- Respostas do agente ----

  // Entrega o pedido mais antigo (marca como em execução). Pedido parado há 30 min = agente caiu no meio.
  async nextJob() {
    const stale = await q(`UPDATE agent_jobs SET status = 'erro', message = 'O agente parou no meio: peça de novo', finished_at = now() WHERE status = 'executando' AND started_at < now() - interval '30 minutes' RETURNING tenant_id`)
    for (const s of stale) await q(`UPDATE tenants SET step = NULL WHERE id = $1`, [s.tenant_id])
    const job = await q1(`UPDATE agent_jobs SET status = 'executando', started_at = now() WHERE id = (
        SELECT id FROM agent_jobs WHERE status = 'pendente' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, tenant_id, kind`)
    if (!job) return null
    const t = await q1(`SELECT slug, admin_email FROM tenants WHERE id = $1`, [job.tenant_id])
    await q(`UPDATE tenants SET step = $2, updated_at = now() WHERE id = $1`, [job.tenant_id, `executando: ${job.kind}`])
    return { id: job.id as string, kind: job.kind as string, slug: t.slug as string, email: t.admin_email as string }
  }

  async finishJob(id: string, ok: boolean, message: string, adminPassword?: string) {
    const job = await q1(`UPDATE agent_jobs SET status = $2, message = $3, finished_at = now() WHERE id = $1 AND status = 'executando' RETURNING tenant_id, kind`, [id, ok ? 'ok' : 'erro', message.slice(0, 2000)])
    if (!job) throw new NotFoundException('Pedido não está em execução')
    const tid = job.tenant_id
    await q(`UPDATE tenants SET step = NULL, updated_at = now() WHERE id = $1`, [tid])
    await this.event(tid, ok ? 'agente' : 'erro', `${job.kind}: ${message || (ok ? 'ok' : 'erro')}`)
    if (job.kind === 'criar' && adminPassword) await q(`UPDATE tenants SET admin_password = $2 WHERE id = $1`, [tid, seal(adminPassword)])
    if (!ok) {
      if (job.kind === 'criar') await q(`UPDATE tenants SET status = 'erro', last_error = $2 WHERE id = $1`, [tid, message.slice(0, 2000)])
      return
    }
    if (job.kind === 'suspender') await q(`UPDATE tenants SET status = 'suspenso' WHERE id = $1`, [tid])
    if (job.kind === 'reativar') await q(`UPDATE tenants SET status = 'ativo' WHERE id = $1`, [tid])
    if (job.kind === 'criar') {
      void this.configure(tid)
    }
  }

  async saveState(mainImage: string | null, tenants: { slug: string; running: boolean; image: string | null }[]) {
    await q(`INSERT INTO agent_state (id, main_image, seen_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET main_image = EXCLUDED.main_image, seen_at = now()`, [mainImage])
    for (const t of tenants) await q(`UPDATE tenants SET running = $2, image_id = $3, state_at = now() WHERE slug = $1`, [t.slug, t.running, t.image])
  }

  // ---- Configuração inicial pela API do próprio cliente (nada de acesso ao servidor) ----
  configure(id: string) {
    if (this.running.has(id)) return this.running.get(id)!
    const job = this.configureNow(id).finally(() => this.running.delete(id))
    this.running.set(id, job)
    return job
  }

  async idle() { await Promise.allSettled([...this.running.values()]) }

  private async configureNow(id: string) {
    const t = (await q1(`SELECT * FROM tenants WHERE id = $1`, [id]))!
    try {
      if (!t.configured) {
        if (!t.admin_password) throw new Error('Sem a senha provisória do administrador: o banco do cliente já existia. Configure a matriz pelo próprio sistema.')
        const adminPass = open(t.admin_password)
        await q(`UPDATE tenants SET step = 'configuracao' WHERE id = $1`, [id])
        const api = tenantApi(t.slug)
        const call = async (method: string, path: string, body?: unknown, token?: string) => {
          const r = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
          const data: any = await r.json().catch(() => null)
          if (!r.ok) throw new Error(`${path}: ${Array.isArray(data?.message) ? data.message.join('; ') : data?.message ?? r.status}`)
          return data
        }
        const { token } = await call('POST', '/auth/login', { email: t.admin_email, password: adminPass })
        const s = t.setup ?? {}
        for (const [tbl, mode] of Object.entries(s.modes ?? {})) await call('PUT', `/branch-modes/${tbl}`, { mode }, token)
        const companies = await call('GET', '/catalog/companies', undefined, token)
        if (!companies.length) await call('POST', '/catalog/companies', { code: '0001', isHead: true, document: t.document, name: t.name, uf: s.uf, zip: s.zip, taxRegime: s.taxRegime }, token)
        await q(`UPDATE tenants SET step = 'email' WHERE id = $1`, [id])
        await sendMail(t.admin_email, `Seu ERP Vanguard está pronto: ${t.slug}.${control.baseDomain}`,
          `Olá${t.admin_name ? ' ' + t.admin_name : ''}!\n\nO sistema da ${t.name} está no ar:\n\n${url(t.slug)}\n\nUsuário: ${t.admin_email}\nSenha provisória: ${adminPass}\n\nTroque a senha no primeiro acesso (Minha conta › Trocar senha).\n\nPrime ERP Soluções`)
          .then(() => this.event(id, 'email', `Acesso enviado para ${t.admin_email}`))
          .catch((e) => this.event(id, 'aviso', `Não consegui enviar o e-mail de acesso: ${(e as Error).message}`))
        // A senha provisória não fica guardada no painel.
        await q(`UPDATE tenants SET admin_password = NULL, configured = true WHERE id = $1`, [id])
      }
      await q(`UPDATE tenants SET status = 'ativo', step = NULL, last_error = NULL, updated_at = now() WHERE id = $1`, [id])
      await this.event(id, 'pronto', `Sistema no ar em ${url(t.slug)}`)
      this.log.log(`Cliente ${t.slug} pronto`)
    } catch (e) {
      const msg = (e as Error).message
      await q(`UPDATE tenants SET status = 'erro', step = NULL, last_error = $2, updated_at = now() WHERE id = $1`, [id, msg])
      await this.event(id, 'erro', msg)
      this.log.error(`Cliente ${t.slug}: ${msg}`)
    }
  }

  // Caddy pergunta antes de gerar o certificado HTTPS de um endereço.
  async tlsAllowed(domain: string) {
    const d = domain.toLowerCase()
    if ([`app.${control.baseDomain}`, `admin.${control.baseDomain}`].includes(d)) return true
    const m = d.match(new RegExp(`^([a-z0-9-]+)\\.${control.baseDomain.replace(/\./g, '\\.')}$`))
    return !!m && SLUG.test(m[1]!) && !!(await q1(`SELECT 1 FROM tenants WHERE slug = $1 AND status <> 'excluido'`, [m[1]]))
  }
}

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('tenants') list() { return this.tenants.list() }
  @Get('vps-status') agent() { return this.tenants.agent() }
  @Get('tenants/:id') get(@Param('id', ParseUUIDPipe) id: string) { return this.tenants.get(id) }
  @Post('tenants') create(@Req() req: Request & { admin: any }, @Body() dto: TenantDto) { return this.tenants.create(dto, req.admin.email) }
  @Post('tenants-update-all') @HttpCode(200) updateAll(@Req() req: Request & { admin: any }) { return this.tenants.updateAll(req.admin.email) }
  @Post('tenants/:id/:action') @HttpCode(200)
  action(@Req() req: Request & { admin: any }, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string) { return this.tenants.action(id, action, req.admin.email) }
  @Get('me') me(@Req() req: Request & { admin: any }) { return req.admin }

  @Public() @Get('tls-check')
  async tls(@Query('domain') domain: string, @Res() res: Response) { res.status((await this.tenants.tlsAllowed(String(domain ?? '').slice(0, 100))) ? 200 : 403).end() }

  @Public() @Get('health') health() { return { status: 'ok' } }
}
