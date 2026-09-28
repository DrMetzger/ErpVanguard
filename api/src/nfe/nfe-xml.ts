import { ieValida } from '../common/br'
import type { ItemTaxes } from '../taxes/tax-engine'

// Montagem do XML da NF-e (modelo 55, leiaute 4.00) a partir da nota de venda e dos impostos do nosso motor.
// Só monta o <NFe>; assinatura, XSD e SEFAZ ficam em sefaz.ts (com a @brasil-fiscal/nfe).

export const NFE_NS = 'http://www.portalfiscal.inf.br/nfe'
// Homologação: a SEFAZ exige estes textos no 1º item e no nome do destinatário (este cabe nos 60 caracteres do xNome).
export const HOMOLOG_TEXT = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
export const HOMOLOG_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
export const VER_PROC = 'ERP Vanguard 1.0'

export const UF_CODE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}

export interface NfeAddress { street: string; number: string; complement?: string | null; district: string; cityCode: string; city: string; uf: string; zip: string; phone?: string | null }
export interface NfeEmit extends NfeAddress { cnpj: string; name: string; tradeName?: string | null; ie: string; crt: '1' | '2' | '3' | '4' }
export interface NfeDest extends NfeAddress { document: string; name: string; ie?: string | null; taxpayer: string; email?: string | null }
export interface NfeItem {
  code: string; barcode?: string | null; name: string; ncm: string; cest?: string | null; cfop: string; unit: string; origin: number
  quantity: number; unitPrice: number; gross: number // vProd = qCom × vUnCom
  itemDiscount: number // desconto do próprio item (fora o rateio do desconto da nota, que vem em taxes.discount)
  taxes: ItemTaxes
}
export interface NfeDup { number: string; dueDate: string; amount: number }
export interface NfeRespTec { cnpj: string; contact: string; email: string; phone: string }
export interface NfeInput {
  environment: 'homologacao' | 'producao'
  number: number; series: number; cNF: string; issuedAt: Date
  natOp: string; finNFe: '1' | '2' | '3' | '4'; indPres: string
  emit: NfeEmit; dest: NfeDest; items: NfeItem[]
  freight: number // frete da nota (modFrete 0 quando > 0, senão 9)
  duplicates: NfeDup[]
  payment: { tPag: string; indPag: '0' | '1'; amount?: number } | null // null = sem pagamento (tPag 90)
  additionalInfo?: string | null
  respTec?: NfeRespTec | null
}

export interface NfeTotals {
  vBC: number; vICMS: number; vICMSDeson: number; vFCPUFDest: number; vICMSUFDest: number; vICMSUFRemet: number; vFCP: number
  vBCST: number; vST: number; vFCPST: number; vProd: number; vFrete: number; vDesc: number; vIPI: number; vPIS: number; vCOFINS: number
  vNF: number; vTotTrib: number
}

// ---- texto e números

const LATIN: Record<string, string> = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '•': '-', '€': 'EUR', '™': 'TM' }

// Texto para o XML: NFC, troca aspas/traços "tipográficos", tira o que o XSD não aceita (fora de Latin-1 e controles),
// junta espaços, corta no tamanho do campo e escapa & < >. Aspas ficam literais: é assim que a C14N da assinatura as escreve.
export function text(value: unknown, max: number) {
  let s = String(value ?? '').normalize('NFC').replace(/[–—“”‘’…•€™]/g, (c) => LATIN[c] ?? '')
  s = s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const d2 = (n: number) => r2(Number(n) || 0).toFixed(2)
const d4 = (n: number) => (Math.round((Number(n) || 0) * 10000) / 10000).toFixed(4)
// vUnCom aceita até 10 casas; usamos até 4 (como o preço é gravado) e no mínimo 2.
const unit = (n: number) => {
  const s = (Math.round((Number(n) || 0) * 10000) / 10000).toFixed(4)
  return s.replace(/(\.\d\d\d*?)0+$/, '$1')
}
export const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

const tag = (name: string, value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? '' : `<${name}>${value}</${name}>`)
const group = (name: string, content: string, attrs = '') => `<${name}${attrs ? ' ' + attrs : ''}>${content}</${name}>`

// Dígito da chave de acesso (módulo 11, pesos 2 a 9).
export function mod11(value: string) {
  let sum = 0
  let weight = 2
  for (let i = value.length - 1; i >= 0; i--) {
    sum += Number(value[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

// GTIN válido (8, 12, 13 ou 14 dígitos com dígito verificador); senão "SEM GTIN".
export function gtin(value: string | null | undefined) {
  const g = onlyDigits(value)
  if (![8, 12, 13, 14].includes(g.length) || String(value).trim() !== g) return 'SEM GTIN'
  const body = g.slice(0, -1).padStart(13, '0')
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(body[i]) * (i % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(g.slice(-1)) ? g : 'SEM GTIN'
}

// Código numérico aleatório de 8 dígitos, diferente do número da nota.
export function randomCNF(number: number) {
  let c: string
  do c = String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')
  while (Number(c) === number || /^(\d)\1{7}$/.test(c))
  return c
}

// Data/hora com o fuso de Brasília (-03:00), sem milissegundos.
export function brasiliaDateTime(date: Date) {
  const local = new Date(date.getTime() - 3 * 3600_000)
  return local.toISOString().slice(0, 19) + '-03:00'
}

export function accessKey(input: { uf: string; issuedAt: Date; cnpj: string; model: string; series: number; number: number; tpEmis: string; cNF: string }) {
  const aamm = brasiliaDateTime(input.issuedAt).slice(2, 7).replace('-', '')
  const base = `${UF_CODE[input.uf]}${aamm}${input.cnpj}${input.model}${String(input.series).padStart(3, '0')}${String(input.number).padStart(9, '0')}${input.tpEmis}${input.cNF}`
  if (base.length !== 43) throw new Error('Não foi possível montar a chave de acesso (confira UF e CNPJ da empresa)')
  return base + mod11(base)
}

// ---- grupos de imposto

function icmsGroup(item: NfeItem, t: ItemTaxes, acc: NfeTotals) {
  const orig = String(item.origin ?? 0)
  const cst = t.icms.cst
  const icms = t.icms
  const st = t.st
  const fcp = t.fcp
  // ICMS próprio; CST 20 e 70 sempre levam o percentual de redução (pRedBC)
  const own = (reduced = false) => {
    acc.vBC += icms.base; acc.vICMS += icms.value
    return tag('modBC', '3') + (reduced || (icms.reduction > 0 && cst === '90') ? tag('pRedBC', d4(icms.reduction)) : '')
      + tag('vBC', d2(icms.base)) + tag('pICMS', d4(icms.rate)) + tag('vICMS', d2(icms.value))
  }
  // FCP próprio: no ICMS00 vai só pFCP/vFCP; nos demais, com a base (vBCFCP)
  const fcpTags = (withBase: boolean) => {
    if (!fcp || fcp.value <= 0) return ''
    acc.vFCP += fcp.value
    return (withBase ? tag('vBCFCP', d2(fcp.base)) : '') + tag('pFCP', d4(fcp.rate)) + tag('vFCP', d2(fcp.value))
  }
  const stTags = () => {
    if (!st) return tag('modBCST', '4') + tag('pMVAST', d4(0)) + tag('vBCST', d2(0)) + tag('pICMSST', d4(0)) + tag('vICMSST', d2(0))
    acc.vBCST += st.base; acc.vST += st.value
    let s = tag('modBCST', '4') + tag('pMVAST', d4(st.mva)) + tag('vBCST', d2(st.base)) + tag('pICMSST', d4(st.rate)) + tag('vICMSST', d2(st.value))
    if (st.fcpRate && (st.fcpValue ?? 0) > 0) {
      acc.vFCPST += st.fcpValue!
      s += tag('vBCFCPST', d2(st.base)) + tag('pFCPST', d4(st.fcpRate)) + tag('vFCPST', d2(st.fcpValue!))
    }
    return s
  }
  const snCredit = () => tag('pCredSN', d4(icms.snCreditRate ?? 0)) + tag('vCredICMSSN', d2(icms.snCredit ?? 0))
  const base = tag('orig', orig)

  switch (cst) {
    // Regime normal (CST)
    case '00': return group('ICMS00', base + tag('CST', cst) + own() + fcpTags(false))
    case '10': return group('ICMS10', base + tag('CST', cst) + own() + fcpTags(true) + stTags())
    case '20': return group('ICMS20', base + tag('CST', cst) + own(true) + fcpTags(true))
    case '30': return group('ICMS30', base + tag('CST', cst) + stTags())
    case '40': case '41': case '50': return group('ICMS40', base + tag('CST', cst))
    case '51': {
      if (icms.base <= 0) return group('ICMS51', base + tag('CST', cst))
      acc.vBC += icms.base; acc.vICMS += icms.value
      return group('ICMS51', base + tag('CST', cst) + tag('modBC', '3') + (icms.reduction > 0 ? tag('pRedBC', d4(icms.reduction)) : '')
        + tag('vBC', d2(icms.base)) + tag('pICMS', d4(icms.rate)) + tag('vICMSOp', d2(icms.value)) + tag('vICMS', d2(icms.value)) + fcpTags(true))
    }
    case '60': return group('ICMS60', base + tag('CST', cst))
    case '70': return group('ICMS70', base + tag('CST', cst) + own(true) + fcpTags(true) + stTags())
    case '90': return group('ICMS90', base + tag('CST', cst) + (icms.base > 0 ? own() + fcpTags(true) : '') + (st ? stTags() : ''))
    // Simples Nacional (CSOSN)
    case '101': return group('ICMSSN101', base + tag('CSOSN', cst) + snCredit())
    case '102': case '103': case '300': case '400': return group('ICMSSN102', base + tag('CSOSN', cst))
    case '201': return group('ICMSSN201', base + tag('CSOSN', cst) + stTags() + snCredit())
    case '202': case '203': return group('ICMSSN202', base + tag('CSOSN', cst) + stTags())
    case '500': return group('ICMSSN500', base + tag('CSOSN', cst))
    case '900': {
      let s = base + tag('CSOSN', cst)
      if (icms.base > 0) {
        acc.vBC += icms.base; acc.vICMS += icms.value
        s += tag('modBC', '3') + tag('vBC', d2(icms.base)) + (icms.reduction > 0 ? tag('pRedBC', d4(icms.reduction)) : '') + tag('pICMS', d4(icms.rate)) + tag('vICMS', d2(icms.value))
      }
      if (st) s += stTags()
      if (icms.snCredit) s += snCredit()
      return group('ICMSSN900', s)
    }
    default: throw new Error(`Item ${item.code}: CST/CSOSN de ICMS ${cst} não suportado na NF-e`)
  }
}

function ipiGroup(t: ItemTaxes, acc: NfeTotals) {
  if (!t.ipi) return ''
  const ipi = t.ipi
  // cEnq 999 = tributação normal (enquadramento específico ainda não vem da matriz de impostos)
  if (['00', '49', '50', '99'].includes(ipi.cst)) {
    acc.vIPI += ipi.value
    return group('IPI', tag('cEnq', '999') + group('IPITrib', tag('CST', ipi.cst) + tag('vBC', d2(ipi.base)) + tag('pIPI', d4(ipi.rate)) + tag('vIPI', d2(ipi.value))))
  }
  return group('IPI', tag('cEnq', '999') + group('IPINT', tag('CST', ipi.cst)))
}

function pisCofinsGroup(kind: 'PIS' | 'COFINS', t: { cst: string; base: number; rate: number; value: number }, acc: NfeTotals) {
  const cst = t.cst.padStart(2, '0')
  const add = () => { if (kind === 'PIS') acc.vPIS += t.value; else acc.vCOFINS += t.value }
  if (['01', '02'].includes(cst)) {
    add()
    return group(kind, group(`${kind}Aliq`, tag('CST', cst) + tag('vBC', d2(t.base)) + tag(`p${kind}`, d4(t.rate)) + tag(`v${kind}`, d2(t.value))))
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) return group(kind, group(`${kind}NT`, tag('CST', cst)))
  if (cst === '03') throw new Error(`${kind} CST 03 (por quantidade) ainda não suportado na NF-e`)
  add()
  return group(kind, group(`${kind}Outr`, tag('CST', cst) + tag('vBC', d2(t.base)) + tag(`p${kind}`, d4(t.rate)) + tag(`v${kind}`, d2(t.value))))
}

function difalGroup(t: ItemTaxes, acc: NfeTotals) {
  const d = t.difal
  if (!d) return ''
  acc.vICMSUFDest += d.value; acc.vFCPUFDest += d.fcpValue
  // Desde 2019 a partilha é 100% para a UF de destino (pICMSInterPart = 100, vICMSUFRemet = 0).
  return group('ICMSUFDest', tag('vBCUFDest', d2(d.base)) + (d.fcpRate > 0 ? tag('vBCFCPUFDest', d2(d.base)) + tag('pFCPUFDest', d4(d.fcpRate)) : '')
    + tag('pICMSUFDest', d4(d.destRate)) + tag('pICMSInter', d2(d.interRate)) + tag('pICMSInterPart', d4(100))
    + (d.fcpRate > 0 ? tag('vFCPUFDest', d2(d.fcpValue)) : '') + tag('vICMSUFDest', d2(d.value)) + tag('vICMSUFRemet', d2(0)))
}

// ---- documento

function address(tagName: string, a: NfeAddress) {
  const zip = onlyDigits(a.zip)
  const phone = onlyDigits(a.phone)
  return group(tagName, tag('xLgr', text(a.street, 60)) + tag('nro', text(a.number || 'S/N', 60)) + tag('xCpl', text(a.complement, 60))
    + tag('xBairro', text(a.district, 60)) + tag('cMun', a.cityCode) + tag('xMun', text(a.city, 60)) + tag('UF', a.uf)
    + tag('CEP', zip) + tag('cPais', '1058') + tag('xPais', 'BRASIL') + (phone.length >= 6 && phone.length <= 14 ? tag('fone', phone) : ''))
}

export function idDestOf(emitUf: string, destUf: string) {
  if (destUf === 'EX') return '3'
  return emitUf === destUf ? '1' : '2'
}

export function buildNfeXml(input: NfeInput) {
  const { emit, dest } = input
  const homolog = input.environment === 'homologacao'
  const tpAmb = homolog ? '2' : '1'
  const cnpj = onlyDigits(emit.cnpj)
  const key = accessKey({ uf: emit.uf, issuedAt: input.issuedAt, cnpj, model: '55', series: input.series, number: input.number, tpEmis: '1', cNF: input.cNF })
  const idDest = idDestOf(emit.uf, dest.uf)
  if (idDest === '3') throw new Error('Exportação (destinatário no exterior) ainda não é suportada na NF-e')
  const indFinal = dest.taxpayer === '9' ? '1' : '0'
  const dhEmi = brasiliaDateTime(input.issuedAt)

  const ide = tag('cUF', UF_CODE[emit.uf]) + tag('cNF', input.cNF) + tag('natOp', text(input.natOp, 60)) + tag('mod', '55') + tag('serie', String(input.series))
    + tag('nNF', String(input.number)) + tag('dhEmi', dhEmi) + tag('dhSaiEnt', dhEmi) + tag('tpNF', '1') + tag('idDest', idDest) + tag('cMunFG', emit.cityCode)
    + tag('tpImp', '1') + tag('tpEmis', '1') + tag('cDV', key.slice(-1)) + tag('tpAmb', tpAmb) + tag('finNFe', input.finNFe) + tag('indFinal', indFinal)
    + tag('indPres', input.indPres) + (['2', '3', '4', '9'].includes(input.indPres) ? tag('indIntermed', '0') : '') + tag('procEmi', '0') + tag('verProc', VER_PROC)

  const emitXml = group('emit', tag('CNPJ', cnpj) + tag('xNome', text(emit.name, 60)) + tag('xFant', text(emit.tradeName, 60)) + address('enderEmit', emit)
    + tag('IE', /^isento$/i.test(emit.ie) ? 'ISENTO' : onlyDigits(emit.ie)) + tag('CRT', emit.crt))

  const doc = onlyDigits(dest.document)
  const indIEDest = dest.taxpayer === '1' ? '1' : dest.taxpayer === '2' ? '2' : '9'
  const destIe = indIEDest === '1' ? onlyDigits(dest.ie) : ''
  if (indIEDest === '1' && !destIe) throw new Error('Cliente contribuinte (1) sem inscrição estadual: informe a IE ou mude para isento/não contribuinte')
  // Confere a IE antes de enviar (evita a rejeição 210 da SEFAZ).
  if (indIEDest === '1' && dest.uf && !ieValida(destIe, dest.uf)) throw new Error(`Inscrição estadual do cliente (${destIe}) é inválida para ${dest.uf}: corrija no cadastro do cliente`)
  const destXml = group('dest', (doc.length === 11 ? tag('CPF', doc) : tag('CNPJ', doc)) + tag('xNome', homolog ? HOMOLOG_DEST : text(dest.name, 60))
    + address('enderDest', dest) + tag('indIEDest', indIEDest) + tag('IE', destIe) + tag('email', text(dest.email?.split(/[;,\s]/)[0], 60)))

  const acc: NfeTotals = { vBC: 0, vICMS: 0, vICMSDeson: 0, vFCPUFDest: 0, vICMSUFDest: 0, vICMSUFRemet: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vProd: 0, vFrete: 0, vDesc: 0, vIPI: 0, vPIS: 0, vCOFINS: 0, vNF: 0, vTotTrib: 0 }
  const dets = input.items.map((item, n) => {
    const t = item.taxes
    const ean = gtin(item.barcode)
    const discount = r2(item.itemDiscount + (t.discount ?? 0))
    const freight = r2(t.freight ?? 0)
    acc.vProd += item.gross; acc.vDesc += discount; acc.vFrete += freight
    const ncm = onlyDigits(item.ncm)
    if (ncm.length !== 8) throw new Error(`Item ${n + 1} (${item.code}): NCM ausente ou inválido`)
    const cest = onlyDigits(item.cest)
    const unitCode = text(item.unit || 'UN', 6)
    const prod = tag('cProd', text(item.code, 60)) + tag('cEAN', ean) + tag('xProd', homolog && n === 0 ? HOMOLOG_TEXT : text(item.name, 120)) + tag('NCM', ncm)
      + (cest.length === 7 ? tag('CEST', cest) : '') + tag('CFOP', item.cfop) + tag('uCom', unitCode) + tag('qCom', d4(item.quantity)) + tag('vUnCom', unit(item.unitPrice))
      + tag('vProd', d2(item.gross)) + tag('cEANTrib', ean) + tag('uTrib', unitCode) + tag('qTrib', d4(item.quantity)) + tag('vUnTrib', unit(item.unitPrice))
      + (freight > 0 ? tag('vFrete', d2(freight)) : '') + (discount > 0 ? tag('vDesc', d2(discount)) : '') + tag('indTot', '1')
    const approx = t.approx?.value ?? 0
    acc.vTotTrib += approx
    const imposto = (approx > 0 ? tag('vTotTrib', d2(approx)) : '') + group('ICMS', icmsGroup(item, t, acc)) + ipiGroup(t, acc)
      + pisCofinsGroup('PIS', t.pis, acc) + pisCofinsGroup('COFINS', t.cofins, acc) + (idDest === '2' && indFinal === '1' && indIEDest === '9' ? difalGroup(t, acc) : '')
    // IBS/CBS (reforma tributária): o motor ainda não calcula; o grupo é opcional no XSD (minOccurs=0) e fica de fora.
    return group('det', group('prod', prod) + group('imposto', imposto), `nItem="${n + 1}"`)
  })

  for (const k of Object.keys(acc) as (keyof NfeTotals)[]) acc[k] = r2(acc[k])
  acc.vNF = r2(acc.vProd - acc.vDesc - acc.vICMSDeson + acc.vST + acc.vFCPST + acc.vFrete + acc.vIPI)
  const icmsTot = tag('vBC', d2(acc.vBC)) + tag('vICMS', d2(acc.vICMS)) + tag('vICMSDeson', d2(0))
    + (acc.vFCPUFDest > 0 || acc.vICMSUFDest > 0 ? tag('vFCPUFDest', d2(acc.vFCPUFDest)) + tag('vICMSUFDest', d2(acc.vICMSUFDest)) + tag('vICMSUFRemet', d2(0)) : '')
    + tag('vFCP', d2(acc.vFCP)) + tag('vBCST', d2(acc.vBCST)) + tag('vST', d2(acc.vST)) + tag('vFCPST', d2(acc.vFCPST)) + tag('vFCPSTRet', d2(0))
    + tag('vProd', d2(acc.vProd)) + tag('vFrete', d2(acc.vFrete)) + tag('vSeg', d2(0)) + tag('vDesc', d2(acc.vDesc)) + tag('vII', d2(0)) + tag('vIPI', d2(acc.vIPI))
    + tag('vIPIDevol', d2(0)) + tag('vPIS', d2(acc.vPIS)) + tag('vCOFINS', d2(acc.vCOFINS)) + tag('vOutro', d2(0)) + tag('vNF', d2(acc.vNF))
    + (acc.vTotTrib > 0 ? tag('vTotTrib', d2(acc.vTotTrib)) : '')

  const transp = group('transp', tag('modFrete', input.freight > 0 ? '0' : '9'))

  // Cobrança só com parcelas a prazo; a soma das duplicatas é o valor líquido da fatura.
  let cobr = ''
  const dups = input.duplicates.filter((d) => d.amount > 0)
  if (dups.length) {
    const total = r2(dups.reduce((s, d) => s + d.amount, 0))
    cobr = group('cobr', group('fat', tag('nFat', text(String(input.number), 60)) + tag('vOrig', d2(total)) + tag('vDesc', d2(0)) + tag('vLiq', d2(total)))
      + dups.map((d) => group('dup', tag('nDup', text(d.number, 60)) + tag('dVenc', d.dueDate) + tag('vDup', d2(d.amount)))).join(''))
  }
  const pag = group('pag', input.payment
    ? group('detPag', tag('indPag', input.payment.indPag) + tag('tPag', input.payment.tPag) + (input.payment.tPag === '99' ? tag('xPag', 'Conforme duplicatas') : '') + tag('vPag', d2(input.payment.amount ?? acc.vNF)))
    : group('detPag', tag('tPag', '90') + tag('vPag', d2(0))))

  const infCpl = text(input.additionalInfo, 5000)
  const infAdic = infCpl ? group('infAdic', tag('infCpl', infCpl)) : ''
  const rt = input.respTec
  const respTec = rt && onlyDigits(rt.cnpj).length === 14
    ? group('infRespTec', tag('CNPJ', onlyDigits(rt.cnpj)) + tag('xContato', text(rt.contact, 60)) + tag('email', text(rt.email, 60)) + tag('fone', onlyDigits(rt.phone)))
    : ''

  const infNFe = group('ide', ide) + emitXml + destXml + dets.join('') + group('total', group('ICMSTot', icmsTot)) + transp + cobr + pag + infAdic + respTec
  const xml = `<NFe xmlns="${NFE_NS}"><infNFe Id="NFe${key}" versao="4.00">${infNFe}</infNFe></NFe>`
  return { xml, accessKey: key, totals: acc, dhEmi }
}
