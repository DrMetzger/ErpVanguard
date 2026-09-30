// Filiais contra uma API rodando: acesso por filial, cadastro exclusivo, estoque por filial e documentos na filial.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/branches-flow.mjs
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36).slice(-5).toUpperCase()
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect, branch) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(branch ? { 'X-Branch-Id': branch } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '5')
const company = (name) => ({ zip: '01001000', code: String(1000 + Math.floor(Math.random() * 9000)), document: cnpj(r12()), name, uf: 'SP', taxRegime: 'presumido', ie: '110042490114', street: 'Praça da Sé', number: '1', district: 'Sé', city: 'São Paulo', cityCode: '3550308' })

console.log('Filiais')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
let companies = (await call(admin, 'GET', '/catalog/companies')).filter((c) => c.active)
if (!companies.some((c) => c.isHead)) await call(admin, 'POST', '/catalog/companies', { ...company('Matriz ' + run), isHead: true })
const A = await call(admin, 'POST', '/catalog/companies', company('Filial A ' + run))
const B = await call(admin, 'POST', '/catalog/companies', company('Filial B ' + run))
const pass = 'Senha-forte-123'

// 1. Usuário amarrado a uma filial
await call(admin, 'POST', '/users', { name: 'X', email: `brx.${run}@t.com`.toLowerCase(), password: pass, branchIds: [A.id], defaultBranchId: B.id }, 400)
const u = await call(admin, 'POST', '/users', { name: 'Filial B ' + run, email: `brb.${run}@t.com`.toLowerCase(), password: pass, permissions: ['cadastro', 'vendedor', 'faturamento', 'financeiro'], branchIds: [B.id], defaultBranchId: B.id })
const login = await call(null, 'POST', '/auth/login', { email: u.email, password: pass })
const tB = login.token
assert.deepEqual(login.user.branches.map((b) => b.id), [B.id]); assert.equal(login.user.branchId, B.id)
assert.equal((await call(tB, 'GET', '/auth/me')).branchId, B.id)
const denied = await call(tB, 'GET', '/auth/me', undefined, 403, A.id)
assert.equal(denied.code, 'BRANCH_DENIED')
const me = await call(admin, 'GET', '/auth/me', undefined, undefined, A.id)
assert.equal(me.branchId, A.id); assert.ok(me.branches.length >= 3)
ok('usuário só com a Filial B: entra nela, não acessa a A (403); admin troca de filial pelo cabeçalho; padrão fora das liberadas é recusada')

// 2. Modo dos cadastros
const modes = await call(admin, 'GET', '/branch-modes')
assert.equal(modes.find((m) => m.table === 'bank_accounts').mode, 'E'); assert.equal(modes.find((m) => m.table === 'products').mode, 'C')
const busy = modes.find((m) => m.table === 'products' && m.rows > 0)
if (busy) assert.match((await call(admin, 'PUT', '/branch-modes/products', { mode: 'E' }, 400)).message, /cadastro vazio/)
await call(tB, 'PUT', '/branch-modes/products', { mode: 'E' }, 403)
ok('compartilhamento: contas bancárias exclusivas, produtos compartilhados; modo só muda com o cadastro vazio e só pelo admin')

// 3. Cadastro exclusivo: conta bancária da filial A não aparece na B; mesmo código pode existir nas duas
const code = 'BR' + run.slice(-4)
const accA = await call(admin, 'POST', '/catalog/bank-accounts', { code, name: 'Caixa A', kind: 'caixa' }, undefined, A.id)
const accB = await call(tB, 'POST', '/catalog/bank-accounts', { code, name: 'Caixa B', kind: 'caixa' })
assert.ok(!(await call(tB, 'GET', '/catalog/bank-accounts')).some((a) => a.id === accA.id), 'conta da A não aparece na B')
assert.ok((await call(admin, 'GET', '/catalog/bank-accounts', undefined, undefined, A.id)).some((a) => a.id === accA.id))
assert.ok(!(await call(tB, 'GET', '/catalog/bank-accounts/options')).some((o) => o.value === accA.id))
await call(tB, 'PATCH', `/catalog/bank-accounts/${accA.id}`, { name: 'invasão' }, 404)
await call(tB, 'POST', '/catalog/bank-accounts', { code, name: 'Repetida', kind: 'caixa' }, 409)
const bal = await call(tB, 'GET', '/finance/bank-balances')
assert.ok(bal.some((a) => a.id === accB.id) && !bal.some((a) => a.id === accA.id))
ok('cadastro exclusivo (contas bancárias): cada filial vê e altera só as suas; o mesmo código vale em filiais diferentes, repetido na mesma não')

// 4. Estoque por filial
const cad = await call(admin, 'POST', '/users', { name: 'Cad ' + run, email: `brc.${run}@t.com`.toLowerCase(), password: pass, permissions: ['cadastro'] })
const tCad = (await call(null, 'POST', '/auth/login', { email: cad.email, password: pass })).token
const prod = await call(tCad, 'POST', '/products', { sku: `BR-${run}`, name: 'Produto por filial', unit: 'UN', ncm: '84672100', costPrice: 10, salePrice: 50, stock: 10 }, undefined, A.id)
assert.equal(prod.stock, 10)
let inB = (await call(tB, 'GET', `/products?q=BR-${run}`))[0]
assert.equal(inB.stock, 0); assert.equal(inB.stockTotal, 10)
await call(tB, 'PATCH', `/products/${prod.id}`, { stock: 5 })
inB = (await call(tB, 'GET', `/products/${prod.id}`))
assert.equal(inB.stock, 5); assert.equal(inB.stockTotal, 15)
const byBranch = await call(admin, 'GET', `/stock/branches?productId=${prod.id}`)
assert.equal(byBranch.find((b) => b.companyId === A.id).quantity, 10); assert.equal(byBranch.find((b) => b.companyId === B.id).quantity, 5)
assert.deepEqual((await call(tB, 'GET', `/stock/branches?productId=${prod.id}`)).map((b) => b.companyId), [B.id], 'só as filiais liberadas')
ok('estoque por filial: 10 na A, 5 na B (ajuste pelo cadastro), total 15; cada filial vê o próprio saldo e o admin vê o de todas')

// 5. Documento na filial: pedido e nota da B baixam só o estoque da B
const terms = await call(admin, 'GET', '/catalog/payment-terms')
const vista = terms.find((t) => t.days === '0')
const cust = await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: cnpj(r12()), name: 'Cliente filial ' + run, uf: 'SP', taxpayer: '9', city: 'São Paulo', cityCode: '3550308', street: 'Rua A', number: '1', district: 'Centro' })
const price = await call(tB, 'GET', `/sales/price?productId=${prod.id}`)
assert.equal(price.stock, 5)
await call(tB, 'POST', '/sales-orders', { companyId: A.id, customerId: cust.id, paymentTermId: vista.id, items: [{ productId: prod.id, quantity: 1 }] }, 403)
const big = await call(tB, 'POST', '/sales-orders', { customerId: cust.id, paymentTermId: vista.id, items: [{ productId: prod.id, quantity: 7 }] })
assert.equal(big.companyId, B.id)
assert.ok(big.warnings.some((w) => /estoque 5 menor/.test(w)), JSON.stringify(big.warnings))
assert.match((await call(tB, 'POST', `/sales-orders/${big.id}/invoice`, undefined, 400)).message, /tem 5, pedido 7/)
await call(tB, 'POST', `/sales-orders/${big.id}/cancel`, { reason: 'teste' })
const order = await call(tB, 'POST', '/sales-orders', { customerId: cust.id, paymentTermId: vista.id, items: [{ productId: prod.id, quantity: 2 }] })
const nf = await call(tB, 'POST', `/sales-orders/${order.id}/invoice`)
const after = await call(admin, 'GET', `/stock/branches?productId=${prod.id}`)
assert.equal(after.find((b) => b.companyId === A.id).quantity, 10); assert.equal(after.find((b) => b.companyId === B.id).quantity, 3)
assert.equal((await call(admin, 'GET', `/products/${prod.id}`)).stockTotal, 13)
const movB = await call(tB, 'GET', `/stock/movements?productId=${prod.id}`)
assert.ok(movB.length >= 2 && movB.every((m) => m.companyCode === B.code), JSON.stringify(movB))
assert.ok((await call(admin, 'GET', `/stock/movements?productId=${prod.id}`, undefined, undefined, A.id)).every((m) => m.companyCode === A.code))
ok('venda na B: pedido fica na B, não vende na A sem liberação, confere o saldo da B (5) e a nota baixa só a B (3); a A continua com 10')

// 6. Listas por filial
assert.ok((await call(tB, 'GET', '/sales-orders')).some((o) => o.id === order.id))
assert.ok(!(await call(admin, 'GET', '/sales-orders', undefined, undefined, A.id)).some((o) => o.id === order.id))
assert.ok((await call(tB, 'GET', '/sales-invoices')).some((i) => i.id === nf.id))
assert.ok(!(await call(admin, 'GET', '/sales-invoices', undefined, undefined, A.id)).some((i) => i.id === nf.id))
const titlesB = await call(tB, 'GET', '/finance/titles?kind=R&status=todos')
assert.ok(titlesB.some((t) => t.salesInvoiceId === nf.id) && titlesB.every((t) => t.companyId === B.id))
assert.ok(!(await call(admin, 'GET', '/finance/titles?kind=R&status=todos', undefined, undefined, A.id)).some((t) => t.salesInvoiceId === nf.id))
ok('pedidos, notas e contas a receber aparecem só na filial que os fez')

// 7. Cancelar a nota devolve o estoque para a mesma filial
await call(tB, 'POST', `/sales-invoices/${nf.id}/cancel`, { reason: 'Cancelamento de teste de filial' })
assert.equal((await call(admin, 'GET', `/stock/branches?productId=${prod.id}`)).find((b) => b.companyId === B.id).quantity, 5)
ok('cancelamento devolve o estoque na filial da nota')

console.log(`\n${passed} verificações passaram`)
