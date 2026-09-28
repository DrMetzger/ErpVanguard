import { Module } from '@nestjs/common'
import { MailModule } from '../mail/mail.module'
import { NumberingController } from './numbering.controller'
import { QuotesController } from './quotes.controller'
import { SalesDocsService } from './sales-docs.service'
import { SalesEmailService } from './sales-email.service'
import { SalesController } from './sales.controller'

@Module({ imports: [MailModule], controllers: [QuotesController, SalesController, NumberingController], providers: [SalesDocsService, SalesEmailService] })
export class SalesModule {}
