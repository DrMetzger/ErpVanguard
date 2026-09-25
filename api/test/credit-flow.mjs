// Consulta de CNPJ (com um servidor que imita a BrasilAPI) e Serasa em espera.
// Uso: suba a API com CNPJ_API_URL=http://127.0.0.1:3998/cnpj e rode com API, ADMIN_EMAIL e ADMIN_PASSWORD.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

const API = process.env.API ?? 'http://localhost:3000/api'
let passed = 0
const ok = (m) => { passed++; console.log('  ✓', m) }
async function call(token, method, path, body, expect) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const receita = {
  cnpj: '11222333000181', razao_social: 'PADARIA PAO QUENTE LTDA', nome_fantasia: 'PAO QUENTE', email: 'CONTATO@PAOQUENTE.COM.BR', ddd_telefone_1: '1133334444',
  cep: '01310100', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'PAULISTA', numero: '1000', bairro: 'BELA VISTA', municipio: 'SAO PAULO', uf: 'SP',
  descricao_situacao_cadastral: 'ATIVA', cnae_fiscal_descricao: 'Padaria e confeitaria', opcao_pelo_simples: true, opcao_pelo_mei: false,
}
const mock = createServer((req, res) => {
  const doc = req.url.split('/').pop()
  if (doc === receita.cnpj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(receita)) }
  else { res.writeHead(404); res.end('{}') }
}).listen(3998)

console.log('Consulta de CNPJ e Serasa')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const c = await call(admin, 'GET', '/cnpj/11.222.333-0001.81')
assert.equal(c.name, 'PADARIA PAO QUENTE LTDA'); assert.equal(c.city, 'Sao Paulo'); assert.equal(c.street, 'AVENIDA PAULISTA'); assert.equal(c.email, 'contato@paoquente.com.br'); assert.equal(c.simples, true)
await call(admin, 'GET', '/cnpj/11222333000100', undefined, 400)
await call(admin, 'GET', '/cnpj/11444777000161', undefined, 404)
ok('CNPJ na Receita: razão social, endereço, contato, situação e Simples; CNPJ inválido e inexistente tratados')

const customers = await call(admin, 'GET', '/catalog/customers')
await call(admin, 'PUT', '/settings/serasa', { enabled: false, clientId: '' })
let r = await call(admin, 'POST', `/customers/${customers[0].id}/serasa`, undefined, 503)
assert.ok(r.message.includes('paga'))
await call(admin, 'PUT', '/settings/serasa', { enabled: true }, 400)
const s = await call(admin, 'PUT', '/settings/serasa', { enabled: true, environment: 'homologacao', clientId: 'cliente-teste', clientSecret: 'segredo-muito-secreto-123' })
assert.equal(s.serasa.enabled, true); assert.equal(s.serasa.secretHint, '••••-123'); assert.ok(!JSON.stringify(s).includes('segredo-muito'))
r = await call(admin, 'POST', `/customers/${customers[0].id}/serasa`, undefined, 503)
assert.ok(r.message.includes('Chaves da Serasa salvas'))
await call(admin, 'PUT', '/settings/serasa', { enabled: false, clearSecret: true, clientId: '' })
ok('Serasa em espera: sem contrato avisa que é paga; chaves guardadas criptografadas e mascaradas')

mock.close()
console.log(`\n${passed} verificações passaram`)
