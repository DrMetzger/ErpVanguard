import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { DataSource } from 'typeorm'
import { one } from '../common/db'

// Situação de bloqueio em memória por alguns segundos (evita consultar o banco em toda requisição).
const cache = new Map<string, { at: number; blocked: boolean; reason: string | null }>()
const TTL = 15_000
export const forgetDevice = (id: string) => cache.delete(id)

// O app do celular manda o identificador do aparelho (X-Device-Id); aparelho bloqueado não acessa nada.
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly db: DataSource) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>()
    const id = req.header('x-device-id')
    if (!id || id.length > 64 || req.path.endsWith('/health')) return true
    let hit = cache.get(id)
    if (!hit || Date.now() - hit.at > TTL) {
      const row = await one(this.db, `SELECT blocked, blocked_reason FROM devices WHERE id = $1`, [id])
      hit = { at: Date.now(), blocked: !!row?.blocked, reason: row?.blocked_reason ?? null }
      cache.set(id, hit)
    }
    if (hit.blocked) {
      throw new ForbiddenException({ statusCode: 403, code: 'DEVICE_BLOCKED', message: `Este aparelho foi bloqueado pelo administrador${hit.reason ? `: ${hit.reason}` : ''}`, reason: hit.reason })
    }
    return true
  }
}
