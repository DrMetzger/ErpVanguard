import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator'
import type { Response } from 'express'
import { CurrentUser } from '../auth/current-user.decorator'
import { requirePermission } from '../common/access'
import type { User } from '../users/user.entity'
import { NfeService } from './nfe.service'

class CancelNfeDto {
  @IsString() @Length(15, 255, { message: 'Justificativa de 15 a 255 caracteres (exigência da SEFAZ)' }) justificativa: string
}
class CceDto {
  @IsString() @Length(15, 1000, { message: 'Correção de 15 a 1000 caracteres (exigência da SEFAZ)' }) correcao: string
}
class VoidDto {
  @IsOptional() @IsUUID() companyId?: string
  @Type(() => Number) @IsInt() @Min(0) @Max(999) serie: number
  @Type(() => Number) @IsInt() @Min(1) @Max(999999999) inicio: number
  @Type(() => Number) @IsInt() @Min(1) @Max(999999999) fim: number
  @IsString() @Length(15, 255, { message: 'Justificativa de 15 a 255 caracteres (exigência da SEFAZ)' }) justificativa: string
}
class CompanyQuery {
  @IsOptional() @IsUUID() companyId?: string
}

// NF-e própria (modelo 55): XML, transmissão, DANFE e eventos. Perfil "faturamento" (ou administrador).
// As rotas valem com /sales-invoices/:id/nfe/... (padrão da API) e /sales/invoices/:id/nfe/...
@Controller()
export class NfeController {
  constructor(private readonly nfe: NfeService) {}

  @Post(['sales-invoices/:id/nfe/xml', 'sales/invoices/:id/nfe/xml'])
  @HttpCode(200)
  generate(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'faturamento')
    return this.nfe.generate(id)
  }

  @Get(['sales-invoices/:id/nfe/xml', 'sales/invoices/:id/nfe/xml'])
  async xml(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    requirePermission(me, 'faturamento')
    const f = await this.nfe.file(id)
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`)
    res.send(f.xml)
  }

  @Get(['sales-invoices/:id/nfe/danfe', 'sales/invoices/:id/nfe/danfe'])
  async danfe(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    requirePermission(me, 'faturamento')
    const f = await this.nfe.danfe(id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${f.name}"`)
    res.send(f.pdf)
  }

  @Post(['sales-invoices/:id/nfe/transmit', 'sales/invoices/:id/nfe/transmit'])
  @HttpCode(200)
  transmit(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requirePermission(me, 'faturamento')
    return this.nfe.transmit(id, me.id)
  }

  @Post(['sales-invoices/:id/nfe/cancel', 'sales/invoices/:id/nfe/cancel'])
  @HttpCode(200)
  cancel(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelNfeDto) {
    requirePermission(me, 'faturamento')
    return this.nfe.cancel(id, dto.justificativa.trim(), me.id)
  }

  @Post(['sales-invoices/:id/nfe/cce', 'sales/invoices/:id/nfe/cce'])
  @HttpCode(200)
  cce(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CceDto) {
    requirePermission(me, 'faturamento')
    return this.nfe.correction(id, dto.correcao.trim(), me.id)
  }

  @Post('invoice-numbering/inutilizar')
  @HttpCode(200)
  async voidNumbers(@CurrentUser() me: User, @Body() dto: VoidDto) {
    requirePermission(me, 'faturamento')
    const companyId = dto.companyId ?? (await this.nfe.defaultCompany())
    return this.nfe.voidNumbers({ companyId, series: dto.serie, from: dto.inicio, to: dto.fim, reason: dto.justificativa.trim() }, me.id)
  }

  @Get('invoice-numbering/inutilizacoes')
  voided(@CurrentUser() me: User, @Query() q: CompanyQuery) {
    requirePermission(me, 'faturamento')
    return this.nfe.voided(q.companyId)
  }

  @Get('sefaz/status')
  status(@CurrentUser() me: User, @Query() q: CompanyQuery) {
    requirePermission(me, 'faturamento')
    return this.nfe.status(q.companyId, me.id)
  }
}
