// Teste de ponta a ponta de Cadastros, Fiscal, Configurações e avatar contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/catalog-flow.mjs
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

console.log('Cadastros, Fiscal e Configurações')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const cad = await call(admin, 'POST', '/users', { name: 'Cadastro ' + run, email: `cad.${run}@t.com`.toLowerCase(), password: pass, permissions: ['cadastro'] })
const sol = await call(admin, 'POST', '/users', { name: 'Sol ' + run, email: `sol.${run}@t.com`.toLowerCase(), password: pass, permissions: ['solicitante'] })
const tCad = (await call(null, 'POST', '/auth/login', { email: cad.email, password: pass })).token
const tSol = (await call(null, 'POST', '/auth/login', { email: sol.email, password: pass })).token

const meta = await call(tSol, 'GET', '/catalog/meta')
assert.ok(meta.find((m) => m.name === 'tes').fields.some((f) => f.key === 'cfopInternal'))
assert.ok(!JSON.stringify(meta).includes('"table"'), 'meta não deve expor nomes de tabela')
ok(`meta com ${meta.length} cadastros (sem expor tabelas do banco)`)

const units = await call(tSol, 'GET', '/catalog/units')
assert.ok(units.some((u) => u.code === 'KG' && u.decimals === 3))
const types = await call(tSol, 'GET', '/catalog/product-types')
assert.equal(types.find((t) => t.code === '00').description, 'Mercadoria para revenda')
const cfops = await call(tSol, 'GET', '/catalog/cfop?q=5102')
assert.equal(cfops[0].code, '5102')
ok(`carga inicial: ${units.length} unidades, ${types.length} tipos SPED, CFOPs e TES`)

await call(tSol, 'POST', '/catalog/product-groups', { code: 'X' + run, name: 'x' }, 403)
const group = await call(tCad, 'POST', '/catalog/product-groups', { code: ' ferr' + run.toLowerCase(), name: 'Ferragens' })
assert.equal(group.code, ('FERR' + run).toUpperCase())
await call(tCad, 'POST', '/catalog/product-groups', { code: 'ferr' + run, name: 'Dup' }, 409)
await call(tCad, 'POST', '/catalog/product-groups', { name: 'Sem código' }, 400)
await call(tCad, 'POST', '/catalog/product-groups', { code: 'A', name: 'x', hack: 1 }, 400)
ok('grupo criado (código em maiúsculas); duplicado, obrigatório e campo estranho recusados; solicitante não edita')

await call(tCad, 'POST', '/catalog/ncm', { code: '123', description: 'x' }, 400)
const ncm = await call(tCad, 'POST', '/catalog/ncm', { code: '73' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), description: 'Parafusos', ipiRate: 5.5 })
assert.equal(ncm.ipiRate, 5.5)
ok('NCM validado (8 dígitos) com alíquota de IPI')

await call(tCad, 'POST', '/catalog/customers', { document: '11111111111', name: 'x' }, 400)
const cust = await call(tCad, 'POST', '/catalog/customers', { document: cnpj(String(Date.now()).slice(-12)), name: 'Cliente RJ', taxpayer: '1', uf: 'rj', zip: '20040002' })
assert.equal(cust.uf, 'RJ')
await call(tCad, 'PATCH', `/catalog/customers/${cust.id}`, { uf: 'XX' }, 400)
ok('cliente com CPF/CNPJ validado e UF')

const type00 = types.find((t) => t.code === '00')
const prod = await call(tCad, 'POST', '/products', { sku: 'PRD-' + run, name: 'Parafuso teste', unit: 'UN', typeId: type00.id, groupId: group.id, origin: 0, ncm: ncm.code, costPrice: 1.5 })
const listed = (await call(tSol, 'GET', `/products?q=PRD-${run}`))[0]
assert.equal(listed.groupLabel, `${group.code} · Ferragens`)
ok('produto ligado a tipo e grupo')

const pt = await call(tCad, 'POST', '/catalog/price-tables', { code: 'VAR' + run.slice(0, 3), name: 'Varejo', validFrom: '2026-01-01' })
await call(tCad, 'PUT', `/catalog/price-tables/${pt.id}/items`, { items: [{ productId: prod.id, price: 3.9 }] })
const items = await call(tSol, 'GET', `/catalog/price-tables/${pt.id}/items`)
assert.equal(items[0].price, 3.9)
await call(tCad, 'DELETE', `/catalog/product-groups/${group.id}`, undefined, 409)
ok('tabela de preço com itens; excluir grupo em uso é bloqueado')

const sup = await call(admin, 'POST', '/suppliers', { cnpj: cnpj(String(Date.now() + 7).slice(-12)), name: 'Forn ' + run })
const sp = await call(tCad, 'POST', '/catalog/supplier-products', { supplierId: sup.id, supplierCode: 'ABC-1', productId: prod.id })
assert.equal(sp.productIdLabel, `PRD-${run} · Parafuso teste`)
ok('amarração produto × fornecedor com nomes resolvidos')

// Fiscal
const fis = await call(admin, 'POST', '/users', { name: 'Fiscal ' + run, email: `fis.${run}@t.com`.toLowerCase(), password: pass, permissions: ['fiscal'] })
const tFis = (await call(null, 'POST', '/auth/login', { email: fis.email, password: pass })).token
await call(tFis, 'POST', '/catalog/tes', { code: '600', kind: 'E', description: 'x', cfopInternal: '1102' }, 400)
await call(tFis, 'POST', '/catalog/tes', { code: '601', kind: 'S', description: 'x', cfopInternal: '1102' }, 400)
const opVenda = (await call(tFis, 'GET', '/catalog/operation-types')).find((o) => o.code === 'S01')
const tesAll = await call(tFis, 'GET', '/catalog/tes')
const tes501 = tesAll.find((t) => t.code === '501')
const tesSt = await call(tFis, 'POST', '/catalog/tes', { code: String(700 + Math.floor(Math.random() * 299)), kind: 'S', description: 'Venda ST ' + run, cfopInternal: '5405', cfopInterstate: '6404', icmsCst: '60' })
await call(tFis, 'POST', '/catalog/fiscal-matrix', { operationTypeId: opVenda.id, tesId: tes501.id, notes: 'Venda padrão ' + run })
await call(tFis, 'POST', '/catalog/fiscal-matrix', { operationTypeId: opVenda.id, tesId: tesSt.id, productGroupId: group.id, ncmPrefix: ncm.code.slice(0, 4), notes: 'Ferragens com ST ' + run })
ok('TES validada (faixa de código e CFOP de entrada/saída) e regras da matriz criadas')

await call(admin, 'PUT', '/settings/company', { name: 'Empresa Teste', cnpj: '', uf: 'SP' })
let r = await call(tFis, 'POST', '/fiscal/resolve', { operationTypeId: opVenda.id, uf: 'SP', taxpayer: '1' })
assert.equal(r.tes.code, '501'); assert.equal(r.cfop, '5102'); assert.equal(r.interstate, false)
r = await call(tFis, 'POST', '/fiscal/resolve', { operationTypeId: opVenda.id, uf: 'RJ', taxpayer: '1', productId: prod.id })
assert.equal(r.tes.code, tesSt.code); assert.equal(r.cfop, '6404'); assert.equal(r.interstate, true)
ok(`matriz: venda em SP → TES 501/CFOP 5102; ferragem para RJ → TES ${tesSt.code}/CFOP 6404 (regra mais específica)`)

// Configurações
await call(tCad, 'GET', '/settings', undefined, 403)
const s1 = await call(admin, 'PUT', '/settings/gemini', { apiKey: 'AIzaChaveDeTesteQueNaoExiste1234', model: 'gemini-3.8-flash', fallbackModels: ['gemini-3.5-flash'] })
assert.equal(s1.gemini.configured, true); assert.equal(s1.gemini.source, 'tela'); assert.equal(s1.gemini.apiKeyHint, '••••1234')
assert.ok(!JSON.stringify(s1).includes('AIzaChave'), 'a chave nunca volta inteira')
await call(admin, 'PUT', '/settings/gemini', { model: 'modelo inválido!' }, 400)
const s2 = await call(admin, 'PUT', '/settings/nfe', { autoAi: true })
assert.equal(s2.nfe.autoAi, true)
const s3 = await call(admin, 'PUT', '/settings/gemini', { clearApiKey: true })
assert.notEqual(s3.gemini.source, 'tela')
await call(admin, 'PUT', '/settings/nfe', { autoAi: false })
ok('configurações: chave salva criptografada e mascarada, removível; IA automática liga e desliga')

// Avatar
const me = await call(tSol, 'PATCH', '/auth/me', { avatar: 'notionists:joao-1' })
assert.equal(me.avatar, 'notionists:joao-1')
await call(tSol, 'PATCH', '/auth/me', { avatar: '<script>' }, 400)
assert.equal((await call(tSol, 'PATCH', '/auth/me', { avatar: null })).avatar, null)
ok('avatar escolhido pelo próprio usuário (formato validado)')

console.log(`\n${passed} verificações passaram`)
