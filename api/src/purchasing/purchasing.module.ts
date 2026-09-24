import { Module } from '@nestjs/common'
import { GroupsController } from './groups.controller'
import { InvoicesController } from './invoices.controller'
import { NotificationsController } from './notifications.controller'
import { OrdersController } from './orders.controller'
import { QuotationsController } from './quotations.controller'
import { RequestsController } from './requests.controller'
import { SuppliersController } from './suppliers.controller'

@Module({
  controllers: [SuppliersController, GroupsController, RequestsController, QuotationsController, OrdersController, InvoicesController, NotificationsController],
})
export class PurchasingModule {}
