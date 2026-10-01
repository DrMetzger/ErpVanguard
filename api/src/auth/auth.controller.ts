import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator'
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { DataSource } from 'typeorm'
import { allowedBranches, branchList, CurrentBranch } from '../branches/branch.context'
import { one } from '../common/db'
import { config } from '../config'
import { MailService } from '../mail/mail.service'
import { SettingsService } from '../settings/settings.service'
import { User } from '../users/user.entity'
import { UsersService } from '../users/users.service'
import { CurrentUser } from './current-user.decorator'
import { Public } from './public.decorator'

class LoginDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(1)
  password: string
}

class VerifyDto {
  @IsString() @Length(10, 2000) challenge: string
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números' }) code: string
}

// Tokens: a sessão leva typ 's'; o desafio do código leva typ '2fa' e não abre nenhuma tela.
export const SESSION = 's'
const CODE_MINUTES = 10
const MAX_ATTEMPTS = 5

// Só em teste (nunca em produção) dá para entrar sem o código.
export const twoFactorOff = () => process.env.LOGIN_2FA === 'off' && process.env.NODE_ENV !== 'production'

const codeHash = (userId: string, code: string) => createHmac('sha256', config.jwtSecret).update(`${userId}:${code}`).digest('hex')
const mask = (email: string) => email.replace(/^(.)(.*?)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${'*'.repeat(Math.min(Math.max(b.length, 3), 6))}${c}`)

// Tentativas (contra força bruta) a cada 15 minutos: 10 por usuário e 40 por endereço de rede
// (vários funcionários do mesmo escritório saem pelo mesmo IP).
const tries = new Map<string, number[]>()
function throttle(key: string, max = 10) {
  const now = Date.now()
  const list = (tries.get(key) ?? []).filter((t) => now - t < 15 * 60_000)
  if (list.length >= max) throw new BadRequestException('Muitas tentativas: espere 15 minutos e tente de novo')
  list.push(now)
  tries.set(key, list)
  if (tries.size > 10_000) tries.clear()
}

@Controller('auth')
export class AuthController {
  private readonly log = new Logger('Login')

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly db: DataSource,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private async session(user: User) {
    const { passwordHash: _, ...profile } = user as User & { passwordHash?: string }
    const branches = allowedBranches(user, await branchList(this.db))
    const branchId = (branches.find((b) => b.id === user.defaultBranchId) ?? branches[0])?.id ?? null
    return { token: await this.jwt.signAsync({ sub: user.id, typ: SESSION }), user: { ...profile, branches, branchId } }
  }

  // Configuração inicial feita pelo painel da Prime ERP (sistema novo, ninguém entrou ainda): token próprio do servidor.
  private async setupLogin(req: Request, user: User) {
    const token = process.env.SETUP_TOKEN
    const got = req.headers['x-setup-token']
    if (!token || typeof got !== 'string' || user.role !== 'admin') return false
    const a = createHash('sha256').update(token).digest()
    const b = createHash('sha256').update(got).digest()
    if (!timingSafeEqual(a, b)) return false
    return !(await one(this.db, `SELECT 1 FROM users WHERE last_login_at IS NOT NULL LIMIT 1`))
  }

  // 1ª etapa: e-mail e senha. Certo → código de 6 números no e-mail do usuário.
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @Body() { email, password }: LoginDto) {
    const mailKey = email.toLowerCase().trim()
    throttle(`login:${req.ip}`, 40)
    throttle(`login:${mailKey}`)
    const user = await this.users.findByEmailWithPassword(mailKey)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos')
    }
    if (twoFactorOff() || !(await this.settings.security()).twoFactor || (await this.setupLogin(req, user))) return this.session(user)
    const to = (await one<{ e: string | null }>(this.db, `SELECT two_factor_email AS e FROM users WHERE id = $1`, [user.id]))?.e || user.email

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await this.db.query(`UPDATE login_codes SET used = true WHERE user_id = $1 AND NOT used`, [user.id])
    await this.db.query(`INSERT INTO login_codes (user_id, code_hash, ip, expires_at) VALUES ($1, $2, $3, now() + interval '${CODE_MINUTES} minutes')`, [user.id, codeHash(user.id, code), String(req.ip ?? '').slice(0, 60)])
    const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    try {
      await this.mail.send({
        to: [to],
        subject: `Código de acesso ao ERP Vanguard: ${code}`,
        text: `Olá, ${user.name}!\n\nSeu código para entrar no ERP Vanguard é: ${code}\n\nVale por ${CODE_MINUTES} minutos. Pedido em ${when} (Brasília).\n\nSe não foi você, troque sua senha agora: alguém sabe a sua senha.`,
        html: `<p>Olá, ${escapeHtml(user.name)}!</p><p>Seu código para entrar no ERP Vanguard é:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Vale por ${CODE_MINUTES} minutos. Pedido em ${when} (Brasília).</p><p><b>Se não foi você, troque sua senha agora:</b> alguém sabe a sua senha.</p>`,
      })
    } catch (e) {
      this.log.error(`Código de acesso não enviado para ${to}: ${(e as Error).message}`)
      throw new ServiceUnavailableException('Não consegui mandar o código de acesso por e-mail. Avise o administrador do sistema.')
    }
    const challenge = await this.jwt.signAsync({ sub: user.id, typ: '2fa' }, { expiresIn: `${CODE_MINUTES}m` })
    return { twoFactor: true, challenge, sentTo: mask(to), minutes: CODE_MINUTES }
  }

  // 2ª etapa: código do e-mail → acesso.
  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Req() req: Request, @Body() dto: VerifyDto) {
    let payload: { sub: string; typ?: string }
    try {
      payload = await this.jwt.verifyAsync(dto.challenge)
    } catch {
      throw new UnauthorizedException('O código venceu: entre de novo')
    }
    if (payload.typ !== '2fa') throw new UnauthorizedException('Entre de novo')
    throttle(`verify:${payload.sub}`)
    throttle(`verify:${req.ip}`, 40)
    const row = await one<{ id: string; code_hash: string; attempts: number }>(this.db,
      `SELECT id, code_hash, attempts FROM login_codes WHERE user_id = $1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1`, [payload.sub])
    if (!row) throw new BadRequestException('O código venceu: entre de novo para receber outro')
    if (row.attempts >= MAX_ATTEMPTS) throw new BadRequestException('Muitas tentativas com este código: entre de novo para receber outro')
    const want = Buffer.from(row.code_hash)
    const got = Buffer.from(codeHash(payload.sub, dto.code))
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      await this.db.query(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id])
      throw new BadRequestException(`Código errado (${MAX_ATTEMPTS - row.attempts - 1} tentativa(s) restante(s))`)
    }
    await this.db.query(`UPDATE login_codes SET used = true WHERE id = $1`, [row.id])
    const user = await this.users.findById(payload.sub)
    if (!user) throw new UnauthorizedException()
    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id])
    this.log.log(`Entrada: ${user.email} (${req.ip})`)
    return this.session(user)
  }

  // Usuário + filiais liberadas e a filial desta requisição (para o seletor no topo da tela).
  @Get('me')
  async me(@CurrentUser() user: User, @CurrentBranch() branch: string | null) {
    return { ...user, branches: allowedBranches(user, await branchList(this.db)), branchId: branch }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
