import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { Db } from '../common/db'

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

export interface CustomFieldDef {
  id: string; key: string; label: string; type: 'text' | 'number' | 'date' | 'bool' | 'select'
  options: string[]; required: boolean; showInList: boolean; help: string | null; position: number; active: boolean
}

@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: DataSource) {}

  definitions(resource: string, db: Db = this.db, onlyActive = true): Promise<CustomFieldDef[]> {
    return db.query(
      `SELECT id, key, label, type, options, required, show_in_list AS "showInList", help, position, active
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
      switch (d.type) {
        case 'text':
          if (typeof v !== 'string' || v.length > 500) fail('texto inválido (até 500 caracteres)')
          out[d.key] = (v as string).trim()
          break
        case 'number': {
          const n = Number(v)
          if (!Number.isFinite(n)) fail('número inválido')
          out[d.key] = n
          break
        }
        case 'date':
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('data inválida')
          out[d.key] = v
          break
        case 'bool':
          if (typeof v !== 'boolean') fail('use sim ou não')
          out[d.key] = v
          break
        case 'select':
          if (typeof v !== 'string' || !d.options.includes(v)) fail('opção inválida')
          out[d.key] = v
          break
      }
    }
    return out
  }
}
