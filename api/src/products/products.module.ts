import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Product } from './product.entity'
import { ProductPhotosController } from './product-photos.controller'
import { ProductVideosController } from './product-videos.controller'
import { ProductsController } from './products.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [ProductPhotosController, ProductVideosController, ProductsController],
})
export class ProductsModule {}
