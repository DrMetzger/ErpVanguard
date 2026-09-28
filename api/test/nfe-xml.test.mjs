// XML da NF-e (sem banco): 5 cenários fiscais montados com o motor de impostos, assinados com um A1 de teste,
// validados no XSD oficial (xmllint) e conferidos: assinatura (digest + RSA), totais × itens e DV da chave.
import assert from 'node:assert/strict'
import { computeTaxes } from '../dist/taxes/tax-engine.js'
import { buildNfeXml, HOMOLOG_DEST } from '../dist/nfe/nfe-xml.js'
import { certificateFromPfx, signXml, validateXsd } from '../dist/nfe/sefaz.js'
import { checkKey, checkTotals, makePfx, verifySignature } from './nfe-helpers.mjs'

const r2 = (n) => Math.round(n * 100) / 100

// ---- cenários

const EMIT = { cnpj: '11222333000181', name: 'Vanguard Teste & Cia "Ltda"', tradeName: 'Vanguard', ie: '110042490114', street: 'Rua das Flores', number: '100', complement: 'Sala 2', district: 'Centro', cityCode: '3550308', city: 'São Paulo', uf: 'SP', zip: '01001000', phone: '1133334444' }
const destPJ = { document: '11444777000161', name: 'Cliente Contribuinte Ltda', ie: '110042490114', taxpayer: '1', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', cityCode: '3550308', city: 'São Paulo', uf: 'SP', zip: '01310100', email: 'compras@cliente.com.br' }
const ufs = new Map([['SP', { internal: 18, fcp: 0 }], ['BA', { internal: 20.5, fcp: 2 }], ['RJ', { internal: 22, fcp: 2 }], ['MG', { internal: 18, fcp: 0 }]])
const params = { MV_FRETICM: true, MV_IPIBICM: true, MV_DIFAL: true, MV_ICMSPIS: true, MV_PISPRE: 0.65, MV_COFPRE: 3, MV_PISREAL: 1.65, MV_COFREAL: 7.6, MV_IBPTPCT: 10 }
const rule = (o) => ({ regime: null, operation_type_id: null, uf: null, taxpayer: null, product_id: null, product_group_id: null, product_type_id: null, ncm_prefix: null, cfop: null, rate: null, base_reduction: 0, mva: null, st_rate: null, fcp_rate: null, credit_rate: null, name: o.tax, ...o })
const ctx = (o) => ({ regime: 'presumido', companyUf: 'SP', destUf: 'SP', taxpayer: '1', operationTypeId: 'op', date: '2026-09-28', snCreditRate: 1.86, uf: ufs, rules: [], ncmIpi: new Map(), params, ...o })

function scenario({ tctx, lines, freight = 0, discount = 0, crt, dest, env = 'homologacao', dups = [] }) {
  const taxes = computeTaxes(tctx, lines.map((l, i) => ({ key: String(i), productId: 'p' + i, ncm: l.ncm, typeId: null, groupId: null, origin: l.origin ?? 0, cfop: l.cfop, amount: r2(l.qty * l.price * (1 - (l.pct ?? 0) / 100)) })), freight, discount)
  const items = lines.map((l, i) => {
    const gross = r2(l.qty * l.price)
    const amount = r2(l.qty * l.price * (1 - (l.pct ?? 0) / 100))
    return { code: 'SKU' + (i + 1), barcode: l.barcode ?? null, name: l.name ?? `Produto ${i + 1} – teste`, ncm: l.ncm, cest: l.cest ?? null, cfop: l.cfop, unit: 'UN', origin: l.origin ?? 0,
      quantity: l.qty, unitPrice: l.price, gross, itemDiscount: r2(gross - amount), taxes: taxes.items[i].taxes }
  })
  const nfe = buildNfeXml({
    environment: env, number: 1234, series: 1, cNF: '10293847', issuedAt: new Date(), natOp: 'Venda de mercadoria', finNFe: '1', indPres: '1',
    emit: { ...EMIT, crt }, dest, items, freight, duplicates: dups, payment: { tPag: dups.length ? '15' : '01', indPag: dups.length ? '1' : '0' },
    additionalInfo: 'Pedido PV-000123 <teste> & observação', respTec: null,
  })
  return { ...nfe, engineTotal: taxes.totals.total, warnings: taxes.warnings }
}

const pfx = makePfx(EMIT.cnpj, 'VANGUARD TESTE', 'Senha@A1')
const cert = certificateFromPfx(pfx, 'Senha@A1')
let passed = 0

function run(name, sc, extra) {
  const signed = signXml(sc.xml, cert)
  const v = validateXsd(signed)
  assert.deepEqual(v.errors, [], `${name}: XSD\n${v.errors.join('\n')}`)
  assert.ok(v.valid, `${name}: XSD`)
  verifySignature(signed)
  checkTotals(signed)
  checkKey(signed, sc.accessKey)
  assert.equal(sc.totals.vNF, sc.engineTotal, `${name}: vNF do XML = total do motor de impostos`)
  extra?.(signed)
  passed++
  console.log('  ✓', name, `(vNF ${sc.totals.vNF.toFixed(2)})`)
}

// (a) Simples Nacional, CSOSN 102, SP → SP, contribuinte; desconto e frete da nota rateados
run('Simples CSOSN 102 interna a contribuinte', scenario({
  tctx: ctx({ regime: 'simples' }), crt: '1', dest: destPJ, freight: 25.5, discount: 10,
  lines: [{ ncm: '39269090', cfop: '5102', qty: 3, price: 19.9, pct: 5, barcode: '7891000315507' }, { ncm: '84672100', cfop: '5102', qty: 1.5, price: 100.1234 }],
  dups: [{ number: '001', dueDate: '2026-10-28', amount: 100 }, { number: '002', dueDate: '2026-11-27', amount: 0 }],
}), (x) => {
  assert.match(x, /<ICMSSN102><orig>0<\/orig><CSOSN>102<\/CSOSN><\/ICMSSN102>/); assert.match(x, /<CRT>1<\/CRT>/); assert.match(x, /<indIEDest>1<\/indIEDest><IE>110042490114<\/IE>/)
  assert.match(x, /<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xProd>/); assert.ok(x.includes(`<xNome>${HOMOLOG_DEST}</xNome>`))
  assert.match(x, /<tpAmb>2<\/tpAmb>/); assert.match(x, /<cEAN>7891000315507<\/cEAN>/); assert.match(x, /<modFrete>0<\/modFrete>/)
  assert.ok(x.includes('Vanguard Teste &amp; Cia "Ltda"'), 'escapa & e mantém aspas'); assert.ok(x.includes('&lt;teste&gt;'))
  assert.match(x, /<PISOutr><CST>99<\/CST><vBC>0.00<\/vBC><pPIS>0.0000<\/pPIS><vPIS>0.00<\/vPIS><\/PISOutr>/)
})

// (b) Lucro Presumido, CST 00 com IPI 10% (produção: nomes reais)
run('Presumido CST 00 com IPI', scenario({
  tctx: ctx({ rules: [rule({ tax: 'IPI', cst: '50', rate: 10 })] }), crt: '3', dest: destPJ, env: 'producao',
  lines: [{ ncm: '84672100', cfop: '5101', qty: 2, price: 450 }, { ncm: '84672100', cfop: '5101', qty: 1, price: 99.99, pct: 10 }],
}), (x) => {
  assert.match(x, /<ICMS00><orig>0<\/orig><CST>00<\/CST><modBC>3<\/modBC><vBC>900.00<\/vBC><pICMS>18.0000<\/pICMS><vICMS>162.00<\/vICMS><\/ICMS00>/)
  assert.match(x, /<IPI><cEnq>999<\/cEnq><IPITrib><CST>50<\/CST><vBC>900.00<\/vBC><pIPI>10.0000<\/pIPI><vIPI>90.00<\/vIPI><\/IPITrib><\/IPI>/)
  assert.match(x, /<PISAliq><CST>01<\/CST>/); assert.match(x, /<tpAmb>1<\/tpAmb>/); assert.match(x, /<xNome>Cliente Contribuinte Ltda<\/xNome>/); assert.match(x, /<modFrete>9<\/modFrete>/)
})

// (c) CST 10 com ST e FCP-ST (RJ → RJ, FCP 2%)
run('CST 10 com ST + FCP-ST', scenario({
  tctx: ctx({ companyUf: 'RJ', destUf: 'RJ', rules: [rule({ tax: 'ICMS', cst: '10' }), rule({ tax: 'ICMS_ST', cst: '10', mva: 40 })] }), crt: '3',
  dest: { ...destPJ, uf: 'RJ', cityCode: '3304557', city: 'Rio de Janeiro', zip: '20010000', ie: '81265011' },
  lines: [{ ncm: '40111000', cfop: '5403', qty: 4, price: 250, cest: '1600100' }], freight: 40,
}), (x) => {
  assert.match(x, /<ICMS10>.*<vBCFCP>1040.00<\/vBCFCP><pFCP>2.0000<\/pFCP><vFCP>20.80<\/vFCP><modBCST>4<\/modBCST><pMVAST>40.0000<\/pMVAST><vBCST>1456.00<\/vBCST><pICMSST>22.0000<\/pICMSST><vICMSST>91.52<\/vICMSST><vBCFCPST>1456.00<\/vBCFCPST><pFCPST>2.0000<\/pFCPST><vFCPST>8.32<\/vFCPST><\/ICMS10>/)
  assert.match(x, /<CEST>1600100<\/CEST>/)
}, )

// (d) Interestadual a não contribuinte com DIFAL (SP → BA, FCP do destino 2%)
run('Interestadual a não contribuinte com DIFAL', scenario({
  tctx: ctx({ destUf: 'BA', taxpayer: '9' }), crt: '3',
  dest: { document: '11444777000161', name: 'Hospital Não Contribuinte', ie: null, taxpayer: '9', street: 'Rua Chile', number: '1', district: 'Centro', cityCode: '2927408', city: 'Salvador', uf: 'BA', zip: '40020000' },
  lines: [{ ncm: '84672100', cfop: '6108', qty: 1, price: 1000 }],
}), (x) => {
  assert.match(x, /<idDest>2<\/idDest>/); assert.match(x, /<indFinal>1<\/indFinal>/); assert.match(x, /<indIEDest>9<\/indIEDest>/); assert.ok(!/<IE>\d+<\/IE><\/dest>/.test(x))
  assert.match(x, /<ICMSUFDest><vBCUFDest>1000.00<\/vBCUFDest><vBCFCPUFDest>1000.00<\/vBCFCPUFDest><pFCPUFDest>2.0000<\/pFCPUFDest><pICMSUFDest>20.5000<\/pICMSUFDest><pICMSInter>7.00<\/pICMSInter><pICMSInterPart>100.0000<\/pICMSInterPart><vFCPUFDest>20.00<\/vFCPUFDest><vICMSUFDest>135.00<\/vICMSUFDest><vICMSUFRemet>0.00<\/vICMSUFRemet><\/ICMSUFDest>/)
  assert.match(x, /<vFCPUFDest>20.00<\/vFCPUFDest><vICMSUFDest>135.00<\/vICMSUFDest><vICMSUFRemet>0.00<\/vICMSUFRemet><vFCP>/)
})

// (e) CPF destinatário (consumidor final na mesma UF), Simples CSOSN 101 com crédito
run('CPF destinatário, CSOSN 101 com crédito', scenario({
  tctx: ctx({ regime: 'simples', taxpayer: '9', rules: [rule({ tax: 'ICMS', cst: '101' })] }), crt: '1',
  dest: { document: '52998224725', name: 'José da Silva', taxpayer: '9', street: 'Rua A', number: '', district: 'Centro', cityCode: '3550308', city: 'São Paulo', uf: 'SP', zip: '01001000', email: 'jose@exemplo.com' },
  lines: [{ ncm: '39269090', cfop: '5102', qty: 10, price: 12.35 }],
}), (x) => {
  assert.match(x, /<CPF>52998224725<\/CPF>/); assert.match(x, /<nro>S\/N<\/nro>/)
  assert.match(x, /<ICMSSN101><orig>0<\/orig><CSOSN>101<\/CSOSN><pCredSN>1.8600<\/pCredSN><vCredICMSSN>2.30<\/vCredICMSSN><\/ICMSSN101>/)
})

// Simples com ST (CSOSN 201: ST + crédito) também passa no XSD
run('Simples CSOSN 201 com ST', scenario({
  tctx: ctx({ regime: 'simples', rules: [rule({ tax: 'ICMS', cst: '201' }), rule({ tax: 'ICMS_ST', cst: '201', mva: 35 })] }), crt: '1', dest: destPJ,
  lines: [{ ncm: '40111000', cfop: '5401', qty: 2, price: 300 }],
}))

// Redução de base (CST 20) e XSD pega erro de dado inválido
run('CST 20 com redução de base', scenario({
  tctx: ctx({ rules: [rule({ tax: 'ICMS', cst: '20', base_reduction: 33.33 })] }), crt: '3', dest: destPJ,
  lines: [{ ncm: '84672100', cfop: '5102', qty: 1, price: 1000 }],
}), (x) => assert.match(x, /<ICMS20><orig>0<\/orig><CST>20<\/CST><modBC>3<\/modBC><pRedBC>33.3300<\/pRedBC><vBC>666.70<\/vBC>/))

const bad = signXml(scenario({ tctx: ctx({}), crt: '3', dest: destPJ, lines: [{ ncm: '84672100', cfop: '5102', qty: 1, price: 10 }] }).xml.replace('<CEP>01001000</CEP>', '<CEP>0100</CEP>'), cert)
const badResult = validateXsd(bad)
assert.equal(badResult.valid, false); assert.ok(badResult.errors.some((e) => e.includes('CEP')), badResult.errors.join('\n'))
passed++; console.log('  ✓ XSD aponta o campo inválido (CEP)')

console.log(`\n${passed} verificações do XML da NF-e passaram`)
