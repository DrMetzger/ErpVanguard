import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, ServiceUnavailableException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { CurrentUser } from '../auth/current-user.decorator'
import { UFS } from '../catalog/resources'
import { requireAdmin } from '../common/access'
import { digits } from '../common/db'
import { isValidCnpj } from '../purchasing/documents'
import { matchWithGemini } from '../purchasing/gemini'
import type { User } from '../users/user.entity'
import { SettingsService } from './settings.service'

const MODEL = /^[a-z0-9][a-z0-9.\-]{1,80}$/

class GeminiDto {
  @IsOptional() @IsString() @Length(20, 200, { message: 'Chave do Gemini inválida' }) apiKey?: string
  @IsOptional() @IsBoolean() clearApiKey?: boolean
  @IsOptional() @IsString() @Matches(MODEL, { message: 'Nome de modelo inválido' }) model?: string
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(MODEL, { each: true, message: 'Nome de modelo reserva inválido' }) fallbackModels?: string[]
}

class SerasaDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsIn(['homologacao', 'producao']) environment?: 'homologacao' | 'producao'
  @IsOptional() @IsString() @Length(0, 200) clientId?: string
  @IsOptional() @IsString() @Length(8, 400, { message: 'Client secret inválido' }) clientSecret?: string
  @IsOptional() @IsBoolean() clearSecret?: boolean
}

class NfeDto {
  @IsBoolean() autoAi: boolean
}

class SmtpDto {
  @IsString() @Matches(/^[A-Za-z0-9.\-]{1,200}$/, { message: 'Servidor SMTP inválido' }) host: string
  @Type(() => Number) @IsInt() @Min(1) @Max(65535, { message: 'Porta inválida' }) port: number
  @IsIn(['ssl', 'starttls', 'nenhuma']) security: 'ssl' | 'starttls' | 'nenhuma'
  @IsOptional() @IsString() @MaxLength(200) user?: string
  @IsOptional() @IsString() @Length(1, 300) password?: string
  @IsOptional() @IsBoolean() clearPassword?: boolean
  @IsOptional() @IsString() @MaxLength(100) @Matches(/^[^\r\n<>"]*$/, { message: 'Nome do remetente inválido' }) fromName?: string
  @IsEmail({}, { message: 'E-mail do remetente inválido' }) fromEmail: string
  @IsOptional() @ValidateIf((o) => !!o.replyTo) @IsEmail({}, { message: 'E-mail de resposta inválido' }) replyTo?: string
}

class CompanyDto {
  @IsString() @Length(0, 200) name: string
  @IsString() cnpj: string
  @IsIn(UFS, { message: 'UF inválida' }) uf: string
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(@CurrentUser() me: User) {
    requireAdmin(me)
    const gemini = await this.settings.gemini()
    return {
      gemini: {
        configured: !!gemini.apiKey,
        source: gemini.source,
        apiKeyHint: gemini.apiKey ? `••••${gemini.apiKey.slice(-4)}` : null,
        model: gemini.model,
        fallbackModels: gemini.fallbackModels,
      },
      nfe: await this.settings.nfe(),
      serasa: await this.settings.serasa().then((s) => ({ enabled: s.enabled, environment: s.environment, clientId: s.clientId, secretHint: s.clientSecret ? `••••${s.clientSecret.slice(-4)}` : null })),
      company: await this.settings.company(),
      // A senha nunca sai daqui: só o aviso de que existe.
      smtp: await this.settings.smtp().then((s) => ({
        configured: !!s.host && !!s.fromEmail, source: s.source, host: s.host, port: s.port, security: s.security, user: s.user,
        passwordHint: s.password ? '••••••••' : null, fromName: s.fromName, fromEmail: s.fromEmail, replyTo: s.replyTo,
      })),
    }
  }

  @Put('gemini')
  async saveGemini(@CurrentUser() me: User, @Body() dto: GeminiDto) {
    requireAdmin(me)
    await this.settings.saveGemini(dto, me.id)
    return this.get(me)
  }

  @Put('serasa')
  async saveSerasa(@CurrentUser() me: User, @Body() dto: SerasaDto) {
    requireAdmin(me)
    if (dto.enabled) {
      const current = await this.settings.serasa()
      if (!(dto.clientId ?? current.clientId) || !(dto.clientSecret ?? current.clientSecret)) throw new BadRequestException('Para ativar, informe o client ID e o client secret do contrato com a Serasa')
    }
    await this.settings.saveSerasa(dto, me.id)
    return this.get(me)
  }

  @Put('smtp')
  async saveSmtp(@CurrentUser() me: User, @Body() dto: SmtpDto) {
    requireAdmin(me)
    await this.settings.saveSmtp(dto, me.id)
    return this.get(me)
  }

  @Put('nfe')
  async saveNfe(@CurrentUser() me: User, @Body() dto: NfeDto) {
    requireAdmin(me)
    await this.settings.saveNfe(dto, me.id)
    return this.get(me)
  }

  @Put('company')
  async saveCompany(@CurrentUser() me: User, @Body() dto: CompanyDto) {
    requireAdmin(me)
    const cnpj = digits(dto.cnpj)
    if (cnpj && !isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido')
    await this.settings.saveCompany({ name: dto.name.trim(), cnpj, uf: dto.uf }, me.id)
    return this.get(me)
  }

  // Testa a chave com itens de exemplo e diz qual modelo respondeu.
  @Post('gemini/test')
  @HttpCode(200)
  async testGemini(@CurrentUser() me: User) {
    requireAdmin(me)
    const gemini = await this.settings.gemini()
    if (!gemini.apiKey) throw new BadRequestException('Cadastre a chave do Gemini primeiro')
    const started = Date.now()
    try {
      const { matches, model } = await matchWithGemini(
        [{ itemNumber: 1, description: 'PARAF SEXT ZB 5X30MM', supplierCode: 'PX530', ean: null, ncm: '73181500', unit: 'UN' }],
        [
          { id: 'p1', sku: 'PAR-530', name: 'Parafuso sextavado zincado 5x30mm', ncm: '73181500', unit: 'UN' },
          { id: 'p2', sku: 'LUV-01', name: 'Luva nitrílica caixa 100', ncm: '40151900', unit: 'CX' },
        ],
        gemini,
        20_000,
      )
      return { ok: matches[0]?.productId === 'p1', model, seconds: Math.round((Date.now() - started) / 100) / 10, answer: matches[0]?.reason ?? null }
    } catch (error: any) {
      throw new ServiceUnavailableException(error.message)
    }
  }
}
