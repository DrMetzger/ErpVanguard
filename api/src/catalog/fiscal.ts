import { NotFoundException } from '@nestjs/common'
import { one, type Db } from '../common/db'

export interface FiscalInput { operationTypeId: string; companyId?: string | null; uf?: string | null; taxpayer?: string | null; productId?: string | null }
export interface FiscalResult {
  tes: { id: string; code: string; description: string }
  cfop: string
  interstate: boolean
  updatesStock: boolean
  generatesFinancial: boolean
  rule: string | null
  companyUf: string
}

// Matriz fiscal: qual TES e CFOP usar numa operação. Vence a regra mais específica
// (mais campos preenchidos, NCM mais longo). fallbackUf = UF de Configurações, se não houver empresa.
export async function resolveFiscal(db: Db, input: FiscalInput, fallbackUf: string): Promise<FiscalResult | null> {
  const branch = await one(
    db,
    `SELECT code, uf FROM companies WHERE active AND ($1::uuid IS NULL OR id = $1) ORDER BY is_head DESC, code LIMIT 1`,
    [input.companyId ?? null],
  )
  if (input.companyId && !branch) throw new NotFoundException('Empresa/filial não encontrada')
  const companyUf = branch?.uf ?? fallbackUf
  const product = input.productId ? await one(db, `SELECT type_id, group_id, ncm FROM products WHERE id = $1`, [input.productId]) : undefined
  if (input.productId && !product) throw new NotFoundException('Produto não encontrado')

  const uf = input.uf?.toUpperCase() ?? null
  const rules = await db.query(
    `SELECT m.*, t.code AS tes_code, t.description AS tes_description, t.cfop_internal, t.cfop_interstate, t.updates_stock, t.generates_financial
     FROM fiscal_matrix m JOIN tes t ON t.id = m.tes_id
     WHERE m.active AND t.active AND m.operation_type_id = $1
       AND (m.uf IS NULL OR m.uf = $2)
       AND (m.taxpayer IS NULL OR m.taxpayer = $3)
       AND (m.product_type_id IS NULL OR m.product_type_id = $4)
       AND (m.product_group_id IS NULL OR m.product_group_id = $5)
       AND (m.ncm_prefix IS NULL OR $6 LIKE m.ncm_prefix || '%')`,
    [input.operationTypeId, uf, input.taxpayer ?? null, product?.type_id ?? null, product?.group_id ?? null, product?.ncm ?? ''],
  )
  const score = (r: any) => ['uf', 'taxpayer', 'product_type_id', 'product_group_id'].filter((k) => r[k] !== null).length * 10 + (r.ncm_prefix?.length ?? 0)
  const best = rules.sort((a: any, b: any) => score(b) - score(a))[0]
  if (!best) return null
  const interstate = !!uf && uf !== companyUf
  return {
    tes: { id: best.tes_id, code: best.tes_code, description: best.tes_description },
    cfop: interstate && best.cfop_interstate ? best.cfop_interstate : best.cfop_internal,
    interstate,
    updatesStock: best.updates_stock,
    generatesFinancial: best.generates_financial,
    rule: best.notes,
    companyUf,
  }
}
