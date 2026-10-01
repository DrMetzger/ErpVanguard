import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { config } from './config'

async function bootstrap() {
  // rawBody: o webhook do WhatsApp confere a assinatura da Meta sobre o corpo original.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  // XML de NF-e com muitos itens e certificados A1 passam de 100 KB.
  app.useBodyParser('json', { limit: '5mb' })
  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.corsOrigins, allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Idempotency-Key', 'X-Device-Id', 'X-Branch-Id'], exposedHeaders: ['Content-Disposition', 'Idempotent-Replay'] })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()
  await app.listen(config.port, '0.0.0.0')
  Logger.log(`API ouvindo na porta ${config.port}`, 'Bootstrap')
}

bootstrap()
