import { BadRequestException, Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { one, type Db } from '../common/db'
import { found } from '../purchasing/purchasing.helpers'
import { ParametersService, seriesModels } from '../params/parameters.service'
import type { User } from '../users/user.entity'
import { lockNumbering } from './numbering'

class CreateNumberingDto {
  @IsUUID() companyId: string
  @Type(() => Number) @IsInt() @Min(0) @Max(999) series: number
  @Type(() => Number) @IsInt() @Min(1) @Max(999999999) nextNumber: number
}

class UpdateNumberingDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999999999) nextNumber?: number
  @IsOptional() @IsBoolean() active?: boolean
  // Voltar a numeração só com confirmação (e se o número ainda não foi usado).
  @IsOptional() @IsBoolean() confirmBackward?: boolean
}

// Numeração das notas por empresa e série (modelo pela espécie do MV_ESPECIE). Só administradores.
@Controller('invoice-numbering')
export class NumberingController {
  constructor(private readonly db: DataSource, private readonly params: ParametersService) {}

  @Get()
  async list(@CurrentUser() me: User) {
    requireAdmin(me)
    const all = await this.params.all()
    const models = seriesModels(String(all.MV_ESPECIE))
    // Garante a linha da série de venda para cada empresa ativa (já aparece na tela com o número certo).
    const saleSeries = Number(all.MV_SERNFE)
    const saleModel = models.get(saleSeries)
    if (saleModel) {
      const companies: { id: string }[] = await this.db.query(`SELECT id FROM companies WHERE active`)
      for (const c of companies) await this.db.transaction((tx) => lockNumbering(tx, c.id, saleSeries, saleModel))
    }
    const rows = await this.db.query(
      `SELECT n.id, n.company_id AS "companyId", co.code || ' · ' || coalesce(co.trade_name, co.name) AS "companyLabel", n.series, n.model,
              n.next_number AS "nextNumber", n.active, n.updated_at AS "updatedAt", u.name AS "updatedBy",
              (SELECT max(number) FROM sales_invoices i WHERE i.company_id = n.company_id AND i.series = n.series) AS "lastUsed"
       FROM invoice_numbering n JOIN companies co ON co.id = n.company_id LEFT JOIN users u ON u.id = n.updated_by
       ORDER BY co.code, n.series`,
    )
    return {
      especie: all.MV_ESPECIE, saleSeries,
      series: [...models.entries()].map(([series, model]) => ({ series, model })),
      rows: rows.map((r: any) => ({ ...r, lastUsed: r.lastUsed === null ? null : Number(r.lastUsed), inEspecie: models.get(r.series) === r.model })),
    }
  }

  @Post()
  async create(@CurrentUser() me: User, @Body() dto: CreateNumberingDto) {
    requireAdmin(me)
    const model = seriesModels(String(await this.params.get('MV_ESPECIE'))).get(dto.series)
    if (!model) throw new BadRequestException(`A série ${dto.series} não está no parâmetro MV_ESPECIE`)
    found(await one(this.db, `SELECT id FROM companies WHERE id = $1`, [dto.companyId]), 'Empresa não encontrada')
    return this.db.transaction(async (tx) => {
      if (await one(tx, `SELECT 1 FROM invoice_numbering WHERE company_id = $1 AND series = $2`, [dto.companyId, dto.series])) throw new ConflictException('Esta série já está cadastrada para a empresa')
      await this.checkUnused(tx, dto.companyId, dto.series, dto.nextNumber)
      const row = await one(tx, `INSERT INTO invoice_numbering (company_id, series, model, next_number, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [dto.companyId, dto.series, model, dto.nextNumber, me.id])
      return { id: row!.id, series: dto.series, model, nextNumber: dto.nextNumber }
    })
  }

  // Avançar é livre (com aviso de inutilização); voltar só se nenhum número dali em diante foi usado, e com confirmação.
  @Put(':id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNumberingDto) {
    requireAdmin(me)
    return this.db.transaction(async (tx) => {
      const row = found(await one(tx, `SELECT * FROM invoice_numbering WHERE id = $1 FOR UPDATE`, [id]), 'Numeração não encontrada')
      const warnings: string[] = []
      const current = Number(row.next_number)
      const next = dto.nextNumber ?? current
      if (next < current) {
        await this.checkUnused(tx, row.company_id, row.series, next)
        if (!dto.confirmBackward) throw new BadRequestException(`Voltar a numeração de ${current} para ${next}: confirme a alteração`)
        warnings.push(`Numeração voltou de ${current} para ${next}. Confira se nenhuma nota com esses números foi transmitida à SEFAZ por outro sistema.`)
      } else if (next > current + 1) {
        warnings.push(`Os números ${current} a ${next - 1} vão ficar sem nota: precisam ser inutilizados na SEFAZ.`)
      }
      const active = dto.active ?? row.active
      await tx.query(`UPDATE invoice_numbering SET next_number = $2, active = $3, updated_by = $4, updated_at = now() WHERE id = $1`, [id, next, active, me.id])
      return { id, nextNumber: next, active, warnings }
    })
  }

  private async checkUnused(tx: Db, companyId: string, series: number, from: number) {
    const used = await one(tx, `SELECT max(number) AS n FROM sales_invoices WHERE company_id = $1 AND series = $2 AND number >= $3`, [companyId, series, from])
    if (used?.n) throw new ConflictException(`A NF ${used.n}/${series} já foi emitida: o próximo número tem de ser maior que ${used.n}`)
  }
}
