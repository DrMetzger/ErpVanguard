import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { config } from '../config'
import { MailModule } from '../mail/mail.module'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'

@Global()
@Module({
  imports: [
    UsersModule,
    MailModule,
    JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn as never } }),
  ],
  controllers: [AuthController],
  exports: [JwtModule, UsersModule],
})
export class AuthModule {}
