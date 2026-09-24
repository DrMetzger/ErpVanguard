import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator'
import { Repository } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { requireAdmin } from '../common/access'
import { PERMISSIONS, type Permission, User, type UserRole } from './user.entity'

class CreateUserDto {
  @IsString() @Length(1, 120) name: string
  @IsEmail() email: string
  @IsString() @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' }) password: string
  @IsOptional() @IsIn(['admin', 'user']) role?: UserRole
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSIONS, { each: true }) permissions?: Permission[]
}

class UpdateUserDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string
  @IsOptional() @IsIn(['admin', 'user']) role?: UserRole
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSIONS, { each: true }) permissions?: Permission[]
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' }) password?: string
}

class AvatarDto {
  // "estilo:semente" (DiceBear) ou vazio para iniciais.
  @IsOptional() @IsString() @Matches(/^[a-z-]{2,30}:[\w-]{1,40}$/, { message: 'Avatar inválido' }) avatar?: string | null
}

class ChangePasswordDto {
  @IsString() currentPassword: string
  @IsString() @MinLength(8, { message: 'A nova senha precisa ter pelo menos 8 caracteres' }) newPassword: string
}

@Controller()
export class UsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  // Lista enxuta usada nos seletores (grupos, alçadas) por qualquer usuário logado.
  @Get('users')
  list() {
    return this.users.find({ order: { name: 'ASC' } })
  }

  @Post('users')
  async create(@CurrentUser() me: User, @Body() dto: CreateUserDto) {
    requireAdmin(me)
    const email = dto.email.toLowerCase()
    if (await this.users.existsBy({ email })) throw new ConflictException('Já existe um usuário com este e-mail')
    const user = await this.users.save(
      this.users.create({
        name: dto.name,
        email,
        role: dto.role ?? 'user',
        permissions: dto.permissions ?? [],
        passwordHash: await bcrypt.hash(dto.password, 12),
      }),
    )
    const { passwordHash: _, ...profile } = user
    return profile
  }

  @Patch('users/:id')
  async update(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    requireAdmin(me)
    const user = await this.users.findOneBy({ id })
    if (!user) throw new NotFoundException('Usuário não encontrado')
    if (id === me.id && (dto.active === false || dto.role === 'user')) {
      throw new BadRequestException('Você não pode desativar nem tirar o perfil de administrador de si mesmo')
    }
    const { password, ...fields } = dto
    Object.assign(user, fields)
    if (password) user.passwordHash = await bcrypt.hash(password, 12)
    const { passwordHash: _, ...profile } = await this.users.save(user)
    return profile
  }

  @Patch('auth/me')
  async updateMe(@CurrentUser() me: User, @Body() dto: AvatarDto) {
    await this.users.update(me.id, { avatar: dto.avatar || null })
    return this.users.findOneBy({ id: me.id })
  }

  @Post('auth/password')
  @HttpCode(204)
  async changePassword(@CurrentUser() me: User, @Body() dto: ChangePasswordDto) {
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: me.id }).getOne()
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta')
    }
    await this.users.update(me.id, { passwordHash: await bcrypt.hash(dto.newPassword, 12) })
  }
}
