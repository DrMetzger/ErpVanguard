// App do celular: aparelho, localização (inclusive pontos guardados offline) e gravação sem repetição.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/devices-flow.mjs
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36).slice(-5).toUpperCase()
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect, headers = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}

console.log('App do celular: aparelhos, localização e envio sem repetição')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const u = await call(admin, 'POST', '/users', { name: 'Vendedor Rua ' + run, email: `rua.${run}@t.com`.toLowerCase(), password: pass, permissions: ['cadastro'] })
const tU = (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token

const deviceId = 'teste-' + run.toLowerCase() + '-aparelho'
const t0 = Date.now() - 30 * 60_000
const pts = [0, 1, 2].map((i) => ({ lat: -20.8113 + i * 0.001, lng: -49.3758 - i * 0.001, accuracy: 12, at: new Date(t0 + i * 60_000).toISOString() }))
let r = await call(tU, 'POST', '/devices/heartbeat', { deviceId, platform: 'android', model: 'Samsung A54', osVersion: '15', appVersion: '1.0.9', battery: 0.8, online: true, locations: pts })
assert.equal(r.saved, 3)
r = await call(tU, 'POST', '/devices/heartbeat', { deviceId, locations: pts.slice(1) }) // reenvio (fila offline) não duplica
await call(tU, 'POST', '/devices/heartbeat', { deviceId, locations: [{ lat: 200, lng: 0, at: new Date().toISOString() }] }, 400)
await call(tU, 'GET', '/devices', undefined, 403)
const list = await call(admin, 'GET', '/devices')
const d = list.find((x) => x.id === deviceId)
assert.equal(d.userName, 'Vendedor Rua ' + run); assert.equal(d.model, 'Samsung A54'); assert.equal(d.lat, pts[2].lat); assert.equal(d.battery, 0.8)
const day = new Date(t0).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const track = await call(admin, 'GET', `/devices/${deviceId}/locations?date=${day}`)
assert.equal(track.length, 3, 'pontos repetidos não duplicam'); assert.ok(track[0].at < track[2].at)
ok('aparelho registrado com modelo, bateria e última posição; trajeto do dia; ponto repetido não duplica; só admin vê o mapa')

// Idempotency-Key: a mesma gravação reenviada não cria duas vezes
const key = 'chave-' + run + '-0001'
const body = { code: 'I' + run.slice(-4), description: 'Unidade idempotente ' + run }
const a = await call(tU, 'POST', '/catalog/units', body, undefined, { 'Idempotency-Key': key })
const b = await fetch(API + '/catalog/units', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tU}`, 'Idempotency-Key': key }, body: JSON.stringify(body) })
assert.ok(b.ok, String(b.status)); assert.equal(b.headers.get('idempotent-replay'), 'true')
assert.equal((await b.json()).id, a.id, 'devolve o mesmo registro')
const units = await call(tU, 'GET', `/catalog/units?q=${body.code}`)
assert.equal(units.length, 1, 'gravou uma vez só')
// Erro de validação também é lembrado; chave de outro usuário não interfere
const bad = { code: '', description: 'x' }
await call(tU, 'POST', '/catalog/units', bad, 400, { 'Idempotency-Key': key + 'b' })
await call(tU, 'POST', '/catalog/units', bad, 400, { 'Idempotency-Key': key + 'b' })
await call(admin, 'POST', '/catalog/units', { code: 'J' + run.slice(-4), description: 'Outra ' + run }, undefined, { 'Idempotency-Key': key })
ok('mesma gravação reenviada (fila do celular) devolve a primeira resposta sem gravar de novo; chave é por usuário')

// Bloqueio do aparelho
const H = { 'X-Device-Id': deviceId }
await call(tU, 'POST', `/devices/${deviceId}/block`, { reason: 'x' }, 403)
await call(admin, 'POST', `/devices/${deviceId}/block`, { reason: 'Celular perdido' })
let blocked = await fetch(API + '/catalog/units', { headers: { Authorization: `Bearer ${tU}`, ...H } })
assert.equal(blocked.status, 403); const bj = await blocked.json(); assert.equal(bj.code, 'DEVICE_BLOCKED'); assert.match(bj.message, /Celular perdido/)
const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ email: u.email, password: pass }) })
assert.equal(login.status, 403, 'não entra de novo pelo aparelho bloqueado')
await call(tU, 'POST', '/devices/heartbeat', { deviceId, locations: [] }, 403, H)
await call(tU, 'GET', '/catalog/units') // o mesmo usuário no computador continua
assert.equal((await call(admin, 'GET', '/devices')).find((x) => x.id === deviceId).blocked, true)
await call(admin, 'POST', `/devices/${deviceId}/unblock`)
await call(tU, 'GET', '/catalog/units', undefined, undefined, H)
await call(admin, 'POST', '/devices/nao-existe-123/block', {}, 404)
ok('aparelho bloqueado: nada passa (nem login), mensagem com o motivo; computador segue; desbloquear libera; só admin bloqueia')

// Sincronização: primeira vez tudo (em páginas), depois só o que mudou, inclusive exclusões
let page = await call(tU, 'GET', '/catalog/units/sync?limit=100')
let lastAt = page.rows.at(-1)?._at
while (page.next) { page = await call(tU, 'GET', `/catalog/units/sync?limit=100&since=${encodeURIComponent(page.next.since)}&after=${encodeURIComponent(page.next.after)}`); lastAt = page.rows.at(-1)?._at ?? lastAt }
const cursor = { since: lastAt }
const unit = await call(admin, 'POST', '/catalog/units', { code: 'S' + run.slice(-4), description: 'Sincronizada ' + run })
let delta = await call(tU, 'GET', `/catalog/units/sync?since=${encodeURIComponent(cursor.since)}`)
assert.ok(delta.rows.some((r) => r.id === unit.id && r._label.includes('Sincronizada')), 'nova aparece')
const totalUnits = (await call(tU, 'GET', '/catalog/units')).length
assert.ok(delta.rows.length < totalUnits, `só o que mudou (${delta.rows.length} de ${totalUnits})`)
await call(admin, 'PATCH', `/catalog/units/${unit.id}`, { description: 'Alterada ' + run })
await call(admin, 'DELETE', `/catalog/units/${unit.id}`, undefined, 204)
delta = await call(tU, 'GET', `/catalog/units/sync?since=${encodeURIComponent(cursor.since)}`)
assert.ok(delta.deleted.includes(unit.id), 'exclusão chega ao celular')
await call(admin, 'POST', '/products', { sku: 'SY-' + run, name: 'Produto sincronizado ' + run, unit: 'UN' })
const prods = await call(tU, 'GET', `/catalog/products/sync?since=${encodeURIComponent(cursor.since)}`)
assert.ok(prods.rows[0].sku && prods.rows[0]._label && prods.rows[0]._search, 'produto com rótulo e texto de busca')
const items = await call(tU, 'GET', '/catalog/price-table-items/sync')
assert.ok(Array.isArray(items.rows))
ok('sincronização: primeira vez em páginas; depois só inclusões/alterações e exclusões desde a última vez')

console.log(`\n${passed} verificações passaram`)
