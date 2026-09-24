import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { isAdmin } from '../common/access'
import { Db, one } from '../common/db'
import type { User } from '../users/user.entity'

export const code = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`

// Comprador só atua nos grupos de compras de que faz parte.
export async function requireBuyerOf(db: Db, user: User, groupId: string) {
  if (isAdmin(user)) return
  const member = await one(db, `SELECT 1 FROM purchase_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, user.id])
  if (!member || !user.permissions.includes('comprador')) {
    throw new ForbiddenException('Você não é comprador deste grupo de compras')
  }
}

export async function buyerGroupIds(db: Db, user: User): Promise<string[] | null> {
  if (isAdmin(user)) return null // todos
  const rows = await db.query(`SELECT group_id FROM purchase_group_members WHERE user_id = $1`, [user.id])
  return rows.map((r: any) => r.group_id)
}

export function found<T = any>(row: T | undefined | null, message: string): NonNullable<T> {
  if (!row) throw new NotFoundException(message)
  return row as NonNullable<T>
}
