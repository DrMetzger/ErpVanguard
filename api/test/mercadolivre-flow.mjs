// Mercado Livre contra uma API rodando e um "Mercado Livre" de mentira (HTTP local).
// A API precisa subir com MERCADOLIVRE_API_URL=http://127.0.0.1:3987 MERCADOLIVRE_AUTH_URL=http://127.0.0.1:3987/auth ML_SYNC=off
// Uso: API=http://127.0.0.1:3996/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/mercadolivre-flow.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const API = process.env.API ?? 'http://localhost:3000/api'
const PORT = Number(process.env.ML_MOCK_PORT ?? 3987)
const run = Date.now().toString(36).slice(-5).toUpperCase()
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect, headers = {}) {
  const res = await fetch(API + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 302) return { location: res.headers.get('location') }
  const text = await res.text()
  let data = null; try { data = JSON.parse(text) } catch { data = text }
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${text}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${text}`)
  return data
}
const cpf = () => { const b = String(Math.floor(Math.random() * 1e9)).padStart(9, '3'); const dv = (s, f) => { const r = s.split('').reduce((a, d, i) => a + d * (f - i), 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, 10); return b + d1 + dv(b + d1, 11) }

// ── Mercado Livre de mentira ──
const SELLER = 777000 + Math.floor(Math.random() * 1000)
// Códigos de anúncio únicos por execução (o banco de teste guarda os vínculos das anteriores)
const sfx = String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
const I1 = 'MLB1' + sfx, I2 = 'MLB2' + sfx, I3 = 'MLB3' + sfx
const calls = []
let access = 'APP_USR-1', refresh = 'TG-1', n = 1
const items = new Map([[I1, { id: I1, seller_id: SELLER, title: 'Furadeira no ML', status: 'active', price: 99, available_quantity: 3, permalink: 'https://produto.mercadolivre.com.br/MLB-111' }],
  [I2, { id: I2, seller_id: 1, title: 'De outro vendedor', status: 'active', price: 1, available_quantity: 1 }]])
const orders = new Map()
const buyerDoc = cpf()
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString()
  const url = new URL(req.url, 'http://x')
  const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  calls.push({ method: req.method, path: url.pathname, raw })
  if (url.pathname === '/oauth/token') {
    const f = new URLSearchParams(raw)
    if (f.get('client_secret') !== 'segredo-ml') return reply(400, { error: 'invalid_client', message: 'invalid client' })
    if (f.get('grant_type') === 'authorization_code' && f.get('code') !== 'CODE-OK') return reply(400, { error: 'invalid_grant', message: 'invalid code' })
    if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') !== refresh) return reply(400, { error: 'invalid_grant', message: 'refresh token used' })
    access = `APP_USR-${++n}`; refresh = `TG-${n}`
    return reply(200, { access_token: access, token_type: 'Bearer', expires_in: 21600, scope: 'offline_access read write', user_id: SELLER, refresh_token: refresh })
  }
  if (req.headers.authorization !== `Bearer ${access}`) return reply(401, { message: 'invalid access token', error: 'not_found', status: 401 })
  if (url.pathname === '/users/me') return reply(200, { id: SELLER, nickname: 'LOJAVANGUARD' })
  let m
  if ((m = url.pathname.match(/^\/items\/(MLB\d+)$/))) {
    const it = items.get(m[1]); if (!it) return reply(404, { message: 'item not found', error: 'not_found' })
    if (req.method === 'PUT') { Object.assign(it, JSON.parse(raw)); return reply(200, it) }
    return reply(200, it)
  }
  if (url.pathname === '/items' && req.method === 'POST') {
    const body = JSON.parse(raw)
    if (!body.attributes?.some((a) => a.id === 'BRAND')) return reply(400, { message: 'Validation error', error: 'validation_error', cause: [{ code: 'item.attribute.missing_required', message: 'The attributes [BRAND] are required for category MLB1000.' }] })
    const id = 'MLB9' + sfx + items.size; const it = { ...body, id, seller_id: SELLER, status: 'active', permalink: `https://produto.mercadolivre.com.br/${id}` }
    items.set(id, it); return reply(201, it)
  }
  if (url.pathname.match(/^\/items\/MLB\d+\/description$/)) return reply(201, { plain_text: 'ok' })
  if (url.pathname === '/pictures/items/upload') return reply(201, { id: 'PIC-1' })
  if (url.pathname === '/sites/MLB/domain_discovery/search') return reply(200, [{ domain_id: 'MLB-DRILLS', domain_name: 'Furadeiras', category_id: 'MLB1000', category_name: 'Furadeiras' }])
  if (url.pathname === '/categories/MLB1000/attributes') return reply(200, [{ id: 'BRAND', name: 'Marca', tags: { required: true } }, { id: 'MODEL', name: 'Modelo', tags: { catalog_required: true } }, { id: 'COLOR', name: 'Cor', tags: {} }])
  if ((m = url.pathname.match(/^\/orders\/(\d+)\/billing_info$/))) return reply(200, { billing_info: { doc_type: 'CPF', doc_number: buyerDoc, additional_info: [{ type: 'FIRST_NAME', value: 'Maria' }, { type: 'LAST_NAME', value: 'Compradora' }, { type: 'STATE_CODE', value: 'BR-SP' }, { type: 'CITY_NAME', value: 'São Paulo' }, { type: 'ZIP_CODE', value: '01310-100' }, { type: 'STREET_NAME', value: 'Av. Paulista' }, { type: 'STREET_NUMBER', value: '1000' }] } })
  if ((m = url.pathname.match(/^\/orders\/(\d+)$/))) { const o = orders.get(m[1]); return o ? reply(200, o) : reply(404, { message: 'order not found' }) }
  if (url.pathname === '/orders/search') return reply(200, { results: [...orders.values()].filter((o) => o.status === 'paid'), paging: { total: orders.size } })
  reply(404, { message: `rota falsa ${req.method} ${url.pathname}` })
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const order = (id, itemId, qty, price, status = 'paid') => orders.set(String(id), { id, status, date_created: new Date().toISOString(), total_amount: qty * price, buyer: { id: 55, nickname: 'MARIACOMPRA' }, order_items: [{ item: { id: itemId, title: 'Item ' + itemId, seller_sku: null }, quantity: qty, unit_price: price }] })

console.log('Mercado Livre')
try {
  const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
  const pass = 'Senha-forte-123'
  const vend = await call(admin, 'POST', '/users', { name: 'Vend ML ' + run, email: `ml.${run}@t.com`.toLowerCase(), password: pass, permissions: ['vendedor'] })
  const tVend = (await call(null, 'POST', '/auth/login', { email: vend.email, password: pass })).token
  const me = await call(admin, 'GET', '/auth/me')
  const branch = me.branchId
  const terms = await call(admin, 'GET', '/catalog/payment-terms')
  const vista = terms.find((t) => t.days === '0')

  // 1. Conectar conta (OAuth)
  await call(admin, 'PUT', '/integrations/mercadolivre', { enabled: false, config: { clientId: '', companyId: '' }, secrets: { clientSecret: '', accessToken: '', refreshToken: '' } })
  assert.match((await call(admin, 'POST', '/integrations/mercadolivre/authorize', {}, 400)).message, /Client ID/)
  await call(admin, 'PUT', '/integrations/mercadolivre', { enabled: true, config: { clientId: '123456', companyId: branch, paymentTermId: vista.id }, secrets: { clientSecret: 'segredo-ml' } })
  const auth = await call(admin, 'POST', '/integrations/mercadolivre/authorize', {})
  const authUrl = new URL(auth.url)
  assert.equal(authUrl.origin + authUrl.pathname, `http://127.0.0.1:${PORT}/auth/authorization`); assert.equal(authUrl.searchParams.get('client_id'), '123456')
  assert.match(auth.redirectUri, /\/api\/integrations\/mercadolivre\/callback$/)
  const state = authUrl.searchParams.get('state')
  let back = await call(null, 'GET', `/integrations/mercadolivre/callback?code=CODE-OK&state=errado`)
  assert.match(decodeURIComponent(back.location), /ml=erro.*expirada ou inválida/)
  back = await call(null, 'GET', `/integrations/mercadolivre/callback?code=CODE-RUIM&state=${state}`)
  assert.match(decodeURIComponent(back.location), /ml=erro.*código de autorização inválido/)
  const auth2 = await call(admin, 'POST', '/integrations/mercadolivre/authorize', {})
  back = await call(null, 'GET', `/integrations/mercadolivre/callback?code=CODE-OK&state=${new URL(auth2.url).searchParams.get('state')}`)
  assert.equal(back.location, '/integracoes?ml=ok&conta=LOJAVANGUARD')
  const it = (await call(admin, 'GET', '/integrations')).find((i) => i.provider === 'mercadolivre')
  assert.equal(it.status, 'conectado'); assert.equal(it.config.nickname, 'LOJAVANGUARD'); assert.equal(it.config.sellerId, String(SELLER)); assert.equal(it.secrets.accessToken.set, true)
  ok('conectar conta: link de autorização com o Client ID, volta com o código, estado inválido e código errado explicados; conta LOJAVANGUARD conectada')

  // 2. Renova o acesso quando vence (refresh token troca a cada vez)
  await call(admin, 'PUT', '/integrations/mercadolivre', { config: { tokenExpiresAt: '1' } })
  const before = calls.filter((c) => c.path === '/oauth/token').length
  const cats = await call(admin, 'GET', '/marketplace/mercadolivre/categories?q=furadeira')
  assert.equal(cats[0].categoryId, 'MLB1000')
  assert.equal(calls.filter((c) => c.path === '/oauth/token').length, before + 1, 'renovou uma vez')
  await call(admin, 'GET', '/marketplace/mercadolivre/categories?q=furadeira')
  assert.equal(calls.filter((c) => c.path === '/oauth/token').length, before + 1, 'não renova de novo enquanto vale')
  ok('acesso vencido é renovado sozinho antes da chamada (e só uma vez)')

  // 3. Vincular anúncio existente e sincronizar preço/estoque da filial
  const prod = await call(admin, 'POST', '/products', { sku: `ML-${run}`, name: 'Furadeira 500W', unit: 'UN', ncm: '84672100', barcode: '7891000315507', salePrice: 189.9, stock: 7 })
  await call(tVend, 'POST', '/marketplace/mercadolivre/link', { productId: prod.id, itemId: I1 }, 403)
  assert.match((await call(admin, 'POST', '/marketplace/mercadolivre/link', { productId: prod.id, itemId: I2 }, 400)).message, /não é da conta/)
  assert.match((await call(admin, 'POST', '/marketplace/mercadolivre/link', { productId: prod.id, itemId: 'XYZ12345' }, 400)).message, /inválido/)
  const linked = await call(admin, 'POST', '/marketplace/mercadolivre/link', { productId: prod.id, itemId: I1.toLowerCase().replace('mlb', 'mlb-') })
  assert.equal(linked.externalId, I1); assert.equal(linked.quantity, 7); assert.equal(linked.price, 189.9)
  assert.deepEqual(JSON.parse(calls.filter((c) => c.method === 'PUT' && c.path === `/items/${I1}`).at(-1).raw), { price: 189.9, available_quantity: 7 })
  await call(admin, 'POST', '/marketplace/mercadolivre/link', { productId: prod.id, itemId: I1 }, 400)
  await call(admin, 'PATCH', `/products/${prod.id}`, { stock: 4 })
  const s = await call(admin, 'POST', '/marketplace/mercadolivre/sync', {})
  assert.ok(s.listings >= 1)
  assert.equal(items.get(I1).available_quantity, 4)
  ok('vincular MLB111 ao produto (outro vendedor, código inválido e duplicado recusados); preço R$ 189,90 e saldo da filial (7 → 4) enviados')

  // 4. Publicar anúncio novo: categoria sugerida, atributos obrigatórios, GTIN e SKU automáticos
  const prod2 = await call(admin, 'POST', '/products', { sku: `ML2-${run}`, name: 'Parafusadeira 12V com maleta', unit: 'UN', ncm: '84672100', barcode: '7891000315507', salePrice: 249, stock: 3 })
  const attrs = await call(admin, 'GET', '/marketplace/mercadolivre/categories/MLB1000/attributes')
  assert.deepEqual(attrs.map((a) => a.id), ['BRAND', 'MODEL'])
  assert.match((await call(admin, 'POST', '/marketplace/mercadolivre/publish', { productId: prod2.id, categoryId: 'MLB1000' }, 400)).message, /BRAND/)
  const pub = await call(admin, 'POST', '/marketplace/mercadolivre/publish', { productId: prod2.id, categoryId: 'MLB1000', attributes: [{ id: 'BRAND', value: 'Vanguard' }, { id: 'MODEL', value: 'PV12' }] })
  const posted = JSON.parse(calls.filter((c) => c.method === 'POST' && c.path === '/items').at(-1).raw)
  assert.equal(posted.title, 'Parafusadeira 12V com maleta'); assert.equal(posted.price, 249); assert.equal(posted.available_quantity, 3); assert.equal(posted.listing_type_id, 'gold_special')
  assert.ok(posted.attributes.some((a) => a.id === 'GTIN' && a.value_name === '7891000315507') && posted.attributes.some((a) => a.id === 'SELLER_SKU' && a.value_name === `ML2-${run}`))
  assert.match(pub.externalId, /^MLB\d+$/)
  ok(`publicar: atributo obrigatório faltando volta a mensagem do ML; com marca e modelo vira o anúncio ${pub.externalId} (GTIN e SKU automáticos, saldo 3, R$ 249)`)

  // 5. Venda paga → pedido de venda (aviso do ML), sem duplicar
  const oid = 2000000000 + Math.floor(Math.random() * 1e6)
  order(oid, I1, 2, 179.9)
  await call(null, 'POST', '/webhooks/mercadolivre', { resource: `/orders/${oid}`, user_id: 999, topic: 'orders_v2', application_id: 123456 })
  await call(null, 'POST', '/webhooks/mercadolivre', { resource: `/orders/${oid}`, user_id: SELLER, topic: 'orders_v2', application_id: 999 })
  await call(admin, 'POST', '/marketplace/mercadolivre/idle')
  assert.ok(!(await call(admin, 'GET', '/marketplace/mercadolivre/orders')).some((o) => o.externalId === String(oid)), 'aviso de outra conta/app é ignorado')
  // avisos repetidos ao mesmo tempo
  await Promise.all([1, 2, 3].map(() => call(null, 'POST', '/webhooks/mercadolivre', { resource: `/orders/${oid}`, user_id: SELLER, topic: 'orders_v2', application_id: 123456 })))
  await call(admin, 'POST', '/marketplace/mercadolivre/idle')
  const mo = (await call(admin, 'GET', '/marketplace/mercadolivre/orders')).filter((o) => o.externalId === String(oid))
  assert.equal(mo.length, 1); assert.equal(mo[0].status, 'importado', mo[0].error); assert.equal(mo[0].buyer, 'MARIACOMPRA')
  assert.equal((await call(admin, 'GET', '/sales-orders?status=todos')).filter((o) => o.customerName === 'Maria Compradora' && o.total === 359.8).length >= 1, true)
  const so = await call(admin, 'GET', `/sales-orders/${mo[0].salesOrderId}`)
  assert.equal(so.companyId, branch); assert.equal(so.items[0].productId, prod.id); assert.equal(so.items[0].quantity, 2); assert.equal(so.items[0].unitPrice, 179.9)
  assert.equal(so.customerDocument, buyerDoc); assert.equal(so.customerName, 'Maria Compradora'); assert.match(so.notes, new RegExp(`Venda Mercado Livre ${oid}`))
  const cust = (await call(admin, 'GET', `/catalog/customers?q=${buyerDoc}`))[0]
  assert.equal(cust.uf, 'SP'); assert.equal(cust.cityCode, '3550308'); assert.equal(cust.zip, '01310100')
  ok(`venda ${oid} paga → pedido na filial da integração com o preço do ML; cliente cadastrado pelo CPF com cidade IBGE; aviso repetido não duplica`)

  // 6. Item não vinculado: fica com erro e é reprocessado depois de vincular
  const oid2 = oid + 1
  order(oid2, I3, 1, 50)
  items.set(I3, { id: I3, seller_id: SELLER, title: 'Sem vínculo', status: 'active', price: 50, available_quantity: 1 })
  const imp = await call(admin, 'POST', '/marketplace/mercadolivre/orders/import', {})
  assert.ok(imp.found >= 2)
  let o2 = (await call(admin, 'GET', '/marketplace/mercadolivre/orders')).find((o) => o.externalId === String(oid2))
  assert.equal(o2.status, 'erro'); assert.match(o2.error, new RegExp(`${I3}.*não está vinculado`))
  const prod3 = await call(admin, 'POST', '/products', { sku: `ML3-${run}`, name: 'Broca avulsa', unit: 'UN', ncm: '82075011', salePrice: 50, stock: 5 })
  await call(admin, 'POST', '/marketplace/mercadolivre/link', { productId: prod3.id, itemId: I3 })
  await call(tVend, 'POST', `/marketplace/mercadolivre/orders/${oid2}/retry`, {}, 403)
  assert.equal((await call(admin, 'POST', `/marketplace/mercadolivre/orders/${oid2}/retry`, {})).result, 'criado')
  o2 = (await call(admin, 'GET', '/marketplace/mercadolivre/orders')).find((o) => o.externalId === String(oid2))
  assert.equal(o2.status, 'importado'); assert.ok(o2.orderNumber)
  assert.equal((await call(admin, 'POST', '/marketplace/mercadolivre/orders/import', {})).created, 0, 'buscar de novo não duplica')
  ok('venda com anúncio não vinculado fica com erro explicado; depois de vincular, "reprocessar" cria o pedido; buscar de novo não duplica')

  // 7. Venda ainda não paga não vira pedido; desconectar limpa o acesso
  const oid3 = oid + 2
  order(oid3, I1, 1, 10, 'payment_required')
  await call(null, 'POST', '/webhooks/mercadolivre', { resource: `/orders/${oid3}`, user_id: SELLER, topic: 'orders_v2', application_id: 123456 })
  await call(admin, 'POST', '/marketplace/mercadolivre/idle')
  assert.equal((await call(admin, 'GET', '/marketplace/mercadolivre/orders')).find((o) => o.externalId === String(oid3)).status, 'aguardando')
  await call(admin, 'POST', '/integrations/mercadolivre/disconnect', {})
  const after = (await call(admin, 'GET', '/integrations')).find((i) => i.provider === 'mercadolivre')
  assert.equal(after.secrets.accessToken.set, false); assert.equal(after.status, 'desconectado')
  assert.match((await call(admin, 'GET', '/marketplace/mercadolivre/categories?q=x', undefined, 400)).message, /Conecte a conta/)
  ok('venda aguardando pagamento não vira pedido; desconectar apaga o acesso e as telas pedem para conectar de novo')
  await call(admin, 'PUT', '/integrations/mercadolivre', { enabled: false })
} finally {
  server.close()
}
console.log(`\n${passed} verificações passaram`)
