import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { IsBase64, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { one } from '../common/db'
import { encrypt } from '../settings/settings.service'
import type { User } from '../users/user.entity'
import { readPfx } from './pfx'

const ENVIRONMENTS = ['homologacao', 'producao'] as const
type Environment = (typeof ENVIRONMENTS)[number]

class UploadDto {
  @IsUUID() companyId: string
  @IsBase64({}, { message: 'Arquivo inválido' }) @Length(100, 200_000, { message: 'Arquivo do certificado inválido' }) file: string
  @IsString() @Length(1, 200, { message: 'Informe a senha do certificado' }) password: string
  @IsOptional() @IsIn(ENVIRONMENTS, { message: 'Ambiente inválido' }) environment?: Environment
}
class EnvironmentDto {
  @IsIn(ENVIRONMENTS, { message: 'Ambiente inválido' }) environment: Environment
}

const LIST = `
  SELECT c.id, c.company_id AS "companyId", co.code || ' · ' || coalesce(co.trade_name, co.name) AS "companyLabel",
         c.subject, c.holder_document AS "holderDocument", c.issuer, c.serial, c.valid_from AS "validFrom", c.valid_to AS "validTo",
         c.active, c.created_at AS "createdAt", u.name AS "uploadedBy", c.environment,
         c.environment_changed_at AS "environmentChangedAt", (SELECT name FROM users WHERE id = c.environment_changed_by) AS "environmentChangedBy",
         floor(extract(epoch FROM c.valid_to - now()) / 86400)::int AS "daysLeft"
  FROM certificates c JOIN companies co ON co.id = c.company_id LEFT JOIN users u ON u.id = c.uploaded_by`

const date = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

// Certificado digital A1 das empresas. Só o administrador mexe; o arquivo e a senha nunca voltam para a tela.
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@CurrentUser() me: User) {
    requireAdmin(me)
    return this.db.query(`${LIST} ORDER BY c.active DESC, co.code, c.valid_to DESC`)
  }

  @Post()
  async upload(@CurrentUser() me: User, @Body() dto: UploadDto) {
    requireAdmin(me)
    const company = await one(this.db, `SELECT id, document, name FROM companies WHERE id = $1`, [dto.companyId])
    if (!company) throw new NotFoundException('Empresa/filial não encontrada')
    const file = Buffer.from(dto.file, 'base64')

    let info
    try {
      info = readPfx(file, dto.password)
    } catch (error: any) {
      throw new BadRequestException(error.message)
    }
    if (info.validTo.getTime() < Date.now()) throw new BadRequestException(`Certificado vencido em ${date(info.validTo)}`)
    // Filial pode usar o certificado da matriz: basta a raiz do CNPJ (8 primeiros dígitos) ser a mesma.
    if (info.holderDocument.slice(0, 8) !== String(company.document).slice(0, 8)) {
      throw new BadRequestException(`Este certificado é do CNPJ ${info.holderDocument}, que não é da empresa ${company.name} (${company.document})`)
    }

    const id = await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE certificates SET active = false WHERE company_id = $1 AND active`, [company.id])
      const row = await one(
        tx,
        `INSERT INTO certificates (company_id, subject, holder_document, issuer, serial, thumbprint, valid_from, valid_to, pfx, password, uploaded_by, environment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [company.id, info.subject, info.holderDocument, info.issuer, info.serial, info.thumbprint, info.validFrom, info.validTo,
          JSON.stringify(encrypt(dto.file)), JSON.stringify(encrypt(dto.password)), me.id, dto.environment ?? 'homologacao'],
      )
      return row!.id
    })
    return one(this.db, `${LIST} WHERE c.id = $1`, [id])
  }

  // Homologação = testes na SEFAZ (sem valor fiscal); produção = notas valendo. Registra quem trocou e quando.
  @Patch(':id/environment')
  async environment(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnvironmentDto) {
    requireAdmin(me)
    const [, count] = await this.db.query(
      `UPDATE certificates SET environment = $2, environment_changed_at = now(), environment_changed_by = $3 WHERE id = $1 AND environment <> $2`, [id, dto.environment, me.id])
    if (!count && !(await one(this.db, `SELECT 1 FROM certificates WHERE id = $1`, [id]))) throw new NotFoundException('Certificado não encontrado')
    return one(this.db, `${LIST} WHERE c.id = $1`, [id])
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(me)
    const [, count] = await this.db.query(`DELETE FROM certificates WHERE id = $1`, [id])
    if (!count) throw new NotFoundException('Certificado não encontrado')
  }
}
