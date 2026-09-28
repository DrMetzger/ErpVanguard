import { Body, Controller, Get, Put } from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import type { User } from '../users/user.entity'
import { PARAMS, ParametersService } from './parameters.service'

@Controller('parameters')
export class ParametersController {
  constructor(private readonly params: ParametersService) {}

  @Get()
  async list(@CurrentUser() me: User) {
    requireAdmin(me)
    const values = await this.params.all()
    return PARAMS.map(({ pattern: _pattern, ...p }) => ({ ...p, value: values[p.key] }))
  }

  @Put()
  async save(@CurrentUser() me: User, @Body() body: Record<string, unknown>) {
    requireAdmin(me)
    await this.params.save(body, me.id)
    return this.list(me)
  }
}
