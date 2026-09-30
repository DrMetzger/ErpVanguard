import { PartialType } from '@nestjs/mapped-types'
import { IsBoolean, IsInt, IsObject, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator'

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
  @IsUUID()
  typeId?: string | null

  @IsOptional()
  @IsUUID()
  groupId?: string | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  origin?: number

  // Classificação tributária do IBS/CBS só deste produto (vazio = a da TES)
  @IsOptional()
  @IsUUID()
  classTribId?: string | null

  @IsOptional()
  @IsBoolean()
  active?: boolean

  @IsOptional()
  @IsObject()
  custom?: Record<string, unknown>
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
