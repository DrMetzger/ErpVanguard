import { Module } from '@nestjs/common'
import { CostCentersController } from './cost-centers'
import { FinanceController } from './finance.controller'

@Module({ controllers: [FinanceController, CostCentersController] })
export class FinanceModule {}
