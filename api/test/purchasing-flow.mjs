// Teste de ponta a ponta do módulo de Compras contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/purchasing-flow.mjs
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36)
let passed = 0

async function call(token, method, path, body, expectStatus) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expectStatus) assert.equal(res.status, expectStatus, `${method} ${path}: esperado ${expectStatus}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const ok = (msg) => { passed++; console.log('  ✓', msg) }

function cnpj(base12) {
  const dv = (b, w) => { const r = b.split('').reduce((s, d, i) => s + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base12}${d1}${d2}`
}
const rand12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '1')

function nfeXml({ key, number, emitCnpj, emitName, xPed, items }) {
  const det = items.map((it, i) => `
      <det nItem="${i + 1}"><prod>
        <cProd>${it.code}</cProd><cEAN>${it.ean ?? 'SEM GTIN'}</cEAN><xProd>${it.desc}</xProd><NCM>${it.ncm ?? '73181500'}</NCM>
        <CFOP>5102</CFOP><uCom>${it.unit ?? 'UN'}</uCom><qCom>${it.qty.toFixed(4)}</qCom><vUnCom>${it.price.toFixed(10)}</vUnCom>
        <vProd>${(it.qty * it.price).toFixed(2)}</vProd>${xPed ? `<xPed>${xPed}</xPed>` : ''}
      </prod></det>`).join('')
  const total = items.reduce((s, it) => s + it.qty * it.price, 0).toFixed(2)
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
  <ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${number}</nNF><dhEmi>2026-09-24T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
  <emit><CNPJ>${emitCnpj}</CNPJ><xNome>${emitName}</xNome><xFant>${emitName}</xFant><enderEmit><xMun>São Paulo</xMun><UF>SP</UF><fone>1133334444</fone></enderEmit></emit>
  <dest><CNPJ>11222333000181</CNPJ><xNome>Cliente</xNome></dest>${det}
  <total><ICMSTot><vProd>${total}</vProd><vNF>${total}</vNF></ICMSTot></total>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`
}
const key44 = () => ('35260911222333000181550010000' + String(Math.floor(Math.random() * 1e15)).padStart(15, '0')).slice(0, 44)

console.log('Compras – fluxo completo')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token

// Usuários com perfis diferentes
const pass = 'Senha-forte-123'
const mk = (name, permissions) => call(admin, 'POST', '/users', { name, email: `${name.toLowerCase()}.${run}@teste.com`, password: pass, permissions })
const users = {
  joao: await mk('Joao', ['solicitante']),
  maria: await mk('Maria', ['comprador', 'solicitante']),
  fiscal: await mk('Fabio', ['fiscal']),
  carlos: await mk('Carlos', ['aprovador']),
  diretora: await mk('Diretora', ['aprovador']),
}
const login = async (u) => (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
const t = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await login(u)])))
await call(t.joao, 'POST', '/users', { name: 'x', email: `x${run}@t.com`, password: pass }, 403)
ok('usuários criados com perfis; não-admin não cria usuário')

// Alçadas: nível 1 até R$ 1.000 (Carlos), nível 2 sem limite (Diretora)
const ag = await call(admin, 'POST', '/approval-groups', {
  name: `Padrão ${run}`,
  levels: [{ level: 1, limitAmount: 1000, userIds: [users.carlos.id] }, { level: 2, limitAmount: null, userIds: [users.diretora.id] }],
})
await call(admin, 'POST', '/approval-groups', { name: `Ruim ${run}`, levels: [{ level: 1, limitAmount: null, userIds: [users.carlos.id] }, { level: 2, limitAmount: 5, userIds: [users.carlos.id] }] }, 400)
const pg = await call(admin, 'POST', '/purchase-groups', { name: `Materiais ${run}`, approvalGroupId: ag.id, buyerIds: [users.maria.id] })
ok('grupo de aprovação com 2 níveis e grupo de compras; limites inválidos recusados')

// Produtos e fornecedores
const p1 = await call(admin, 'POST', '/products', { sku: `PAR-${run}`, name: 'Parafuso sextavado 5mm zincado', unit: 'UN', costPrice: 0.1, stock: 100 })
const p2 = await call(admin, 'POST', '/products', { sku: `TIN-${run}`, name: 'Tinta acrílica branca 18L', unit: 'UN', barcode: `789${run.slice(0, 5)}01`.replace(/\D/g, '1').slice(0, 13) })
const sA = await call(t.maria, 'POST', '/suppliers', { cnpj: cnpj(rand12()), name: `Fornecedor A ${run}` })
const sB = await call(t.maria, 'POST', '/suppliers', { cnpj: cnpj(rand12()), name: `Fornecedor B ${run}` })
await call(t.maria, 'POST', '/suppliers', { cnpj: '11111111111111', name: 'x' }, 400)
await call(t.joao, 'POST', '/suppliers', { cnpj: cnpj(rand12()), name: 'x' }, 403)
ok('fornecedores com CNPJ validado; solicitante não cadastra fornecedor')

// Solicitação
const sc = await call(t.joao, 'POST', '/purchase-requests', {
  purchaseGroupId: pg.id, notes: 'Reposição',
  items: [{ productId: p1.id, quantity: 1000 }, { productId: p2.id, quantity: 10 }, { description: 'Luva de raspa', unit: 'PAR', quantity: 20 }],
})
assert.equal(sc.items.length, 3); assert.equal(sc.status, 'aberta')
await call(t.carlos, 'POST', '/purchase-requests', { purchaseGroupId: pg.id, items: [{ description: 'x', quantity: 1 }] }, 403)
const mine = await call(t.joao, 'GET', '/purchase-requests')
assert.ok(mine.some((r) => r.id === sc.id))
ok(`solicitação ${sc.code} com 3 itens (2 produtos + 1 descrição livre)`)

// Cotação
const pending = (await call(t.maria, 'GET', '/purchase-requests/pending-items')).filter((i) => i.requestId === sc.id)
assert.equal(pending.length, 3)
await call(t.joao, 'POST', '/quotations', { requestItemIds: pending.map((i) => i.id), supplierIds: [sA.id] }, 403)
let q = await call(t.maria, 'POST', '/quotations', { requestItemIds: pending.map((i) => i.id), supplierIds: [sA.id, sB.id] })
assert.equal((await call(t.maria, 'GET', `/purchase-requests/${sc.id}`)).status, 'em_cotacao')
await call(t.maria, 'POST', '/quotations', { requestItemIds: [pending[0].id], supplierIds: [sA.id] }, 400)
const item = (desc) => q.items.find((i) => i.description.startsWith(desc))
const sup = (s) => q.suppliers.find((x) => x.supplierId === s.id)
q = await call(t.maria, 'PUT', `/quotations/${q.id}/responses`, {
  suppliers: [
    { quotationSupplierId: sup(sA).id, paymentTerms: '28 dias', deliveryDays: 5, freight: 50, prices: [
      { quotationItemId: item('Parafuso').id, unitPrice: 0.12 }, { quotationItemId: item('Tinta').id, unitPrice: 320 }, { quotationItemId: item('Luva').id, unitPrice: null }] },
    { quotationSupplierId: sup(sB).id, paymentTerms: '30/60', deliveryDays: 3, freight: 0, prices: [
      { quotationItemId: item('Parafuso').id, unitPrice: 0.15 }, { quotationItemId: item('Tinta').id, unitPrice: 299.9 }, { quotationItemId: item('Luva').id, unitPrice: 12.5 }] },
  ],
})
assert.deepEqual(item('Parafuso').bestSupplierIds, [sup(sA).id])
assert.deepEqual(item('Tinta').bestSupplierIds, [sup(sB).id])
assert.equal(sup(sA).total, 1000 * 0.12 + 10 * 320 + 50)
ok(`${q.code}: mapa comparativo aponta o menor preço por item e total por fornecedor`)

await call(t.maria, 'POST', `/quotations/${q.id}/close`, { winners: [{ quotationItemId: item('Luva').id, quotationSupplierId: sup(sA).id }] }, 400)
const closed = await call(t.maria, 'POST', `/quotations/${q.id}/close`, {
  winners: q.items.map((i) => ({ quotationItemId: i.id, quotationSupplierId: i.bestSupplierIds[0] })),
})
assert.equal(closed.orders.length, 2)
const orderA = closed.orders.find((o) => o.supplierName.includes('A'))
const orderB = closed.orders.find((o) => o.supplierName.includes('B'))
assert.equal(orderA.total, 170) // 1000 × 0,12 + frete 50
assert.equal(orderB.total, 3249) // 10 × 299,90 + 20 × 12,50
assert.equal((await call(t.joao, 'GET', `/purchase-requests/${sc.id}`)).status, 'atendida')
ok(`pedidos gerados: ${orderA.code} R$ 170 (A) e ${orderB.code} R$ 3.249 (B); solicitação atendida`)

// Alçada
let oA = await call(t.maria, 'GET', `/purchase-orders/${orderA.id}`)
let oB = await call(t.maria, 'GET', `/purchase-orders/${orderB.id}`)
assert.deepEqual(oA.requiredLevels, [1]); assert.deepEqual(oB.requiredLevels, [1, 2])
await call(t.maria, 'POST', `/purchase-orders/${orderB.id}/approve`, {}, 403)
await call(t.diretora, 'POST', `/purchase-orders/${orderB.id}/approve`, {}, 403) // nível 1 vem antes
assert.equal((await call(t.carlos, 'GET', '/purchase-orders/pending-approval')).filter((o) => [orderA.id, orderB.id].includes(o.id)).length, 2)
oB = await call(t.carlos, 'POST', `/purchase-orders/${orderB.id}/approve`, { comment: 'ok nível 1' })
assert.equal(oB.status, 'aguardando_aprovacao'); assert.equal(oB.pendingLevel, 2)
oB = await call(t.diretora, 'POST', `/purchase-orders/${orderB.id}/approve`, {})
assert.equal(oB.status, 'aprovado')
await call(t.carlos, 'POST', `/purchase-orders/${orderA.id}/reject`, {}, 400) // precisa de motivo
oA = await call(t.carlos, 'POST', `/purchase-orders/${orderA.id}/approve`, {})
assert.equal(oA.status, 'aprovado')
ok('alçada: R$ 170 só nível 1; R$ 3.249 níveis 1 e 2 em ordem; comprador não aprova o próprio pedido')

// Nota fiscal por XML
const stockBefore = (await call(admin, 'GET', `/products/${p1.id}`)).stock
const key = key44()
const xml = nfeXml({ key, number: '1234', emitCnpj: sA.cnpj, emitName: sA.name, xPed: String(oA.number), items: [
  { code: 'ABC-55', desc: 'PARAF SEXT 5MM ZB', qty: 1000, price: 0.12 },
] })
let nf = await call(t.maria, 'POST', '/invoices/import', { xml })
assert.equal(nf.purchaseOrderId, oA.id)
assert.equal(nf.items[0].productId, p1.id, 'item deveria ser amarrado pelo pedido')
assert.equal(nf.items[0].matchSource, 'pedido')
await call(t.maria, 'POST', '/invoices/import', { xml }, 409)
await call(t.maria, 'POST', '/invoices/import', { xml: '<nada/>' }, 400)
ok('XML importado: pedido achado pelo xPed e "PARAF SEXT 5MM ZB" ligado ao parafuso; nota repetida recusada')

assert.equal(nf.status, 'pre_nota')
assert.equal(nf.items[0].tesLabel?.slice(0, 3), '001', 'TES de compra sugerida pela matriz')
assert.equal(Number((await call(admin, 'GET', `/products/${p1.id}`)).stock), stockBefore, 'pré-nota não mexe no estoque')
await call(t.maria, 'POST', `/invoices/${nf.id}/classify`, undefined, 403)
nf = await call(t.fiscal, 'POST', `/invoices/${nf.id}/classify`)
assert.equal(nf.status, 'classificada')
assert.ok(nf.titles.length >= 1 && nf.titles.every((x) => x.kind === 'P' && x.docType === 'NF'), 'contas a pagar')
const p1After = await call(admin, 'GET', `/products/${p1.id}`)
assert.equal(p1After.stock, stockBefore + 1000)
assert.ok(Math.abs(p1After.costPrice - (100 * 0.1 + 1000 * 0.12) / 1100) < 1e-4, `custo médio ${p1After.costPrice}`)
assert.equal((await call(t.maria, 'GET', `/purchase-orders/${oA.id}`)).status, 'recebido')
ok(`pré-nota classificada pelo fiscal (comprador não classifica): estoque ${stockBefore} → ${p1After.stock}, custo médio ${p1After.costPrice.toFixed(4)}, pedido recebido`)

// Segunda nota do mesmo fornecedor: amarração aprendida, sem pedido em aberto
const nf2 = await call(t.maria, 'POST', '/invoices/import', { xml: nfeXml({ key: key44(), number: '1300', emitCnpj: sA.cnpj, emitName: sA.name, items: [
  { code: 'ABC-55', desc: 'PARAFUSO SEXTAVADO', qty: 10, price: 0.13 }, { code: 'ZZ-9', desc: 'ITEM DESCONHECIDO XYZ', qty: 1, price: 5 },
] }) })
assert.equal(nf2.items[0].productId, p1.id); assert.equal(nf2.items[0].matchSource, 'amarracao')
assert.equal(nf2.items[1].productId, null)
assert.ok(nf2.warnings.some((w) => w.includes('sem pedido')))
await call(t.fiscal, 'POST', `/invoices/${nf2.id}/classify`, undefined, 400)
const aiRes = await fetch(`${API}/invoices/${nf2.id}/ai-match`, { method: 'POST', headers: { Authorization: `Bearer ${t.maria}` } })
if (nf2.aiEnabled) assert.ok(aiRes.status < 500); else assert.equal(aiRes.status, 503)
await call(t.maria, 'PUT', `/invoices/${nf2.id}`, { items: [{ id: nf2.items[1].id, productId: p2.id }] })
await call(t.maria, 'DELETE', `/invoices/${nf2.id}`)
ok('2ª nota: código do fornecedor reconhecido pela amarração; item desconhecido bloqueia o lançamento')

// Nota de fornecedor novo cria o cadastro dele
const novo = cnpj(rand12())
const nf3 = await call(t.maria, 'POST', '/invoices/import', { xml: nfeXml({ key: key44(), number: '9', emitCnpj: novo, emitName: 'Fornecedor Novo', items: [{ code: '1', desc: 'X', qty: 1, price: 1 }] }) })
assert.ok((await call(t.maria, 'GET', `/suppliers?q=${novo}`)).some((s) => s.cnpj === novo))
await call(t.maria, 'DELETE', `/invoices/${nf3.id}`)
ok('fornecedor novo cadastrado automaticamente a partir do XML')

console.log(`\n${passed} verificações passaram`)
