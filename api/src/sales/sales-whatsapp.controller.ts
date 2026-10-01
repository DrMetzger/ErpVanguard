import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { CurrentUser } from '../auth/current-user.decorator'
import type { User } from '../users/user.entity'
import { SalesDocsService } from './sales-docs.service'
import { SalesWhatsAppService, SendWhatsAppDto } from './sales-whatsapp.service'

// Orçamento, pedido e NF pelo WhatsApp: rascunho (número do cliente e texto) e envio.
@Controller()
export class SalesWhatsAppController {
  constructor(private readonly wa: SalesWhatsAppService, private readonly docs: SalesDocsService) {}

  @Get('sales-quotes/:id/whatsapp')
  quoteDraft(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) { this.docs.requireSales(me); return this.wa.draft('quote', id, me) }

  @Post('sales-quotes/:id/whatsapp') @HttpCode(200)
  quoteSend(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendWhatsAppDto) { this.docs.requireSales(me); return this.wa.send('quote', id, me, dto) }

  @Get('sales-orders/:id/whatsapp')
  orderDraft(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) { this.docs.requireSales(me); return this.wa.draft('order', id, me) }

  @Post('sales-orders/:id/whatsapp') @HttpCode(200)
  orderSend(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendWhatsAppDto) { this.docs.requireSales(me); return this.wa.send('order', id, me, dto) }

  @Get('sales-invoices/:id/whatsapp')
  invoiceDraft(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) { return this.wa.draft('invoice', id, me) }

  @Post('sales-invoices/:id/whatsapp') @HttpCode(200)
  invoiceSend(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendWhatsAppDto) { return this.wa.send('invoice', id, me, dto) }
}
