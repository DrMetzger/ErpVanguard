import { BadRequestException, createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common'
import type { Db } from '../common/db'
import type { User } from '../users/user.entity'
import { branchTable } from './branch-tables'

export interface BranchInfo { id: string; code: string; name: string; tradeName: string | null; uf: string; isHead: boolean }

// Filiais (tabela companies) e modos dos cadastros mudam pouco: guardados por alguns segundos.
const TTL = 10_000
let branches: { at: number; rows: BranchInfo[] } | null = null
let modes: { at: number; map: Map<string, 'C' | 'E'> } | null = null
export function forgetBranches() { branches = null; modes = null }

export async function branchList(db: Db): Promise<BranchInfo[]> {
  if (branches && Date.now() - branches.at < TTL) return branches.rows
  const rows = await db.query(`SELECT id, code, name, trade_name AS "tradeName", uf, is_head AS "isHead" FROM companies WHERE active ORDER BY is_head DESC, code`)
  branches = { at: Date.now(), rows }
  return rows
}

// Admin e usuário sem filiais marcadas enxergam todas.
export function allowedBranches(user: Pick<User, 'role' | 'branchIds'>, all: BranchInfo[]) {
  if (user.role === 'admin' || !user.branchIds?.length) return all
  return all.filter((b) => user.branchIds.includes(b.id))
}

// Filial da requisição: a pedida no cabeçalho X-Branch-Id (se liberada), senão a padrão do usuário, senão a matriz.
export async function resolveBranch(db: Db, user: User, requested: string | undefined) {
  const allowed = allowedBranches(user, await branchList(db))
  if (requested) {
    const hit = allowed.find((b) => b.id === requested)
    if (hit) return hit.id
    throw new ForbiddenException({ message: 'Esta filial não está liberada para o seu usuário', code: 'BRANCH_DENIED' })
  }
  return (allowed.find((b) => b.id === user.defaultBranchId) ?? allowed[0])?.id ?? null
}

// Filial atual da requisição (null quando ainda não há empresa cadastrada).
export const CurrentBranch = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest().branch ?? null)

export async function branchMode(db: Db, table: string): Promise<'C' | 'E' | null> {
  if (!branchTable(table)) return null
  if (!modes || Date.now() - modes.at >= TTL) {
    const rows: { tbl: string; mode: 'C' | 'E' }[] = await db.query(`SELECT tbl, mode FROM branch_modes`)
    modes = { at: Date.now(), map: new Map(rows.map((r) => [r.tbl, r.mode])) }
  }
  return modes.map.get(table) ?? branchTable(table)!.defaultMode
}

// Condição SQL: registros compartilhados (branch_id vazio) ou da filial atual. `param` é o número do parâmetro ($n).
export const visibleIn = (alias: string, param: number) => `(${alias}.branch_id IS NULL OR ${alias}.branch_id = $${param}::uuid)`

// branch_id de um registro novo: a filial atual no cadastro exclusivo; vazio no compartilhado.
export async function branchForInsert(db: Db, table: string, branch: string | null) {
  const mode = await branchMode(db, table)
  if (mode !== 'E') return null
  if (!branch) throw new BadRequestException('Cadastre a empresa (matriz) antes: este cadastro é exclusivo por filial')
  return branch
}

// Documento numa filial escolhida: ela precisa estar liberada para o usuário.
export async function ensureBranchAccess(db: Db, user: User, companyId: string) {
  if (!allowedBranches(user, await branchList(db)).some((b) => b.id === companyId)) {
    throw new ForbiddenException({ message: 'Esta filial não está liberada para o seu usuário', code: 'BRANCH_DENIED' })
  }
}
