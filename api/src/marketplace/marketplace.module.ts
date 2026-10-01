import { Module } from '@nestjs/common'
import { IntegrationsModule } from '../integrations/integrations.module'
import { SalesModule } from '../sales/sales.module'
import { MercadoLivreController } from './mercadolivre.controller'
import { MercadoLivreService } from './mercadolivre.service'

@Module({ imports: [IntegrationsModule, SalesModule], controllers: [MercadoLivreController], providers: [MercadoLivreService] })
export class MarketplaceModule {}
