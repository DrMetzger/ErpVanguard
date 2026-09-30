import { one, type Db } from '../common/db'
import { round2 } from '../finance/finance.logic'
import type { ParametersService } from '../params/parameters.service'

// Motor de impostos da venda (comércio): ICMS, ICMS-ST, IPI, FCP, FCP-ST, DIFAL, PIS e COFINS.
// As regras vêm da "Matriz de impostos" (tax_rules); sem regra, usa o padrão do regime da empresa.

export type Regime = 'simples' | 'simples_excesso' | 'mei' | 'presumido' | 'real'
const SIMPLES: Regime[] = ['simples', 'simples_excesso', 'mei']
const SOUTH_SOUTHEAST = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']
const IMPORTED = [1, 2, 3, 8]

export interface TaxItemInput {
  key: string // identifica o item no retorno
  productId: string; ncm: string | null; typeId: string | null; groupId: string | null; origin: number
  cfop: string | null
  amount: number // valor do item já com o desconto do item
  tesId?: string | null // TES do item (traz o cClassTrib padrão da operação)
  classTribId?: string | null // cClassTrib do produto (vence o da TES)
}

// IBS (estados e municípios) e CBS (União) da reforma tributária (LC 214/2025).
// 2026 é ano de teste: vai no XML, mas não soma no total da nota nem é cobrado.
export interface IbsCbsTaxes {
  cst: string; classTrib: string; name: string
  withGroup: boolean // false: a nota leva só o CST e o cClassTrib (ex.: imunidade, isenção)
  base: number
  ibsUf: { rate: number; reduction: number; effective: number; value: number }
  ibsMun: { rate: number; reduction: number; effective: number; value: number }
  cbs: { rate: number; reduction: number; effective: number; value: number }
  ibs: number // vIBS = UF + município
}

export interface ItemTaxes {
  icms: { cst: string; base: number; rate: number; value: number; reduction: number; snCreditRate?: number; snCredit?: number }
  // fcpRate/fcpValue: FCP retido por ST (vFCPST), sobre a mesma base da ST
  st: { base: number; mva: number; rate: number; value: number; fcpRate?: number; fcpValue?: number } | null
  ipi: { cst: string; base: number; rate: number; value: number } | null
  fcp: { base: number; rate: number; value: number } | null
  difal: { base: number; destRate: number; interRate: number; value: number; fcpRate: number; fcpValue: number } | null
  pis: { cst: string; base: number; rate: number; value: number }
  cofins: { cst: string; base: number; rate: number; value: number }
  freight: number; discount: number
  // Lei 12.741/2012: valor aproximado dos tributos (percentual do NCM ou do parâmetro MV_IBPTPCT)
  approx?: { rate: number; value: number }
  ibsCbs?: IbsCbsTaxes | null
  total: number // valor do item na nota: produto − desconto + frete + IPI + ST
  rules: string[]
}

export interface TaxTotals {
  products: number; discount: number; freight: number
  icmsBase: number; icms: number; stBase: number; st: number; fcpSt?: number; ipi: number; fcp: number; difal: number; fcpDest: number; pis: number; cofins: number; snCredit: number
  approxTax?: number
  ibsCbsBase?: number; ibsUf?: number; ibsMun?: number; ibs?: number; cbs?: number // informativos em 2026 (fora do total)
  total: number
}

export interface ClassTribInfo { id: string; code: string; cst: string; name: string; aliquotType: string; pRedIbs: number; pRedCbs: number; flags: Record<string, boolean>; indNfe: boolean; active: boolean }

export interface TaxContext {
  regime: Regime; companyUf: string; destUf: string; taxpayer: string; operationTypeId: string; date: string
  snCreditRate: number | null
  uf: Map<string, { internal: number; fcp: number }>
  rules: any[]
  ncmIpi: Map<string, number>
  ncmEstimate?: Map<string, number>
  params: Record<string, boolean | number | string>
  classTrib?: Map<string, ClassTribInfo> // por id
  tesClassTrib?: Map<string, string> // TES → id do cClassTrib
}

export async function loadTaxContext(db: Db, params: ParametersService, input: { companyId: string; destUf: string | null; taxpayer: string | null; operationTypeId: string; date: string }): Promise<TaxContext> {
  const company = (await one(db, `SELECT uf, tax_regime, sn_credit_rate FROM companies WHERE id = $1`, [input.companyId]))!
  const ufRows = await db.query(`SELECT uf, internal_rate, fcp_rate FROM uf_icms WHERE active`)
  const rules = await db.query(`SELECT * FROM tax_rules WHERE active AND (valid_from IS NULL OR valid_from <= $1) AND (valid_to IS NULL OR valid_to >= $1)`, [input.date])
  const ncm = await db.query(`SELECT code, ipi_rate, tax_estimate_rate FROM ncm WHERE ipi_rate IS NOT NULL OR tax_estimate_rate IS NOT NULL`)
  const classTrib = await db.query(`SELECT id, code, cst, name, aliquot_type, p_red_ibs, p_red_cbs, flags, ind_nfe, active FROM class_trib`)
  const tesClass = await db.query(`SELECT id, class_trib_id FROM tes WHERE class_trib_id IS NOT NULL`)
  return {
    regime: company.tax_regime, companyUf: company.uf, destUf: (input.destUf ?? company.uf).toUpperCase(), taxpayer: input.taxpayer ?? '9',
    operationTypeId: input.operationTypeId, date: input.date, snCreditRate: company.sn_credit_rate === null ? null : Number(company.sn_credit_rate),
    uf: new Map(ufRows.map((r: any) => [r.uf, { internal: Number(r.internal_rate), fcp: Number(r.fcp_rate) }])),
    rules, ncmIpi: new Map(ncm.filter((r: any) => r.ipi_rate !== null).map((r: any) => [r.code, Number(r.ipi_rate)])),
    ncmEstimate: new Map(ncm.filter((r: any) => r.tax_estimate_rate !== null).map((r: any) => [r.code, Number(r.tax_estimate_rate)])), params: await params.all(db),
    classTrib: new Map(classTrib.map((r: any) => [r.id, { id: r.id, code: r.code, cst: r.cst, name: r.name, aliquotType: r.aliquot_type, pRedIbs: Number(r.p_red_ibs), pRedCbs: Number(r.p_red_cbs), flags: r.flags ?? {}, indNfe: r.ind_nfe, active: r.active }])),
    tesClassTrib: new Map(tesClass.map((r: any) => [r.id, r.class_trib_id])),
  }
}

export function interstateRate(origUf: string, destUf: string, origin: number) {
  if (IMPORTED.includes(origin)) return 4
  return SOUTH_SOUTHEAST.includes(origUf) && !SOUTH_SOUTHEAST.includes(destUf) ? 7 : 12
}

// Regra mais específica para o imposto (mais filtros preenchidos; NCM mais longo desempata).
function pick(ctx: TaxContext, tax: string, item: TaxItemInput) {
  const matches = ctx.rules.filter((r) =>
    r.tax === tax && (!r.regime || r.regime === ctx.regime) && (!r.operation_type_id || r.operation_type_id === ctx.operationTypeId)
    && (!r.uf || r.uf === ctx.destUf) && (!r.taxpayer || r.taxpayer === ctx.taxpayer) && (!r.product_id || r.product_id === item.productId)
    && (!r.product_group_id || r.product_group_id === item.groupId) && (!r.product_type_id || r.product_type_id === item.typeId)
    && (!r.ncm_prefix || (item.ncm ?? '').startsWith(r.ncm_prefix)) && (!r.cfop || r.cfop === item.cfop))
  const score = (r: any) => ['regime', 'operation_type_id', 'uf', 'taxpayer', 'product_id', 'product_group_id', 'product_type_id', 'cfop'].filter((k) => r[k]).length * 10 + (r.ncm_prefix?.length ?? 0)
  return matches.sort((a, b) => score(b) - score(a))[0] as any | undefined
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

// CST do IBS/CBS que o sistema já emite: com o grupo de cálculo (gIBSCBS) ou só com CST + cClassTrib.
// Diferimento, monofásico, alíquota fixa, transferência/ajuste de crédito e grupos extras (gTribRegular,
// crédito presumido, estorno) ficam para depois: o motor avisa e a NF-e não é montada com eles.
export const IBSCBS_WITH_GROUP = ['000', '010', '011', '200', '222']
export const IBSCBS_NO_GROUP = ['400', '410']
export const DEFAULT_CLASS_TRIB = '000001'

function ibsCbsOf(ctx: TaxContext, item: TaxItemInput, n: number, base: number, warnings: string[]): IbsCbsTaxes | null {
  if (!ctx.params.MV_IBSCBS || !ctx.classTrib?.size) return null
  if (SIMPLES.includes(ctx.regime) && !ctx.params.MV_IBSCBSSN) return null
  const id = item.classTribId ?? (item.tesId ? ctx.tesClassTrib?.get(item.tesId) : undefined)
  const ct = (id ? ctx.classTrib.get(id) : undefined) ?? [...ctx.classTrib.values()].find((c) => c.code === DEFAULT_CLASS_TRIB)
  if (!ct) return null
  const extra = Object.entries(ct.flags).filter(([, v]) => v).map(([k]) => k)
  const withGroup = IBSCBS_WITH_GROUP.includes(ct.cst)
  if ((!withGroup && !IBSCBS_NO_GROUP.includes(ct.cst)) || extra.length) {
    warnings.push(`Item ${n + 1}: cClassTrib ${ct.code} (CST ${ct.cst}${extra.length ? ', ' + extra.join('/') : ''}) ainda não é emitido pelo sistema; use outra classificação na TES ou no produto`)
  }
  if (!ct.active) warnings.push(`Item ${n + 1}: cClassTrib ${ct.code} está inativo na tabela de classificação tributária`)
  if (!ct.indNfe) warnings.push(`Item ${n + 1}: cClassTrib ${ct.code} não vale para NF-e segundo a tabela oficial`)
  const part = (rate: number, reduction: number) => {
    const effective = Math.round(rate * (1 - reduction / 100) * 10000) / 10000
    return { rate, reduction, effective, value: withGroup ? round2(base * effective / 100) : 0 }
  }
  const ibsUf = part(Number(ctx.params.MV_IBSUFALQ ?? 0), ct.pRedIbs)
  const ibsMun = part(Number(ctx.params.MV_IBSMUNALQ ?? 0), ct.pRedIbs)
  const cbs = part(Number(ctx.params.MV_CBSALQ ?? 0), ct.pRedCbs)
  return { cst: ct.cst, classTrib: ct.code, name: ct.name, withGroup, base: withGroup ? base : 0, ibsUf, ibsMun, cbs, ibs: round2(ibsUf.value + ibsMun.value) }
}

// Rateia frete e desconto do documento pelo valor dos itens (centavos que sobram no último).
function share(total: number, amounts: number[]) {
  const sum = amounts.reduce((s, a) => s + a, 0)
  let used = 0
  return amounts.map((a, i) => {
    if (i === amounts.length - 1) return round2(total - used)
    const v = sum > 0 ? round2((total * a) / sum) : 0
    used += v
    return v
  })
}

export function computeTaxes(ctx: TaxContext, items: TaxItemInput[], freight: number, discount: number) {
  const simples = SIMPLES.includes(ctx.regime)
  const interstate = ctx.destUf !== ctx.companyUf
  const freights = share(freight, items.map((i) => i.amount))
  const discounts = share(discount, items.map((i) => i.amount))
  const warnings: string[] = []
  const destUf = ctx.uf.get(ctx.destUf) ?? { internal: 18, fcp: 0 }
  const origUf = ctx.uf.get(ctx.companyUf) ?? { internal: 18, fcp: 0 }

  const result = items.map((item, n) => {
    const rules: string[] = []
    const fr = freights[n]!
    const dc = discounts[n]!
    const value = round2(item.amount - dc)
    const frBase = ctx.params.MV_FRETICM ? fr : 0

    // IPI (só com regra: comércio em geral não recolhe IPI)
    const ipiRule = pick(ctx, 'IPI', item)
    let ipi: ItemTaxes['ipi'] = null
    if (ipiRule) {
      rules.push(`IPI: ${ipiRule.name}`)
      const rate = num(ipiRule.rate) ?? ctx.ncmIpi.get(item.ncm ?? '') ?? 0
      const base = round2(value + fr)
      ipi = { cst: ipiRule.cst, base, rate, value: ['50', '99'].includes(ipiRule.cst) ? round2(base * rate / 100) : 0 }
    }

    // ICMS próprio
    const icmsRule = pick(ctx, 'ICMS', item)
    if (icmsRule) rules.push(`ICMS: ${icmsRule.name}`)
    const cst = icmsRule?.cst ?? (simples ? '102' : '00')
    const inter = interstateRate(ctx.companyUf, ctx.destUf, item.origin)
    const rate = num(icmsRule?.rate) ?? (interstate ? inter : origUf.internal)
    const reduction = Number(icmsRule?.base_reduction ?? 0)
    const ipiInBase = ctx.params.MV_IPIBICM && ctx.taxpayer === '9' ? (ipi?.value ?? 0) : 0
    const fullBase = round2(value + frBase + ipiInBase)
    const base = round2(fullBase * (1 - reduction / 100))
    const taxed = simples ? cst === '900' : ['00', '10', '20', '70', '90'].includes(cst)
    const icms: ItemTaxes['icms'] = { cst, base: taxed ? base : 0, rate: taxed ? rate : 0, value: taxed ? round2(base * rate / 100) : 0, reduction }
    if (simples && ['101', '201'].includes(cst)) {
      const credit = num(icmsRule?.credit_rate) ?? ctx.snCreditRate ?? 0
      icms.snCreditRate = credit
      icms.snCredit = round2(fullBase * credit / 100)
    }

    // FCP da operação interna (regime normal, ICMS tributado)
    let fcp: ItemTaxes['fcp'] = null
    const fcpRate = num(icmsRule?.fcp_rate) ?? origUf.fcp
    if (!interstate && taxed && fcpRate > 0) fcp = { base: icms.base, rate: fcpRate, value: round2(icms.base * fcpRate / 100) }

    // ICMS-ST (precisa da regra com a MVA)
    const stRule = pick(ctx, 'ICMS_ST', item)
    const stCst = simples ? ['201', '202', '203'] : ['10', '30', '70']
    let st: ItemTaxes['st'] = null
    if (stRule) {
      rules.push(`ICMS-ST: ${stRule.name}`)
      const intra = num(stRule.st_rate) ?? destUf.internal
      let mva = Number(stRule.mva ?? 0)
      // MVA ajustada na operação interestadual (Convênio ICMS 142/2018)
      if (interstate && inter < intra) mva = round2((((1 + mva / 100) * (1 - inter / 100)) / (1 - intra / 100) - 1) * 100)
      const stBase = round2((value + fr + (ipi?.value ?? 0)) * (1 + mva / 100) * (1 - Number(stRule.base_reduction ?? 0) / 100))
      const own = taxed ? icms.value : round2(fullBase * (interstate ? inter : origUf.internal) / 100) // Simples: ICMS próprio presumido
      st = { base: stBase, mva, rate: intra, value: Math.max(0, round2(stBase * intra / 100 - own)) }
      // FCP-ST: % da regra de ST (fcp_rate) ou o FCP da UF de destino, menos o FCP próprio
      const fcpStRate = num(stRule.fcp_rate) ?? destUf.fcp
      if (fcpStRate > 0) {
        st.fcpRate = fcpStRate
        st.fcpValue = Math.max(0, round2(stBase * fcpStRate / 100 - (fcp?.value ?? 0)))
      }
      if (!stCst.includes(cst)) warnings.push(`Item ${n + 1}: há regra de ICMS-ST mas o CST/CSOSN ${cst} não é de substituição (use ${stCst.join('/')})`)
    } else if (stCst.includes(cst)) {
      warnings.push(`Item ${n + 1}: CST/CSOSN ${cst} é de substituição tributária, mas não há regra de ICMS-ST (MVA) na matriz de impostos`)
    }

    // DIFAL para não contribuinte de outra UF (EC 87/2015)
    let difal: ItemTaxes['difal'] = null
    if (interstate && ctx.taxpayer === '9' && ctx.params.MV_DIFAL && ctx.regime !== 'mei') {
      const difBase = round2(fullBase * (1 - reduction / 100))
      difal = {
        base: difBase, destRate: destUf.internal, interRate: inter, value: Math.max(0, round2(difBase * (destUf.internal - inter) / 100)),
        fcpRate: destUf.fcp, fcpValue: round2(difBase * destUf.fcp / 100),
      }
    }

    // PIS e COFINS pelo regime (Simples/MEI: recolhidos no DAS)
    const pisCofins = (tax: 'PIS' | 'COFINS') => {
      const rule = pick(ctx, tax, item)
      if (rule) rules.push(`${tax}: ${rule.name}`)
      const def = simples ? { cst: '99', rate: 0 }
        : { cst: '01', rate: Number(ctx.params[ctx.regime === 'real' ? (tax === 'PIS' ? 'MV_PISREAL' : 'MV_COFREAL') : (tax === 'PIS' ? 'MV_PISPRE' : 'MV_COFPRE')]) }
      const c = rule?.cst ?? def.cst
      const r = num(rule?.rate) ?? def.rate
      const b = round2(value + fr - (ctx.params.MV_ICMSPIS ? icms.value : 0))
      const tributed = ['01', '02'].includes(c)
      return { cst: c, base: tributed ? b : 0, rate: tributed ? r : 0, value: tributed ? round2(b * r / 100) : 0 }
    }
    const pis = pisCofins('PIS')
    const cofins = pisCofins('COFINS')

    // Regras do MEI (NT 2024.001)
    if (ctx.regime === 'mei') {
      if (!['102', '300', '400', '900'].includes(cst)) warnings.push(`Item ${n + 1}: MEI só pode usar CSOSN 102, 300, 400 ou 900 (rejeição N12a-80)`)
      if (cst === '102' && item.cfop && !['5102', '6102'].includes(item.cfop)) warnings.push(`Item ${n + 1}: MEI com CSOSN 102 só pode usar CFOP 5102 ou 6102 (rejeição N12a-90)`)
    }

    // Tributos aproximados sobre o valor do item (a lei pede a informação ao consumidor; aqui sai em toda nota)
    const approxRate = ctx.ncmEstimate?.get(item.ncm ?? '') ?? Number(ctx.params.MV_IBPTPCT ?? 0)
    const approx = { rate: approxRate, value: round2(value * approxRate / 100) }

    // IBS/CBS: base = valor + frete − ICMS − FCP − DIFAL (e FCP do destino) − PIS − COFINS (NT 2025.002; IPI e ST não entram)
    const ibsBase = Math.max(0, round2(value + fr - icms.value - (fcp?.value ?? 0) - (difal?.value ?? 0) - (difal?.fcpValue ?? 0) - pis.value - cofins.value))
    const ibsCbs = ibsCbsOf(ctx, item, n, ibsBase, warnings)

    const taxes: ItemTaxes = {
      icms, st, ipi, fcp, difal, pis, cofins, freight: fr, discount: dc, rules, approx, ibsCbs,
      total: round2(value + fr + (ipi?.value ?? 0) + (st?.value ?? 0) + (st?.fcpValue ?? 0)),
    }
    return { key: item.key, taxes }
  })

  const sum = (f: (t: ItemTaxes) => number) => round2(result.reduce((s, r) => s + f(r.taxes), 0))
  const totals: TaxTotals = {
    products: round2(items.reduce((s, i) => s + i.amount, 0)), discount: round2(discount), freight: round2(freight),
    icmsBase: sum((t) => t.icms.base), icms: sum((t) => t.icms.value), stBase: sum((t) => t.st?.base ?? 0), st: sum((t) => t.st?.value ?? 0), fcpSt: sum((t) => t.st?.fcpValue ?? 0),
    ipi: sum((t) => t.ipi?.value ?? 0), fcp: sum((t) => t.fcp?.value ?? 0), difal: sum((t) => t.difal?.value ?? 0), fcpDest: sum((t) => t.difal?.fcpValue ?? 0),
    pis: sum((t) => t.pis.value), cofins: sum((t) => t.cofins.value), snCredit: sum((t) => t.icms.snCredit ?? 0),
    approxTax: sum((t) => t.approx?.value ?? 0),
    ibsCbsBase: sum((t) => t.ibsCbs?.base ?? 0), ibsUf: sum((t) => t.ibsCbs?.ibsUf.value ?? 0), ibsMun: sum((t) => t.ibsCbs?.ibsMun.value ?? 0),
    ibs: sum((t) => t.ibsCbs?.ibs ?? 0), cbs: sum((t) => t.ibsCbs?.cbs.value ?? 0),
    total: sum((t) => t.total),
  }
  return { items: result, totals, warnings: [...new Set(warnings)] }
}
