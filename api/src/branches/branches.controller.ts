import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put } from '@nestjs/common'
import { IsIn } from 'class-validator'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import type { User } from '../users/user.entity'
import { branchMode, forgetBranches } from './branch.context'
import { BRANCH_TABLES, branchTable } from './branch-tables'

class ModeDto { @IsIn(['C', 'E']) mode: 'C' | 'E' }

// Compartilhamento dos cadastros entre as filiais. Só muda enquanto o cadastro está vazio (como no Protheus).
@Controller('branch-modes')
export class BranchesController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list() {
    return Promise.all(BRANCH_TABLES.map(async (t) => ({
      table: t.table, label: t.label, mode: await branchMode(this.db, t.table), defaultMode: t.defaultMode,
      rows: Number((await this.db.query(`SELECT count(*) AS n FROM ${t.table}`))[0].n),
    })))
  }

  @Put(':table')
  async set(@CurrentUser() me: User, @Param('table') table: string, @Body() dto: ModeDto) {
    requireAdmin(me)
    const t = branchTable(table)
    if (!t) throw new NotFoundException('Cadastro não encontrado')
    if ((await branchMode(this.db, table)) === dto.mode) return this.list()
    const n = Number((await this.db.query(`SELECT count(*) AS n FROM ${t.table}`))[0].n)
    if (n > 0) throw new BadRequestException(`${t.label}: o modo só muda com o cadastro vazio (hoje tem ${n} registro(s))`)
    await this.db.query(`INSERT INTO branch_modes (tbl, mode, updated_by, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (tbl) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = now()`, [t.table, dto.mode, me.id])
    forgetBranches()
    return this.list()
  }
}
