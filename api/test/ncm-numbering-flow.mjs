// NCM automático ao salvar produto, pré-requisitos da venda, tributos aproximados e numeração das notas (MV_ESPECIE).
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/ncm-numbering-flow.mjs
// O Gemini não é chamado de verdade: sem chave (ou sem rede) o NCM fica com a descrição pendente.
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36).slice(-5).toUpperCase()
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ncmCode = () => '9' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
async function findNcm(token, code) {
  for (let i = 0; i < 40; i++) {
    const row = (await call(token, 'GET', `/catalog/ncm?q=${code}`)).find((n) => n.code === code)
    if (row) return row
    await sleep(100)
  }
  return null
}

console.log('NCM automático, pré-requisitos da venda e numeração das notas')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const user = async (name, permissions) => {
  const u = await call(admin, 'POST', '/users', { name: `${name} ${run}`, email: `${name.toLowerCase()}.${run}@n.com`.toLowerCase(), password: pass, permissions })
  return (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
}
const tCad = await user('Cadastro', ['cadastro'])
const tFat = await user('Faturista', ['faturamento'])
const saved = Object.fromEntries((await call(admin, 'GET', '/parameters')).map((p) => [p.key, p.value]))
const restore = () => call(admin, 'PUT', '/parameters', { MV_ESPECIE: saved.MV_ESPECIE, MV_SERNFE: saved.MV_SERNFE, MV_IBPTPCT: saved.MV_IBPTPCT })

try {
  // 1. NCM novo no produto entra sozinho no cadastro, com descrição pendente (sem Gemini)
  const code1 = ncmCode()
  const code2 = ncmCode()
  const started = Date.now()
  const prod = await call(tCad, 'POST', '/products', { sku: `NC-${run}`, name: 'Caixa plástica', unit: 'UN', ncm: code1, costPrice: 10, salePrice: 100, stock: 50 })
  assert.ok(Date.now() - started < 3000, 'salvar o produto não espera a IA')
  let n1 = await findNcm(tCad, code1)
  assert.ok(n1, 'NCM criado'); assert.equal(n1.pending, true); assert.equal(n1.description, `NCM ${code1} (descrição pendente)`)
  await call(tCad, 'PATCH', `/products/${prod.id}`, { ncm: code2 })
  const n2 = await findNcm(tCad, code2)
  assert.ok(n2?.pending, 'NCM do PATCH também criado')
  // NCM que já existe não é mexido
  await call(tCad, 'POST', '/products', { sku: `NC2-${run}`, name: 'Outra caixa', unit: 'UN', ncm: code2 })
  assert.equal((await call(tCad, 'GET', `/catalog/ncm?q=${code2}`)).filter((n) => n.code === code2).length, 1)
  ok(`produto com NCM ${code1} salvo na hora; NCM cadastrado sozinho como "descrição pendente" (POST e PATCH)`)

  // Buscar com IA: sem Gemini configurado (ou sem rede) falha com mensagem clara; editar a descrição resolve a pendência
  const settings = await call(admin, 'GET', '/settings')
  if (!settings.gemini.configured) {
    const err = await call(tCad, 'POST', `/catalog/ncm/${n1.id}/describe`, undefined, 400)
    assert.match(err.message, /descrição/)
  }
  n1 = await call(tCad, 'PATCH', `/catalog/ncm/${n1.id}`, { description: 'Caixas de plástico' })
  await call(tCad, 'PATCH', `/catalog/ncm/${n2.id}`, { taxEstimateRate: 20 })
  assert.equal(n1.pending, false, 'corrigir a descrição tira a pendência')
  await call(tCad, 'POST', `/catalog/ncm/${n1.id}/describe`, undefined, 400)
  ok('"Buscar descrição com IA" sem Gemini avisa e não quebra; corrigir a descrição na tela tira a pendência')

  // 2. Pré-requisitos da venda
  const tVend = await user('Vendedor', ['vendedor'])
  await call(tCad, 'GET', '/sales/readiness', undefined, 403)
  let companies = (await call(admin, 'GET', '/catalog/companies')).filter((c) => c.active)
  if (!companies.some((c) => c.isHead)) {
    await call(admin, 'POST', '/catalog/companies', { code: String(1000 + Math.floor(Math.random() * 9000)), isHead: true, document: cnpj(r12()), name: 'Matriz ' + run, uf: 'SP' })
  }
  const branch = await call(admin, 'POST', '/catalog/companies', { code: String(1000 + Math.floor(Math.random() * 9000)), document: cnpj(r12()), name: 'Filial ' + run, uf: 'SP', taxRegime: 'simples' })
  let ready = await call(tVend, 'GET', `/sales/readiness?companyId=${branch.id}`)
  assert.equal(ready.ready, true, 'faltar IE/endereço não impede o pedido')
  assert.equal(ready.complete, false)
  assert.ok(ready.issues.some((i) => i.key === 'ie' && !i.blocking && i.link === '/empresas'))
  assert.ok(ready.issues.some((i) => i.key === 'address'))
  assert.equal(ready.company.regime, 'simples')
  await call(admin, 'PATCH', `/catalog/companies/${branch.id}`, { ie: '110042490114', zip: '01001000', street: 'Praça da Sé', number: '1', district: 'Sé', city: 'São Paulo' })
  ready = await call(tVend, 'GET', `/sales/readiness?companyId=${branch.id}`)
  assert.deepEqual(ready.issues.filter((i) => i.key !== 'series'), [])
  assert.equal(ready.numbering.series, saved.MV_SERNFE)
  ok('GET /sales/readiness: empresa sem IE e endereço aparece como pendência (com link para Empresas) antes de preencher o pedido')

  // 3. Simples Nacional: CSOSN 102 sem destaque, com tributos aproximados (NCM 20%; padrão MV_IBPTPCT)
  await call(admin, 'PUT', '/parameters', { MV_IBPTPCT: 12.5 })
  const cust = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: 'Cliente NCM ' + run, uf: 'SP', taxpayer: '1', ie: '110042490114' })
  const prodB = await call(tCad, 'POST', '/products', { sku: `NB-${run}`, name: 'Tampa', unit: 'UN', costPrice: 1, salePrice: 40, stock: 50 })
  const terms = await call(admin, 'GET', '/catalog/payment-terms')
  const vista = terms.find((t) => t.days === '0')
  const body = { companyId: branch.id, customerId: cust.id, paymentTermId: vista.id, freight: 15, items: [{ productId: prod.id, quantity: 2 }, { productId: prodB.id, quantity: 1 }] }
  const pv = await call(tVend, 'POST', '/sales/preview', body)
  assert.equal(pv.regime, 'simples')
  assert.equal(pv.items[0].taxes.icms.cst, '102'); assert.equal(pv.totals.icms, 0)
  assert.equal(pv.items[0].taxes.approx.rate, 20); assert.equal(pv.items[1].taxes.approx.rate, 12.5)
  assert.equal(pv.totals.approxTax, 45)
  assert.equal(pv.totals.freight, 15, 'frete é o que foi digitado'); assert.equal(pv.totals.products, 240); assert.equal(pv.totals.total, 255)
  ok(`Simples: CSOSN 102 sem ICMS; tributos aproximados R$ ${pv.totals.approxTax} (20% do NCM + 12,5% do MV_IBPTPCT); frete só o digitado`)

  // 4. Numeração das notas
  await call(tFat, 'GET', '/invoice-numbering', undefined, 403)
  await call(admin, 'PUT', '/parameters', { MV_ESPECIE: '1=SPED;2=' }, 400)
  await call(admin, 'PUT', '/parameters', { MV_ESPECIE: '1=SPED;2=SPED;3=NFCE', MV_SERNFE: 2 })
  let list = await call(admin, 'GET', '/invoice-numbering')
  assert.deepEqual(list.series, [{ series: 1, model: '55' }, { series: 2, model: '55' }, { series: 3, model: '65' }])
  let row = list.rows.find((r) => r.companyId === branch.id && r.series === 2)
  assert.ok(row, 'linha da série de venda criada para a empresa'); assert.equal(row.nextNumber, 1); assert.equal(row.model, '55')
  await call(admin, 'POST', '/invoice-numbering', { companyId: branch.id, series: 9, nextNumber: 1 }, 400)
  await call(admin, 'POST', '/invoice-numbering', { companyId: branch.id, series: 2, nextNumber: 1 }, 409)
  const nfce = await call(admin, 'POST', '/invoice-numbering', { companyId: branch.id, series: 3, nextNumber: 100 })
  assert.equal(nfce.model, '65')

  let res = await call(admin, 'PUT', `/invoice-numbering/${row.id}`, { nextNumber: 10 })
  assert.equal(res.nextNumber, 10); assert.ok(res.warnings[0].includes('inutilizados'))
  const order = async () => (await call(tVend, 'POST', '/sales-orders', body)).id
  const nfA = await call(tFat, 'POST', `/sales-orders/${await order()}/invoice`)
  assert.equal(nfA.number, 10); assert.equal(nfA.series, 2); assert.equal(nfA.model, '55')
  // Duas notas ao mesmo tempo nunca ficam com o mesmo número
  const [o1, o2, o3] = [await order(), await order(), await order()]
  const nfs = await Promise.all([o1, o2, o3].map((o) => call(tFat, 'POST', `/sales-orders/${o}/invoice`)))
  assert.deepEqual(nfs.map((n) => n.number).sort((a, b) => a - b), [11, 12, 13])
  ok(`MV_ESPECIE 1=SPED;2=SPED;3=NFCE e MV_SERNFE 2: NF ${nfA.number}/${nfA.series} depois de avançar a numeração; 3 notas simultâneas com 11, 12 e 13`)

  await call(admin, 'PUT', `/invoice-numbering/${row.id}`, { nextNumber: 12, confirmBackward: true }, 409)
  res = await call(admin, 'PUT', `/invoice-numbering/${row.id}`, { nextNumber: 20 })
  let err = await call(admin, 'PUT', `/invoice-numbering/${row.id}`, { nextNumber: 15 }, 400)
  assert.match(err.message, /confirme/)
  res = await call(admin, 'PUT', `/invoice-numbering/${row.id}`, { nextNumber: 15, confirmBackward: true })
  assert.equal(res.nextNumber, 15); assert.ok(res.warnings[0].includes('voltou'))
  const nfB = await call(tFat, 'POST', `/sales-orders/${await order()}/invoice`)
  assert.equal(nfB.number, 15)
  list = await call(admin, 'GET', '/invoice-numbering')
  row = list.rows.find((r) => r.id === row.id)
  assert.equal(row.nextNumber, 16); assert.equal(row.lastUsed, 15)
  ok('voltar a numeração para número já usado é recusado; para número livre, só com confirmação (e a nota sai com ele)')

  // Série fora do MV_ESPECIE ou de NFC-e não fatura, e a tela já avisa antes
  await call(admin, 'PUT', '/parameters', { MV_SERNFE: 7 })
  ready = await call(tVend, 'GET', `/sales/readiness?companyId=${branch.id}`)
  assert.ok(ready.issues.some((i) => i.key === 'series' && i.link === '/parametros'))
  err = await call(tFat, 'POST', `/sales-orders/${await order()}/invoice`, undefined, 400)
  assert.match(err.message, /MV_ESPECIE/)
  await call(admin, 'PUT', '/parameters', { MV_SERNFE: 3 })
  err = await call(tFat, 'POST', `/sales-orders/${await order()}/invoice`, undefined, 400)
  assert.match(err.message, /NFC-e/)
  await call(admin, 'PUT', `/invoice-numbering/${nfce.id}`, { active: false })
  ok('série fora do MV_ESPECIE ou de NFC-e: readiness avisa e o faturamento recusa com mensagem clara')

  // Nota do Simples mostra o regime e os tributos aproximados no espelho
  const detail = await call(tFat, 'GET', `/sales-invoices/${nfB.id}`)
  assert.equal(detail.taxRegime, 'simples'); assert.equal(detail.taxes.approxTax, 45); assert.equal(detail.freight, 15)
  ok('espelho da nota traz o regime da empresa e os tributos aproximados')
} finally {
  await restore()
}

console.log(`\n${passed} verificações passaram`)
