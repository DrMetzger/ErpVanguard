// Reforma tributária contra uma API rodando: tabela cClassTrib (cadastro + importação do CSV oficial) e IBS/CBS na venda.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... CCLASSTRIB_CSV=/caminho/cClassTrib.csv node test/ibs-cbs-flow.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
const b64 = (buf) => Buffer.from(buf).toString('base64')

console.log('IBS/CBS e tabela cClassTrib')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const cad = await call(admin, 'POST', '/users', { name: 'Cad ' + run, email: `cadibs.${run}@t.com`.toLowerCase(), password: pass, permissions: ['cadastro'] })
const tCad = (await call(null, 'POST', '/auth/login', { email: cad.email, password: pass })).token

// Carga inicial: tabela oficial de 22/06/2026
const info = await call(admin, 'GET', '/catalog/class-trib/official')
assert.ok(info.total >= 164, JSON.stringify(info))
const list = await call(admin, 'GET', '/catalog/class-trib?q=200034')
assert.equal(list[0].cst, '200'); assert.equal(Number(list[0].pRedIbs), 60); assert.equal(list[0].aliquotType, 'Padrão')
const opts = await call(admin, 'GET', '/catalog/class-trib/options?q=000001')
assert.match(opts[0].label, /^000001 · /)
ok(`carga inicial com ${info.total} classificações (versão ${info.sourceDate}); 200034 = CST 200, redução 60%`)

// Importação do CSV oficial (Windows-1252, ";"): conferir não grava; alteração e código novo aparecem
const csv = readFileSync(process.env.CCLASSTRIB_CSV)
let r = await call(admin, 'POST', '/catalog/class-trib/official/import', { file: b64(csv) })
assert.equal(r.committed, false); assert.equal(r.total, 164); assert.deepEqual(r.errors, []); assert.equal(r.sourceDate, '2026-06-22')
const text = new TextDecoder('windows-1252').decode(csv)
const lines = text.split(/\r?\n/)
const i200034 = lines.findIndex((l) => l.startsWith('200;') && l.includes(';200034;'))
assert.ok(i200034 > 0)
const edited = [...lines]
edited[i200034] = edited[i200034].replace(/;Padrão;60;60;/, ';Padrão;50;50;')
const code = '9' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0')
edited.splice(2, 0, `000;Tributação integral;${code};Teste ${run} ção;Linha de teste;;;;;Padrão;0;0;0;0;0;0;0;0;0;0;1;01/01/2026;;22/06/2026;0;1;1;1;1;1;1;0;1;1;0;1;1;1;0;1;1;;`)
const utf8 = Buffer.from(edited.join('\r\n'), 'utf8') // salvo de novo em UTF-8 também é aceito
r = await call(admin, 'POST', '/catalog/class-trib/official/import', { file: b64(utf8) })
assert.equal(r.create, 1); assert.equal(r.update, 1, JSON.stringify(r.rows)); assert.deepEqual(r.rows.find((x) => x.code === '200034').changes, ['redução 60/60% → 50/50%'])
assert.equal(Number((await call(admin, 'GET', '/catalog/class-trib?q=200034'))[0].pRedIbs), 60, 'conferir não grava')
r = await call(admin, 'POST', '/catalog/class-trib/official/import', { file: b64(utf8), commit: true })
assert.equal(r.committed, true)
assert.equal(Number((await call(admin, 'GET', '/catalog/class-trib?q=200034'))[0].pRedIbs), 50)
const mine = (await call(admin, 'GET', `/catalog/class-trib?q=${code}`))[0]
assert.equal(mine.name, `Teste ${run} ção`)
r = await call(admin, 'POST', '/catalog/class-trib/official/import', { file: b64(csv), commit: true })
assert.equal(r.update, 1); assert.ok(r.missing.includes(code), 'código fora do arquivo é avisado e não é apagado')
assert.equal(Number((await call(admin, 'GET', '/catalog/class-trib?q=200034'))[0].pRedIbs), 60)
await call(admin, 'DELETE', `/catalog/class-trib/${mine.id}`)
ok('CSV oficial (Windows-1252 ou UTF-8): conferência mostra o que muda, gravar atualiza pelo código, nada é apagado')

const broken = await call(admin, 'POST', '/catalog/class-trib/official/import', { file: b64('a;b;c\n1;2;3') }, 400)
assert.match(broken.message, /cClassTrib oficial/)
await call(tCad, 'POST', '/catalog/class-trib/official/import', { file: b64(csv) }, 403)
await call(tCad, 'POST', '/catalog/class-trib', { code: '999998', cst: '000', name: 'x' }, 403)
ok('arquivo que não é a tabela oficial é recusado; só o fiscal/admin altera a tabela')

// IBS/CBS no cálculo: TES de venda (000001) e exceção no produto (200034)
const ops = await call(admin, 'GET', '/catalog/operation-types')
const s01 = ops.find((o) => o.code === 'S01')
const prod = await call(tCad, 'POST', '/products', { sku: `IBS-${run}`, name: 'Produto IBS/CBS', unit: 'UN', ncm: '84672100', salePrice: 100 })
const params = Object.fromEntries((await call(admin, 'GET', '/parameters')).map((p) => [p.key, p.value]))
assert.equal(params.MV_IBSCBS, true); assert.equal(params.MV_CBSALQ, 0.9); assert.equal(params.MV_IBSUFALQ, 0.1)
const companies = await call(admin, 'GET', '/catalog/companies')
const company = companies.find((c) => c.active && ['presumido', 'real'].includes(c.taxRegime))
if (company) {
  let sim = await call(admin, 'POST', '/fiscal/resolve', { operationTypeId: s01.id, companyId: company.id, uf: company.uf, taxpayer: '1', productId: prod.id, amount: 1000 })
  assert.equal(sim.taxes.ibsCbs.classTrib, '000001'); assert.equal(sim.taxes.ibsCbs.cbs.rate, 0.9); assert.ok(sim.taxes.ibsCbs.base < 1000 && sim.taxes.ibsCbs.base > 0)
  assert.equal(sim.totals.total, 1000, 'IBS/CBS fora do total em 2026')
  const ct = (await call(admin, 'GET', '/catalog/class-trib/options?q=200034'))[0]
  await call(tCad, 'PATCH', `/products/${prod.id}`, { classTribId: ct.value })
  assert.equal((await call(admin, 'GET', `/products/${prod.id}`)).classTribId, ct.value)
  sim = await call(admin, 'POST', '/fiscal/resolve', { operationTypeId: s01.id, companyId: company.id, uf: company.uf, taxpayer: '1', productId: prod.id, amount: 1000 })
  assert.equal(sim.taxes.ibsCbs.classTrib, '200034'); assert.equal(sim.taxes.ibsCbs.cbs.effective, 0.36)
  ok(`simulação: TES traz 000001 (CBS 0,9% / IBS 0,1%), produto com 200034 reduz 60%; total da nota não muda (${company.code})`)
} else console.log('  - sem empresa do regime normal: simulação pulada')
await call(tCad, 'PATCH', `/products/${prod.id}`, { classTribId: '00000000-0000-0000-0000-000000000000' }, 409)
await call(admin, 'DELETE', `/products/${prod.id}`)
ok('classificação inexistente no produto é recusada')

console.log(`\n${passed} verificações passaram`)
