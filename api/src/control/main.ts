import 'reflect-metadata'
import { Logger, Module, ValidationPipe } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AgentController } from './agent'
import { ControlAuthController, ControlGuard } from './auth'
import { control } from './control-config'
import { migrate } from './store'
import { TenantsController, TenantsService } from './tenants'

@Module({ controllers: [ControlAuthController, TenantsController, AgentController], providers: [TenantsService, { provide: APP_GUARD, useClass: ControlGuard }] })
class ControlModule {}

// Painel da Prime ERP: serviço separado do ERP (admin.erpvanguard.com.br → /api).
// Não tem acesso ao Docker nem ao servidor; só grava pedidos para o agente da VPS.
async function bootstrap() {
  await migrate()
  const app = await NestFactory.create<NestExpressApplication>(ControlModule, { bodyParser: false })
  app.useBodyParser('json', { limit: '100kb' })
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' })
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()
  await app.listen(control.port, '0.0.0.0')
  Logger.log(`Painel ouvindo na porta ${control.port}`, 'Painel')
}
void bootstrap()
