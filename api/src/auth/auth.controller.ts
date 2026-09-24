import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { IsEmail, IsString, MinLength } from 'class-validator'
import { User } from '../users/user.entity'
import { UsersService } from '../users/users.service'
import { CurrentUser } from './current-user.decorator'
import { Public } from './public.decorator'

class LoginDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(1)
  password: string
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() { email, password }: LoginDto) {
    const user = await this.users.findByEmailWithPassword(email)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos')
    }
    const { passwordHash: _, ...profile } = user
    return { token: await this.jwt.signAsync({ sub: user.id }), user: profile }
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return user
  }
}
