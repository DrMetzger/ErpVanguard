import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { config } from './config'
import { migrations } from './database/migrations'
import { HealthController } from './health/health.controller'
import { Product } from './products/product.entity'
import { ProductsModule } from './products/products.module'
import { User } from './users/user.entity'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.databaseUrl,
      entities: [User, Product],
      migrations,
      migrationsRun: true,
      synchronize: false,
    }),
    UsersModule,
    AuthModule,
    ProductsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
