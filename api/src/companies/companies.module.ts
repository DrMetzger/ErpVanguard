import { Module } from '@nestjs/common'
import { CertificatesController } from './certificates.controller'
import { CompaniesController } from './companies.controller'

@Module({ controllers: [CompaniesController, CertificatesController] })
export class CompaniesModule {}
