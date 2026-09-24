import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common'
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { one } from '../common/db'
import type { User } from '../users/user.entity'

const LOGO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/
const MAX_LOGO_BYTES = 300 * 1024

class LogoDto {
  // null remove o logo
  @IsOptional() @IsString() @MaxLength(420_000, { message: 'Logo muito grande (máximo 300 KB)' }) logo: string | null
}

class BrandingQuery {
  @IsOptional() @IsUUID() companyId?: string
}

// Logo e dados da empresa que saem no cabeçalho do DANFE e dos relatórios (sem filial informada: a matriz).
@Controller('companies')
export class CompaniesController {
  constructor(private readonly db: DataSource) {}

  @Get('branding')
  async branding(@Query() q: BrandingQuery) {
    const company = await one(
      this.db,
      `SELECT id, code, name, trade_name AS "tradeName", document, ie, email, phone, zip, street, number, district, city, uf, logo
       FROM companies WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`,
      [q.companyId ?? null],
    )
    return company ?? null
  }

  @Get(':id/logo')
  async getLogo(@Param('id', ParseUUIDPipe) id: string) {
    const row = await one(this.db, `SELECT logo FROM companies WHERE id = $1`, [id])
    if (!row) throw new NotFoundException('Empresa/filial não encontrada')
    return { logo: row.logo }
  }

  @Put(':id/logo')
  async setLogo(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LogoDto) {
    requireAdmin(me)
    const logo = dto.logo || null
    if (logo) {
      if (!LOGO.test(logo)) throw new BadRequestException('Envie o logo em PNG ou JPG')
      if (Buffer.from(logo.split(',')[1]!, 'base64').length > MAX_LOGO_BYTES) throw new BadRequestException('Logo muito grande (máximo 300 KB)')
    }
    const [, count] = await this.db.query(`UPDATE companies SET logo = $2 WHERE id = $1`, [id, logo])
    if (!count) throw new NotFoundException('Empresa/filial não encontrada')
    return { logo }
  }
}
