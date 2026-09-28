// Teste de ponta a ponta de centros de custo, relatório por centro e DRE contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/cost-center-flow.mjs
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36).slice(-5).toUpperCase()
const num = String(Date.now()).slice(-6)
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '4')
const r2 = (n) => Math.round(n * 100) / 100
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const month = today.slice(0, 7)
const line = (dre, code) => dre.lines.find((l) => l.code === code).amount

const IE = { ES: '082560013', AM: '043413412', MS: '283115947', AC: '0100482300112', AL: '240000048', AP: '030123459', BA: '12345663', CE: '060000015', DF: '0730000100109', GO: '109876547', MA: '120000385', MT: '00130000019', MG: '0623079040081', PA: '159999995', PB: '060000015', PR: '1234567850', PE: '032141840', PI: '012345679', RJ: '99999993', RN: '200400401', RS: '2243658792', RO: '00000000625213', RR: '240066281', SC: '251040852', SP: '110042490114', SE: '271234563', TO: '29010227836' } // exemplos válidos das SEFAZ
console.log('Centros de custo, relatório por centro e DRE')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const user = async (name, permissions) => {
  const u = await call(admin, 'POST', '/users', { name: `${name} ${run}`, email: `${name.toLowerCase()}.cc.${run}@t.com`.toLowerCase(), password: pass, permissions })
  return (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
}
const tFin = await user('Financeiro', ['financeiro'])
const tVend = await user('Vendedor', ['vendedor', 'faturamento'])

// Cadastro com hierarquia; os de demonstração já vêm prontos
const seeded = await call(tFin, 'GET', '/catalog/cost-centers')
assert.ok(['01', '02', '03'].every((c) => seeded.some((s) => s.code === c)), 'centros de demonstração')
const group = await call(tFin, 'POST', '/catalog/cost-centers', { code: `9${num}`, name: 'Filial teste ' + run, type: 'S' })
const ccA = await call(tFin, 'POST', '/catalog/cost-centers', { code: `9${num}.01`, name: 'Loja ' + run, type: 'A', parentId: group.id })
const ccB = await call(tFin, 'POST', '/catalog/cost-centers', { code: `9${num}.02`, name: 'Vendas ' + run, type: 'A', parentId: group.id })
assert.equal(ccA.parentIdLabel, `9${num} · Filial teste ${run}`)
await call(tFin, 'POST', '/catalog/cost-centers', { code: `9${num}`, name: 'Duplicado', type: 'A' }, 409)
const options = await call(tVend, 'GET', '/finance/cost-centers/options')
assert.ok(options.some((o) => o.value === ccA.id) && !options.some((o) => o.value === group.id), 'só analíticos nas opções')
ok('cadastro de centros de custo com sintético e analíticos; opções só com analíticos')

// Títulos com centro de custo e natureza (plano de contas → linha da DRE)
const cats = await call(tFin, 'GET', '/catalog/finance-categories')
const cat = (code) => cats.find((c) => c.code === code)
assert.equal(cat('2.02').dreLine, 'desp_adm'); assert.equal(cat('2.01').dreLine, 'fora'); assert.equal(cat('2.09').dreLine, 'ir_csll')
const title = (kind, category, amount, costCenterId, description) =>
  call(tFin, 'POST', '/finance/titles', { kind, categoryId: category && cat(category).id, costCenterId, description: `${description} ${run}`, dueDate: today, amount })
await call(tFin, 'POST', '/finance/titles', { kind: 'P', description: 'Sintético ' + run, dueDate: today, amount: 10, costCenterId: group.id }, 400)
const rent = await title('P', '2.02', 300, ccA.id, 'Aluguel')
assert.equal(rent.costCenterId, ccA.id); assert.equal(rent.costCenter, `9${num}.01 · Loja ${run}`)
const ads = await title('P', '2.11', 100, ccB.id, 'Anúncios')
await title('R', '1.99', 50, ccA.id, 'Venda de sucata')
await title('P', '2.01', 70, ccA.id, 'Compra avulsa de mercadoria')
await title('P', '2.09', 20, ccA.id, 'IRPJ')
await title('P', null, 15, ccA.id, 'Sem natureza')
let moved = await call(tFin, 'PATCH', `/finance/titles/${ads.id}`, { costCenterId: ccA.id })
assert.equal(moved.costCenterId, ccA.id)
moved = await call(tFin, 'PATCH', `/finance/titles/${ads.id}`, { costCenterId: ccB.id })
assert.equal(moved.costCenterId, ccB.id)
const listed = await call(tFin, 'GET', `/finance/titles?kind=P&status=todos&costCenterId=${ccA.id}`)
assert.equal(listed.length, 4)
ok('títulos lançados com centro de custo (sintético recusado), alterados e filtrados por centro')

// Venda com centro de custo: nota e contas a receber herdam do pedido
if (!(await call(admin, 'GET', '/catalog/companies')).some((c) => c.active && c.isHead)) {
  await call(admin, 'POST', '/catalog/companies', { code: String(1000 + Math.floor(Math.random() * 9000)), isHead: true, document: cnpj(r12()), name: 'Matriz ' + run, uf: 'SP' })
}
const head = await call(admin, 'GET', '/companies/branding')
const customer = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: 'Cliente CC ' + run, uf: head?.uf || 'SP', taxpayer: '1', ie: IE[head?.uf || 'SP'] })
const product = await call(admin, 'POST', '/products', { sku: `CC-${run}`, name: 'Produto centro de custo', unit: 'UN', costPrice: 40, salePrice: 100, stock: 10 })
const terms = await call(admin, 'GET', '/catalog/payment-terms')
const order = await call(tVend, 'POST', '/sales-orders', { customerId: customer.id, paymentTermId: terms.find((t) => t.days === '30/60').id, costCenterId: ccB.id, items: [{ productId: product.id, quantity: 3 }] })
assert.equal(order.costCenterId, ccB.id)
const nf = await call(tVend, 'POST', `/sales-orders/${order.id}/invoice`)
assert.equal(nf.costCenterId, ccB.id)
assert.equal(nf.titles.length, 2)
const received = await call(tFin, 'GET', `/finance/titles?kind=R&status=todos&costCenterId=${ccB.id}`)
assert.equal(received.length, 2)
assert.equal(r2(received.reduce((s, t) => s + t.amount, 0)), nf.total)
const salesTaxes = r2(['icms', 'fcp', 'difal', 'fcpDest', 'pis', 'cofins'].reduce((s, k) => s + (nf.taxes[k] ?? 0), 0))
assert.ok(salesTaxes > 0, 'nota com impostos')
ok(`pedido com centro de custo faturado: NF ${nf.number} e as 2 parcelas a receber ficaram no centro ${ccB.code}`)

// Uma baixa com juros vira despesa financeira
await call(tFin, 'POST', `/finance/titles/${rent.id}/pay`, { bankAccountId: (await call(tFin, 'GET', '/finance/bank-balances'))[0].id, paidAt: today, amount: 310, interest: 10 })

// DRE do centro sintético (soma os filhos)
await call(tVend, 'GET', `/finance/dre?from=${month}&to=${month}`, undefined, 403)
const dre = await call(tFin, 'GET', `/finance/dre?from=${month}&to=${month}&costCenterId=${group.id}&compare=anterior`)
assert.deepEqual(dre.months, [month])
assert.equal(line(dre, 'receita'), 300)
assert.equal(line(dre, 'deducao'), -salesTaxes)
assert.equal(line(dre, 'receita_liquida'), r2(300 - salesTaxes))
assert.equal(line(dre, 'cmv'), -120)
assert.equal(line(dre, 'lucro_bruto'), r2(300 - salesTaxes - 120))
assert.equal(line(dre, 'desp_adm'), -300)
assert.equal(line(dre, 'desp_com'), -100)
assert.equal(line(dre, 'desp_fin'), -10)
assert.equal(line(dre, 'outras'), 50)
assert.equal(line(dre, 'ir_csll'), -20)
const expected = r2(300 - salesTaxes - 120 - 300 - 100 - 10 + 50 - 20)
assert.equal(line(dre, 'lucro_liquido'), expected)
assert.equal(dre.lines.find((l) => l.code === 'lucro_liquido').values[0], expected)
assert.equal(dre.lines.find((l) => l.code === 'lucro_liquido').compare, 0)
assert.deepEqual(dre.unclassified, { count: 1, amount: 15 })
ok(`DRE do centro ${group.code}: receita 300, impostos ${salesTaxes}, CMV 120, despesas 410, outras 50, IR 20 → lucro líquido ${expected}; compra de mercadoria fora; 1 título sem natureza`)

const dreA = await call(tFin, 'GET', `/finance/dre?from=${month}&to=${month}&costCenterId=${ccA.id}`)
assert.equal(line(dreA, 'receita'), 0); assert.equal(line(dreA, 'desp_adm'), -300); assert.equal(line(dreA, 'desp_com'), 0)
assert.equal(line(dreA, 'lucro_liquido'), r2(-300 - 10 + 50 - 20))
ok('DRE filtrada por um centro analítico só traz os lançamentos dele')

// Relatório por centro de custo (competência e caixa) com detalhamento
const rep = await call(tFin, 'GET', `/finance/cost-center-report?from=${today}&to=${today}`)
const row = (r, id) => r.rows.find((x) => x.id === id)
assert.deepEqual([row(rep, ccA.id).revenue, row(rep, ccA.id).expense], [50, 300 + 70 + 20 + 15])
assert.deepEqual([row(rep, ccB.id).revenue, row(rep, ccB.id).expense], [nf.total, 100])
assert.equal(row(rep, group.id).result, r2(50 + nf.total - 405 - 100))
assert.equal(row(rep, ccA.id).level, 1)
const details = await call(tFin, 'GET', `/finance/cost-center-report/details?from=${today}&to=${today}&costCenterId=${group.id}`)
assert.equal(details.length, 8)
assert.equal(r2(details.reduce((s, d) => s + d.amount, 0)), row(rep, group.id).result)
const cash = await call(tFin, 'GET', `/finance/cost-center-report?from=${today}&to=${today}&basis=caixa`)
assert.deepEqual([row(cash, ccA.id).revenue, row(cash, ccA.id).expense], [0, 310])
ok(`relatório por centro: ${ccA.code} receitas 50 / despesas 405, ${ccB.code} receitas ${nf.total} / despesas 100; sintético soma os filhos; detalhamento e regime de caixa conferem`)

console.log(`\n${passed} verificações passaram`)
