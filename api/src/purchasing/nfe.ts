import { BadRequestException } from '@nestjs/common'
import { XMLParser } from 'fast-xml-parser'

export interface NfeItem {
  itemNumber: number
  supplierCode: string
  ean: string | null
  description: string
  ncm: string | null
  cfop: string | null
  unit: string
  quantity: number
  unitPrice: number
  total: number
  orderNumber: string | null // xPed: número do pedido informado pelo fornecedor
}

export interface Nfe {
  accessKey: string
  number: string
  series: string | null
  issueDate: string | null
  total: number
  supplier: { cnpj: string; name: string; tradeName: string | null; city: string | null; uf: string | null; phone: string | null; email: string | null; ie: string | null; zip: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; cityCode: string | null }
  recipientDocument: string | null
  orderNumber: string | null
  // Duplicatas (cobr/dup): parcelas a pagar informadas pelo fornecedor.
  duplicates: { number: string | null; dueDate: string; amount: number }[]
  items: NfeItem[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // mantém zeros à esquerda em códigos
  removeNSPrefix: true,
  isArray: (name) => name === 'det' || name === 'dup',
})

const text = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v).trim())
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function parseNfe(xml: string): Nfe {
  let doc: any
  try {
    doc = parser.parse(xml)
  } catch {
    throw new BadRequestException('Arquivo não é um XML válido')
  }
  const nfe = doc?.nfeProc?.NFe ?? doc?.NFe
  const inf = nfe?.infNFe
  if (!inf?.ide || !inf?.emit || !inf?.det) throw new BadRequestException('O XML não é de uma NF-e')
  if (text(inf.ide.mod) && text(inf.ide.mod) !== '55') throw new BadRequestException('Só NF-e (modelo 55) pode ser importada aqui')

  const accessKey = (text(doc?.nfeProc?.protNFe?.infProt?.chNFe) ?? text(inf['@_Id'])?.replace(/^NFe/, '') ?? '').replace(/\D/g, '')
  if (accessKey.length !== 44) throw new BadRequestException('Chave de acesso da NF-e não encontrada no XML')

  const emit = inf.emit
  const items: NfeItem[] = inf.det.map((det: any) => {
    const p = det.prod ?? {}
    const ean = text(p.cEAN)
    return {
      itemNumber: Number(det['@_nItem']),
      supplierCode: text(p.cProd) ?? '',
      ean: ean && /^\d{8,14}$/.test(ean) ? ean : null, // "SEM GTIN" vira null
      description: text(p.xProd) ?? '',
      ncm: text(p.NCM),
      cfop: text(p.CFOP),
      unit: text(p.uCom) ?? 'UN',
      quantity: num(p.qCom),
      unitPrice: num(p.vUnCom),
      total: num(p.vProd),
      orderNumber: text(p.xPed),
    }
  })

  const compra = inf.compra
  return {
    accessKey,
    number: text(inf.ide.nNF) ?? '',
    series: text(inf.ide.serie),
    issueDate: text(inf.ide.dhEmi) ?? text(inf.ide.dEmi),
    total: num(inf.total?.ICMSTot?.vNF),
    supplier: {
      cnpj: text(emit.CNPJ) ?? text(emit.CPF) ?? '',
      name: text(emit.xNome) ?? '',
      tradeName: text(emit.xFant),
      city: text(emit.enderEmit?.xMun),
      uf: text(emit.enderEmit?.UF),
      phone: text(emit.enderEmit?.fone),
      email: text(emit.email),
      ie: text(emit.IE), zip: text(emit.enderEmit?.CEP), street: text(emit.enderEmit?.xLgr), number: text(emit.enderEmit?.nro),
      complement: text(emit.enderEmit?.xCpl), district: text(emit.enderEmit?.xBairro), cityCode: text(emit.enderEmit?.cMun),
    },
    recipientDocument: text(inf.dest?.CNPJ) ?? text(inf.dest?.CPF),
    orderNumber: text(compra?.xPed) ?? items.find((i) => i.orderNumber)?.orderNumber ?? null,
    duplicates: ((inf.cobr?.dup ?? []) as any[])
      .map((d) => ({ number: text(d.nDup), dueDate: text(d.dVenc) ?? '', amount: num(d.vDup) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) && d.amount > 0),
    items,
  }
}
