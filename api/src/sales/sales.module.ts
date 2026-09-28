import { Module } from '@nestjs/common'
import { NumberingController } from './numbering.controller'
import { QuotesController } from './quotes.controller'
import { SalesDocsService } from './sales-docs.service'
import { SalesController } from './sales.controller'

@Module({ controllers: [QuotesController, SalesController, NumberingController], providers: [SalesDocsService] })
export class SalesModule {}
