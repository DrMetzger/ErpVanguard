import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, ServiceUnavailableException } from '@nestjs/common'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'
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
      )
      return { ok: matches[0]?.productId === 'p1', model, seconds: Math.round((Date.now() - started) / 100) / 10, answer: matches[0]?.reason ?? null }
    } catch (error: any) {
      throw new ServiceUnavailableException(error.message)
    }
  }
}
