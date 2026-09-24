import type { Permission, User } from './types'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })

export const money = (v: number | null | undefined) => brl.format(v ?? 0)
export const price = (v: number | null | undefined) => (v === null || v === undefined ? '—' : brl4.format(v))
export const qty = (v: number | null | undefined) => num.format(v ?? 0)
export const date = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('pt-BR') : '—')
export const cnpj = (v: string | null | undefined) =>
  !v ? '' : v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

export const can = (user: User | null | undefined, permission: Permission) => user?.role === 'admin' || !!user?.permissions.includes(permission)

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

// Converte o valor de um NumberInput (number | '') para number | null.
export const toNumber = (v: number | string | null | undefined) => (v === '' || v === null || v === undefined ? null : Number(v))

export function timeAgo(v: string) {
  const minutes = Math.round((Date.now() - new Date(v).getTime()) / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  return `há ${Math.round(hours / 24)} d`
}
