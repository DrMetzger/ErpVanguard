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

  // Filiais liberadas (vazio = todas) e a filial em que o usuário entra
  @Column({ name: 'branch_ids', type: 'uuid', array: true, default: () => "'{}'" })
  branchIds: string[]

  @Column({ name: 'default_branch_id', type: 'uuid', nullable: true })
  defaultBranchId: string | null

  // Recebe o código do login em duas etapas (vazio = o e-mail de login). Só o administrador vê.
  @Column({ name: 'two_factor_email', type: 'varchar', nullable: true, select: false })
  twoFactorEmail?: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
