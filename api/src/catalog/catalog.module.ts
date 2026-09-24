import { Module } from '@nestjs/common'
import { CatalogController } from './catalog.controller'
import { ExtrasController } from './extras.controller'

@Module({ controllers: [ExtrasController, CatalogController] })
export class CatalogModule {}
