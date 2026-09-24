import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { Repository } from 'typeorm'
import { config } from '../config'
import { User } from './user.entity'

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name)

  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  // Cria o primeiro administrador quando o banco ainda não tem usuários.
  async onApplicationBootstrap() {
    if ((await this.users.count()) > 0) return
    if (!config.adminPassword) {
      this.logger.warn('Nenhum usuário cadastrado e ADMIN_PASSWORD não definida: administrador não criado')
      return
    }
    await this.users.save(
      this.users.create({
        name: 'Administrador',
        email: config.adminEmail.toLowerCase(),
        passwordHash: await bcrypt.hash(config.adminPassword, 12),
        role: 'admin',
      }),
    )
    this.logger.log(`Administrador ${config.adminEmail} criado`)
  }

  findById(id: string) {
    return this.users.findOneBy({ id, active: true })
  }

  findByEmailWithPassword(email: string) {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email AND user.active = true', { email: email.toLowerCase() })
      .getOne()
  }
}
