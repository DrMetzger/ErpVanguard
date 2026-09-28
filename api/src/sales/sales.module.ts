import { Module } from '@nestjs/common'
import { MailModule } from '../mail/mail.module'
import { QuotesController } from './quotes.controller'
import { SalesDocsService } from './sales-docs.service'
import { SalesEmailService } from './sales-email.service'
import { SalesController } from './sales.controller'

@Module({ imports: [MailModule], controllers: [QuotesController, SalesController], providers: [SalesDocsService, SalesEmailService] })
export class SalesModule {}
