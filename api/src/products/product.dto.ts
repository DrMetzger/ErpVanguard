import { PartialType } from '@nestjs/mapped-types'
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator'

export class CreateProductDto {
  @IsString()
  @Length(1, 40)
  sku: string

  @IsString()
  @Length(1, 200)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  barcode?: string

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'NCM deve ter 8 dígitos' })
  ncm?: string

  @IsOptional()
  @IsString()
  @Length(1, 6)
  unit?: string

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  salePrice?: number

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  stock?: number

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minStock?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
