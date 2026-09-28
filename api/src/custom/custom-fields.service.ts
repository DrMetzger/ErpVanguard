import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { Db } from '../common/db'
import { checkMask } from './masks'

// Cadastros que aceitam campos personalizados: nome do cadastro -> tabela.
export const CUSTOMIZABLE: Record<string, { table: string; title: string }> = {
  products: { table: 'products', title: 'Produtos' },
  suppliers: { table: 'suppliers', title: 'Fornecedores' },
  customers: { table: 'customers', title: 'Clientes' },
  companies: { table: 'companies', title: 'Empresas e filiais' },
  'product-groups': { table: 'product_groups', title: 'Grupos de produtos' },
  'product-types': { table: 'product_types', title: 'Tipos de produto' },
  units: { table: 'units', title: 'Unidades de medida' },
  ncm: { table: 'ncm', title: 'NCM' },
  'price-tables': { table: 'price_tables', title: 'Tabelas de preço' },
  'bank-accounts': { table: 'bank_accounts', title: 'Bancos e caixa' },
  'payment-terms': { table: 'payment_terms', title: 'Condições de pagamento' },
}

export const FIELD_TYPES = ['text', 'memo', 'number', 'integer', 'currency', 'date', 'bool', 'select', 'radio', 'multiselect'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface CustomFieldDef {
  id: string; key: string; label: string; type: FieldType; mask: string | null
  options: string[]; required: boolean; showInList: boolean; help: string | null; position: number; active: boolean
}

// Confere e normaliza um valor para o tipo do campo. Lança Error com a mensagem.
export function normalizeValue(d: Pick<CustomFieldDef, 'type' | 'options' | 'mask'>, v: unknown): unknown {
  switch (d.type) {
    case 'text': {
      if (typeof v !== 'string' || v.length > 500) throw new Error('texto inválido (até 500 caracteres)')
      const t = v.trim()
      if (d.mask) { const m = checkMask(d.mask, d.mask === 'placa' ? t.toUpperCase() : t); if (m) throw new Error(m) }
      return d.mask === 'placa' ? t.toUpperCase() : t
    }
    case 'memo':
      if (typeof v !== 'string' || v.length > 5000) throw new Error('texto inválido (até 5.000 caracteres)')
      return v.trim()
    case 'number':
    case 'integer':
    case 'currency': {
      // "2.500,50" (formato brasileiro) ou "2500.5"/2500.5
      const n = typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v.trim()) : Number(v)
      if (typeof v === 'boolean' || !Number.isFinite(n)) throw new Error('número inválido')
      if (d.type === 'integer' && !Number.isInteger(n)) throw new Error('use um número inteiro')
      return d.type === 'currency' ? Math.round(n * 100) / 100 : n
    }
    case 'date':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('data inválida')
      return v
    case 'bool':
      if (typeof v !== 'boolean') throw new Error('use sim ou não')
      return v
    case 'select':
    case 'radio':
      if (typeof v !== 'string' || !d.options.includes(v)) throw new Error('opção inválida')
      return v
    case 'multiselect': {
      const list = Array.isArray(v) ? v : [v]
      if (!list.every((x) => typeof x === 'string' && d.options.includes(x))) throw new Error('opção inválida')
      return [...new Set(list as string[])]
    }
  }
}

// Converte um valor já gravado quando o tipo do campo muda (ex.: lista → várias opções).
export function convertValue(from: FieldType, to: Pick<CustomFieldDef, 'type' | 'options' | 'mask'>, v: unknown): unknown {
  let x = v
  if (from === 'multiselect' && to.type !== 'multiselect') {
    const list = Array.isArray(v) ? v : [v]
    if (list.length > 1) throw new Error('tem mais de uma opção marcada')
    x = list[0]
  }
  if (to.type === 'multiselect' && !Array.isArray(x)) x = [x]
  if (['text', 'memo'].includes(to.type) && typeof x !== 'string') x = typeof x === 'boolean' ? (x ? 'Sim' : 'Não') : String(x)
  return normalizeValue(to, x)
}

@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: DataSource) {}

  definitions(resource: string, db: Db = this.db, onlyActive = true): Promise<CustomFieldDef[]> {
    return db.query(
      `SELECT id, key, label, type, mask, options, required, show_in_list AS "showInList", help, position, active
       FROM custom_fields WHERE resource = $1 AND ($2 = false OR active) ORDER BY position, label`,
      [resource, onlyActive],
    )
  }

  async layout(resource: string) {
    const [row] = await this.db.query(`SELECT hidden, field_order AS "order", labels FROM form_layouts WHERE resource = $1`, [resource])
    return (row ?? { hidden: [], order: [], labels: {} }) as { hidden: string[]; order: string[]; labels: Record<string, string> }
  }

  // Confere os valores enviados contra as definições e devolve o objeto a gravar (mantém os outros valores).
  async validate(resource: string, input: unknown, current: Record<string, unknown> = {}, creating = false, db: Db = this.db) {
    if (input === undefined && !creating) return undefined
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) throw new BadRequestException('Campos personalizados inválidos')
    const defs = await this.definitions(resource, db)
    const values = (input ?? {}) as Record<string, unknown>
    const unknown = Object.keys(values).filter((k) => !defs.some((d) => d.key === k))
    if (unknown.length) throw new BadRequestException(`Campo personalizado desconhecido: ${unknown.join(', ')}`)
    const out: Record<string, unknown> = { ...current }
    for (const d of defs) {
      if (!(d.key in values)) {
        if (d.required && (out[d.key] === undefined || out[d.key] === null || out[d.key] === '')) throw new BadRequestException(`Informe ${d.label}`)
        continue
      }
      const v = values[d.key]
      const fail = (msg: string) => { throw new BadRequestException(`${d.label}: ${msg}`) }
      if (v === null || v === '' || v === undefined) {
        if (d.required) fail('obrigatório')
        delete out[d.key]
        continue
      }
      try {
        out[d.key] = normalizeValue(d, v)
      } catch (error: any) {
        fail(error.message)
      }
      if (Array.isArray(out[d.key]) && !(out[d.key] as unknown[]).length) {
        if (d.required) fail('marque ao menos uma opção')
        delete out[d.key]
      }
    }
    return out
  }
}
