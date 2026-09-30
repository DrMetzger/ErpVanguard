import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

// numeric chega do Postgres como string; convertemos para number na leitura.
const numeric = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) }

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ unique: true })
  sku: string

  @Column()
  name: string

  @Column({ type: 'varchar', nullable: true })
  barcode: string | null

  @Column({ type: 'varchar', length: 8, nullable: true })
  ncm: string | null

  @Column({ default: 'UN' })
  unit: string

  @Column({ name: 'cost_price', type: 'numeric', precision: 14, scale: 4, default: 0, transformer: numeric })
  costPrice: number

  @Column({ name: 'sale_price', type: 'numeric', precision: 14, scale: 4, default: 0, transformer: numeric })
  salePrice: number

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0, transformer: numeric })
  stock: number

  @Column({ name: 'min_stock', type: 'numeric', precision: 14, scale: 4, default: 0, transformer: numeric })
  minStock: number

  @Column({ name: 'type_id', type: 'uuid', nullable: true })
  typeId: string | null

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null

  // Origem da mercadoria (0 = nacional, 1 = estrangeira importação direta, ...).
  @Column({ type: 'smallint', default: 0 })
  origin: number

  // cClassTrib do IBS/CBS só deste produto; vazio usa o da TES (reforma tributária)
  @Column({ name: 'class_trib_id', type: 'uuid', nullable: true })
  classTribId: string | null

  // Filial dona do produto quando o cadastro é exclusivo; vazio = compartilhado
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null

  // Miniatura da foto principal (data URL pequena) para as listas
  @Column({ type: 'text', nullable: true })
  thumb: string | null

  // Campos personalizados (Administração › Personalizar cadastros)
  @Column({ type: 'jsonb', default: () => "'{}'" })
  custom: Record<string, unknown>

  @Column({ default: true })
  active: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
