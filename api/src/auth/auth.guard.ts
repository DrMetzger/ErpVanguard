import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { UsersService } from '../users/users.service'
import { IS_PUBLIC } from './public.decorator'

// Toda rota exige token, exceto as marcadas com @Public().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>()
    const [type, token] = request.headers.authorization?.split(' ') ?? []
    if (type !== 'Bearer' || !token) throw new UnauthorizedException()

    let payload: { sub: string }
    try {
      payload = await this.jwt.verifyAsync(token)
    } catch {
      throw new UnauthorizedException()
    }
    const user = await this.users.findById(payload.sub)
    if (!user) throw new UnauthorizedException()
    request.user = user
    return true
  }
}
