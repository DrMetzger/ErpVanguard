import { CallHandler, ConflictException, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import type { Request, Response } from 'express'
import { from, Observable, of, throwError } from 'rxjs'
import { catchError, mergeMap, tap } from 'rxjs/operators'
import { DataSource } from 'typeorm'
import { one } from '../common/db'

const KEY = /^[A-Za-z0-9_-]{8,80}$/
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Mesma gravação enviada duas vezes (fila do celular sem internet, clique duplo): a segunda devolve a primeira resposta.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger('Idempotência')
  constructor(private readonly db: DataSource) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>()
    const res = ctx.switchToHttp().getResponse<Response>()
    const key = req.header('idempotency-key')
    if (!key || !WRITE.has(req.method) || !req.user?.id || !KEY.test(key)) return next.handle()
    const userId = req.user.id
    return from(this.claim(userId, key, req)).pipe(
      mergeMap((previous) => {
        if (previous) {
          res.status(previous.status)
          res.setHeader('Idempotent-Replay', 'true')
          if (previous.status >= 400) return throwError(() => new HttpException(previous.body ?? {}, previous.status))
          return of(previous.body)
        }
        return next.handle().pipe(
          tap((body) => void this.save(userId, key, res.statusCode || 200, body)),
          catchError((error) => {
            // Erro de validação (4xx) fica guardado; erro do servidor (5xx) libera a chave para tentar de novo.
            const status = error instanceof HttpException ? error.getStatus() : 500
            if (status < 500) void this.save(userId, key, status, error instanceof HttpException ? error.getResponse() : null)
            else void this.db.query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [userId, key])
            return throwError(() => error)
          }),
        )
      }),
    )
  }

  private async claim(userId: string, key: string, req: Request) {
    await this.db.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'`).catch(() => undefined)
    const inserted = await this.db.query(
      `INSERT INTO idempotency_keys (user_id, key, method, path) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING key`,
      [userId, key, req.method, req.originalUrl.slice(0, 500)],
    )
    if (inserted.length) return null
    const row = await one(this.db, `SELECT status, body, method, path FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [userId, key])
    if (!row) return null
    if (row.status === null) throw new ConflictException('Esta gravação ainda está sendo processada; aguarde')
    return { status: row.status as number, body: row.body }
  }

  private async save(userId: string, key: string, status: number, body: unknown) {
    try {
      const json = body === undefined ? null : JSON.stringify(body)
      await this.db.query(`UPDATE idempotency_keys SET status = $3, body = $4 WHERE user_id = $1 AND key = $2`,
        [userId, key, status, json && json.length > 1_000_000 ? null : json])
    } catch (error: any) {
      this.log.warn(`Não guardou a resposta: ${error.message}`)
    }
  }
}
