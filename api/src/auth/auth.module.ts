import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { config } from '../config'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'

@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn as never } }),
  ],
  controllers: [AuthController],
  exports: [JwtModule, UsersModule],
})
export class AuthModule {}
