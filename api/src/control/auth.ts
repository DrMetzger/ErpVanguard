import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, HttpCode, Injectable, Logger, Post, Req, SetMetadata, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import * as bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { IsEmail, IsString, Length, MinLength } from 'class-validator'
import type { Request } from 'express'
import { hashCode, readToken, signToken } from './crypto'
import { sendMail } from './mailer'
import { q, q1 } from './store'

export const PUBLIC = 'control-public'
export const Public = () => SetMetadata(PUBLIC, true)

// Todas as rotas do painel exigem o token do login com código, menos as marcadas como públicas.
@Injectable()
export class ControlGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true
    const req = ctx.switchToHttp().getRequest<Request & { admin?: any }>()
    const [type, token] = req.headers.authorization?.split(' ') ?? []
    const p = type === 'Bearer' ? readToken(token ?? '') : null
    if (!p || p.purpose !== 'session') throw new UnauthorizedException()
    const admin = await q1(`SELECT id, email, name FROM control_admins WHERE email = $1 AND active`, [p.email])
    if (!admin) throw new UnauthorizedException()
    req.admin = admin
    return true
  }
}

class LoginDto { @IsEmail() email: string; @IsString() @Length(1, 200) password: string }
class VerifyDto { @IsString() challenge: string; @IsString() @Length(6, 6) code: string }
class StartDto { @IsEmail() email: string }
class FinishDto { @IsEmail() email: string; @IsString() @Length(6, 6) code: string; @IsString() @MinLength(10, { message: 'A senha precisa ter pelo menos 10 caracteres' }) password: string }

// Tentativas por endereço (contra força bruta): 10 a cada 15 minutos.
const tries = new Map<string, number[]>()
function throttle(key: string) {
  const now = Date.now()
  const list = (tries.get(key) ?? []).filter((t) => now - t < 15 * 60_000)
  if (list.length >= 10) throw new BadRequestException('Muitas tentativas: espere 15 minutos')
  list.push(now); tries.set(key, list)
}

async function sendCode(email: string, purpose: 'login' | 'senha') {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await q(`UPDATE control_codes SET used = true WHERE email = $1 AND purpose = $2 AND NOT used`, [email, purpose])
  await q(`INSERT INTO control_codes (email, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`, [email, purpose, hashCode(code)])
  await sendMail(email, `Código de acesso ao painel: ${code}`,
    `Seu código para ${purpose === 'login' ? 'entrar no' : 'definir a senha do'} painel da Prime ERP (admin) é: ${code}\n\nVale por 10 minutos. Se não foi você, ignore este e-mail.`)
}

async function checkCode(email: string, purpose: 'login' | 'senha', code: string) {
  const row = await q1(`SELECT id, code_hash, attempts FROM control_codes WHERE email = $1 AND purpose = $2 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1`, [email, purpose])
  if (!row) throw new BadRequestException('Código vencido: peça um novo')
  if (row.attempts >= 5) throw new BadRequestException('Muitas tentativas com este código: peça um novo')
  if (row.code_hash !== hashCode(code)) {
    await q(`UPDATE control_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id])
    throw new BadRequestException('Código errado')
  }
  await q(`UPDATE control_codes SET used = true WHERE id = $1`, [row.id])
}

@Controller('auth')
export class ControlAuthController {
  private readonly log = new Logger('Painel')

  // 1º passo: e-mail e senha. Certo → manda o código por e-mail.
  @Public() @Post('login') @HttpCode(200)
  async login(@Req() req: Request, @Body() dto: LoginDto) {
    const email = dto.email.toLowerCase().trim()
    throttle(`login:${req.ip}`); throttle(`login:${email}`)
    const admin = await q1(`SELECT password_hash FROM control_admins WHERE email = $1 AND active`, [email])
    if (!admin?.password_hash || !(await bcrypt.compare(dto.password, admin.password_hash))) throw new UnauthorizedException('E-mail ou senha inválidos')
    await sendCode(email, 'login')
    return { challenge: signToken({ email, purpose: '2fa' }, 0.25), sentTo: email.replace(/^(.).*?(@.*)$/, '$1***$2') }
  }

  // 2º passo: código do e-mail → sessão de 8 horas.
  @Public() @Post('verify') @HttpCode(200)
  async verify(@Req() req: Request, @Body() dto: VerifyDto) {
    const p = readToken(dto.challenge)
    if (!p || p.purpose !== '2fa') throw new UnauthorizedException('Entre de novo')
    throttle(`verify:${p.email}`)
    await checkCode(p.email, 'login', dto.code)
    const admin = await q1(`UPDATE control_admins SET last_login_at = now() WHERE email = $1 AND active RETURNING email, name`, [p.email])
    if (!admin) throw new UnauthorizedException()
    this.log.log(`Entrada no painel: ${p.email} (${req.ip})`)
    // Aviso de cada entrada: se não foi você, troque a senha na hora.
    const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    void sendMail(p.email, 'Nova entrada no painel da Prime ERP',
      `Entraram no painel com o seu e-mail em ${when} (horário de Brasília), do endereço ${req.ip}.\n\nSe não foi você, troque a senha agora (Esqueci a senha) e avise o suporte.`).catch(() => undefined)
    return { token: signToken({ email: p.email, purpose: 'session' }, 8), admin }
  }

  // Primeiro acesso ou esqueceu a senha: código por e-mail (resposta igual exista ou não o e-mail).
  @Public() @Post('password/start') @HttpCode(200)
  async passwordStart(@Req() req: Request, @Body() dto: StartDto) {
    const email = dto.email.toLowerCase().trim()
    throttle(`pw:${req.ip}`); throttle(`pw:${email}`)
    if (await q1(`SELECT 1 FROM control_admins WHERE email = $1 AND active`, [email])) await sendCode(email, 'senha')
    return { ok: true }
  }

  @Public() @Post('password/finish') @HttpCode(200)
  async passwordFinish(@Body() dto: FinishDto) {
    const email = dto.email.toLowerCase().trim()
    throttle(`pwf:${email}`)
    if (!(await q1(`SELECT 1 FROM control_admins WHERE email = $1 AND active`, [email]))) throw new BadRequestException('Código vencido: peça um novo')
    await checkCode(email, 'senha', dto.code)
    await q(`UPDATE control_admins SET password_hash = $2 WHERE email = $1`, [email, await bcrypt.hash(dto.password, 12)])
    this.log.log(`Senha do painel definida: ${email}`)
    return { ok: true }
  }
}
