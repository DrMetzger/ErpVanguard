import { Module } from '@nestjs/common'
import { BiController } from './bi.controller'

@Module({ controllers: [BiController] })
export class BiModule {}
