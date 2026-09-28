import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { CatalogModule } from './catalog/catalog.module'
import { BiModule } from './bi/bi.module'
import { DevicesModule } from './devices/devices.module'
import { IdempotencyInterceptor } from './devices/idempotency.interceptor'
import { DeviceGuard } from './devices/device.guard'
import { CompaniesModule } from './companies/companies.module'
import { CreditModule } from './credit/credit.module'
import { CustomFieldsModule } from './custom/custom-fields.module'
import { ParametersModule } from './params/parameters.module'
import { FinanceModule } from './finance/finance.module'
import { SalesModule } from './sales/sales.module'
import { config } from './config'
import { migrations } from './database/migrations'
import { HealthController } from './health/health.controller'
import { Product } from './products/product.entity'
import { ProductsModule } from './products/products.module'
import { PurchasingModule } from './purchasing/purchasing.module'
import { SettingsModule } from './settings/settings.module'
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
    PurchasingModule,
    SettingsModule,
    CatalogModule,
    CompaniesModule,
    CreditModule,
    CustomFieldsModule,
    ParametersModule,
    FinanceModule,
    SalesModule,
    BiModule,
    DevicesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: DeviceGuard }, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
