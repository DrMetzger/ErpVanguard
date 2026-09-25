import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export type UserRole = 'admin' | 'user'
export const PERMISSIONS = ['solicitante', 'comprador', 'aprovador', 'cadastro', 'fiscal', 'vendedor', 'faturamento', 'financeiro', 'bi'] as const
export type Permission = (typeof PERMISSIONS)[number]

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  name: string

  @Column({ unique: true })
  email: string

  @Column({ name: 'password_hash', select: false })
  passwordHash: string

  @Column({ type: 'varchar', default: 'user' })
  role: UserRole

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  permissions: Permission[]

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null

  @Column({ default: true })
  active: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
