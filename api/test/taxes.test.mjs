// Contas do motor de impostos com casos conhecidos (sem banco).
import assert from 'node:assert/strict'
import { computeTaxes, interstateRate } from '../dist/taxes/tax-engine.js'

const uf = new Map([['SP', { internal: 18, fcp: 0 }], ['BA', { internal: 19.5, fcp: 1 }], ['MG', { internal: 18, fcp: 0 }], ['RJ', { internal: 20, fcp: 2 }]])
const params = { MV_FRETICM: true, MV_IPIBICM: true, MV_DIFAL: true, MV_ICMSPIS: true, MV_PISPRE: 0.65, MV_COFPRE: 3, MV_PISREAL: 1.65, MV_COFREAL: 7.6 }
const ctx = (o) => ({ regime: 'presumido', companyUf: 'SP', destUf: 'SP', taxpayer: '1', operationTypeId: 'op', date: '2026-09-25', snCreditRate: 1.25, uf, rules: [], ncmIpi: new Map([['84672100', 10]]), params, ...o })
const item = (o = {}) => ({ key: 'a', productId: 'p', ncm: '84672100', typeId: null, groupId: null, origin: 0, cfop: '5102', amount: 1000, ...o })
const rule = (o) => ({ regime: null, operation_type_id: null, uf: null, taxpayer: null, product_id: null, product_group_id: null, product_type_id: null, ncm_prefix: null, cfop: null, rate: null, base_reduction: 0, mva: null, st_rate: null, fcp_rate: null, credit_rate: null, name: o.tax, ...o })
let passed = 0
const ok = (m) => { passed++; console.log('  ✓', m) }

assert.equal(interstateRate('SP', 'BA', 0), 7); assert.equal(interstateRate('BA', 'SP', 0), 12); assert.equal(interstateRate('SP', 'RJ', 0), 12); assert.equal(interstateRate('SP', 'ES', 0), 7); assert.equal(interstateRate('SP', 'BA', 1), 4)
ok('alíquota interestadual: 7% S/SE → N/NE/CO/ES, 12% demais, 4% importado')

let r = computeTaxes(ctx({}), [item()], 0, 0)
assert.equal(r.items[0].taxes.icms.value, 180); assert.equal(r.items[0].taxes.pis.value, 5.33); assert.equal(r.items[0].taxes.cofins.value, 24.6)
assert.equal(r.totals.total, 1000)
ok('Presumido SP→SP: ICMS 18% = 180; PIS/COFINS sobre 820 (sem ICMS na base) = 5,33 e 24,60')

r = computeTaxes(ctx({ destUf: 'BA', taxpayer: '9' }), [item({ cfop: '6108' })], 0, 0)
assert.equal(r.items[0].taxes.icms.rate, 7); assert.equal(r.items[0].taxes.icms.value, 70)
assert.equal(r.items[0].taxes.difal.value, 125); assert.equal(r.items[0].taxes.difal.fcpValue, 10)
ok('SP→BA não contribuinte: ICMS 7% = 70; DIFAL 12,5% = 125; FCP BA 1% = 10')

r = computeTaxes(ctx({ rules: [rule({ tax: 'IPI', cst: '50' }), rule({ tax: 'ICMS', cst: '10' }), rule({ tax: 'ICMS_ST', cst: '10', mva: 40 })] }), [item()], 0, 0)
const t = r.items[0].taxes
assert.equal(t.ipi.value, 100); assert.equal(t.st.base, 1540); assert.equal(t.st.value, 97.2); assert.equal(t.total, 1197.2)
assert.deepEqual(r.warnings, [])
ok('ST interna com IPI 10% (NCM): IPI 100; base ST (1000+100)×1,40 = 1.540; ST 277,20 − 180 = 97,20; total do item 1.197,20')

r = computeTaxes(ctx({ destUf: 'MG', rules: [rule({ tax: 'ICMS', cst: '10' }), rule({ tax: 'ICMS_ST', cst: '10', mva: 40 })] }), [item({ cfop: '6403' })], 0, 0)
assert.equal(r.items[0].taxes.st.mva, 50.24); assert.equal(r.items[0].taxes.st.value, 150.43)
ok('ST interestadual SP→MG: MVA ajustada 50,24%; ST = 1.502,40 × 18% − 120 = 150,43')

r = computeTaxes(ctx({ regime: 'simples' }), [item()], 50, 100)
assert.equal(r.items[0].taxes.icms.cst, '102'); assert.equal(r.items[0].taxes.icms.value, 0); assert.equal(r.items[0].taxes.pis.cst, '99'); assert.equal(r.totals.total, 950)
ok('Simples sem regra: CSOSN 102 sem destaque; PIS/COFINS CST 99; total = 1000 − 100 desconto + 50 frete')

r = computeTaxes(ctx({ regime: 'simples', rules: [rule({ tax: 'ICMS', cst: '101' })] }), [item()], 0, 0)
assert.equal(r.items[0].taxes.icms.snCredit, 12.5)
ok('Simples CSOSN 101: crédito de 1,25% = 12,50')

r = computeTaxes(ctx({ regime: 'mei' }), [item({ cfop: '5405' })], 0, 0)
assert.ok(r.warnings.some((w) => w.includes('N12a-90')))
r = computeTaxes(ctx({ regime: 'mei', rules: [rule({ tax: 'ICMS', cst: '101' })] }), [item()], 0, 0)
assert.ok(r.warnings.some((w) => w.includes('N12a-80')))
ok('MEI: avisa CSOSN fora de 102/300/400/900 e CFOP diferente de 5102/6102 (NT 2024.001)')

r = computeTaxes(ctx({ rules: [rule({ tax: 'ICMS', cst: '20', base_reduction: 33.33 })] }), [item(), item({ key: 'b', amount: 500 })], 30, 0)
assert.equal(r.items[0].taxes.freight, 20); assert.equal(r.items[1].taxes.freight, 10)
assert.equal(r.items[0].taxes.icms.base, 680.03); assert.equal(r.items[0].taxes.icms.value, 122.41)
ok('CST 20 com redução de 33,33% e frete rateado (20 + 10) na base')

r = computeTaxes(ctx({ regime: 'real', rules: [rule({ tax: 'ICMS', cst: '00', uf: 'SP', ncm_prefix: '8467', rate: 12 }), rule({ tax: 'ICMS', cst: '00', rate: 25 })] }), [item()], 0, 0)
assert.equal(r.items[0].taxes.icms.rate, 12); assert.equal(r.items[0].taxes.pis.value, 14.52)
ok('regra mais específica vence (UF + NCM 8467 → 12%); Lucro Real PIS 1,65% sobre 880 = 14,52')

console.log(`\n${passed} verificações de impostos passaram`)
