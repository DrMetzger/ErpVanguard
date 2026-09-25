import { Module } from '@nestjs/common'
import { QuotesController } from './quotes.controller'
import { SalesDocsService } from './sales-docs.service'
import { SalesController } from './sales.controller'

@Module({ controllers: [QuotesController, SalesController], providers: [SalesDocsService] })
export class SalesModule {}
