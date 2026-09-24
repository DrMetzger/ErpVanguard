import { ForbiddenException } from '@nestjs/common'
import type { Permission, User } from '../users/user.entity'

export const isAdmin = (user: User) => user.role === 'admin'

// Administrador tem todas as permissões.
export const can = (user: User, permission: Permission) => isAdmin(user) || user.permissions.includes(permission)

export function requireAdmin(user: User) {
  if (!isAdmin(user)) throw new ForbiddenException('Apenas administradores')
}

export function requirePermission(user: User, permission: Permission) {
  if (!can(user, permission)) throw new ForbiddenException(`Seu usuário não tem o perfil "${permission}"`)
}
