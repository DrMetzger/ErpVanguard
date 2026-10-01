import { Module } from '@nestjs/common'
import { MailModule } from '../mail/mail.module'
import { IntegrationsModule } from '../integrations/integrations.module'
import { SalesWhatsAppService } from './sales-whatsapp.service'
import { SalesWhatsAppController } from './sales-whatsapp.controller'
import { NfeController } from '../nfe/nfe.controller'
import { NfeService } from '../nfe/nfe.service'
import { NumberingController } from './numbering.controller'
import { QuotesController } from './quotes.controller'
import { SalesDocsService } from './sales-docs.service'
import { SalesEmailService } from './sales-email.service'
import { SalesController } from './sales.controller'

@Module({ imports: [MailModule, IntegrationsModule], controllers: [QuotesController, SalesController, NumberingController, NfeController, SalesWhatsAppController], providers: [SalesDocsService, SalesEmailService, NfeService, SalesWhatsAppService], exports: [SalesDocsService] })
export class SalesModule {}
