import { Module } from '@nestjs/common'
import { BrController } from './br.controller'
import { CatalogController } from './catalog.controller'
import { ExtrasController } from './extras.controller'

@Module({ controllers: [BrController, ExtrasController, CatalogController] })
export class CatalogModule {}
