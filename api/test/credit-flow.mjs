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
const IE_RJ = '99999993'
const receita = {
  cnpj: '11222333000181', razao_social: 'PADARIA PAO QUENTE LTDA', nome_fantasia: 'PAO QUENTE', email: 'CONTATO@PAOQUENTE.COM.BR', ddd_telefone_1: '1133334444',
  cep: '01310100', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'PAULISTA', numero: '1000', bairro: 'BELA VISTA', municipio: 'SAO PAULO', uf: 'SP',
  descricao_situacao_cadastral: 'ATIVA', cnae_fiscal: 1091102, cnae_fiscal_descricao: 'Padaria e confeitaria', opcao_pelo_simples: true, opcao_pelo_mei: false,
  ddd_telefone_2: '11999998888', complemento: 'LOJA 2', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'MICRO EMPRESA', capital_social: 50000,
  cnaes_secundarios: [{ codigo: 4721102, descricao: 'Padaria e confeitaria com predominância de revenda' }], qsa: [{ nome_socio: 'JOAO DA SILVA', qualificacao_socio: 'Sócio-Administrador' }],
}
const ceps = { '15015100': { cep: '15015-100', logradouro: 'Rua Bernardino de Campos', complemento: '', bairro: 'Centro', localidade: 'São José do Rio Preto', uf: 'SP', ibge: '3549805' } }
const mock = createServer((req, res) => {
  const doc = req.url.split('/').pop()
  if (req.url.startsWith('/cep/')) { const c = ceps[doc]; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(c ?? { erro: true })); return }
  if (doc === receita.cnpj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(receita)) }
  else { res.writeHead(404); res.end('{}') }
}).listen(3998)

console.log('Consulta de CNPJ e Serasa')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const c = await call(admin, 'GET', '/cnpj/11.222.333-0001.81')
assert.equal(c.name, 'PADARIA PAO QUENTE LTDA'); assert.equal(c.city, 'São Paulo'); assert.equal(c.cityCode, '3550308'); assert.equal(c.phone2, '11999998888'); assert.equal(c.complement, 'LOJA 2')
assert.equal(c.cnae, '1091-1/02 · Padaria e confeitaria'); assert.equal(c.receita.cnaesSecundarios[0].code, '4721-1/02'); assert.equal(c.receita.socios[0].nome, 'JOAO DA SILVA'); assert.equal(c.receita.capitalSocial, 50000); assert.equal(c.street, 'AVENIDA PAULISTA'); assert.equal(c.email, 'contato@paoquente.com.br'); assert.equal(c.simples, true)
await call(admin, 'GET', '/cnpj/11222333000100', undefined, 400)
assert.match((await call(admin, 'GET', '/cnpj/37325331827', undefined, 400)).message, /CPF/)
await call(admin, 'GET', '/cnpj/11444777000161', undefined, 404)
ok('CNPJ na Receita: razão social, endereço com código IBGE, telefones, CNAEs, sócios e Simples; CPF explica que não há consulta; inválido e inexistente tratados')

// CEP, municípios e inscrição estadual
const cep = await call(admin, 'GET', '/cep/15015-100')
assert.equal(cep.city, 'São José do Rio Preto'); assert.equal(cep.cityCode, '3549805'); assert.equal(cep.street, 'Rua Bernardino de Campos')
await call(admin, 'GET', '/cep/99999999', undefined, 404)
await call(admin, 'GET', '/cep/123', undefined, 400)
const sp = await call(admin, 'GET', '/municipalities?uf=SP')
assert.equal(sp.length, 645); assert.ok(sp.some((m) => m.code === '3549805'))
assert.equal((await call(admin, 'GET', '/municipalities?uf=DF')).length, 1)
assert.equal((await call(admin, 'GET', '/validate/ie?uf=SP&ie=110.042.490.114')).valid, true)
assert.equal((await call(admin, 'GET', '/validate/ie?uf=SP&ie=110042490115')).valid, false)
assert.equal((await call(admin, 'GET', '/validate/ie?uf=MG&ie=ISENTO')).valid, true)
const doc = '11444777000161'
for (const x of await call(admin, 'GET', `/catalog/customers?q=${doc}`)) await call(admin, 'DELETE', `/catalog/customers/${x.id}`, undefined, 204)
await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: doc, name: 'IE errada', uf: 'SP', ie: '110042490115', taxpayer: '1' }, 400)
await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: doc, name: 'Sem IE', uf: 'SP', taxpayer: '1' }, 400)
await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: doc, name: 'Cidade errada', uf: 'RJ', city: 'Campinas' }, 400)
await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: doc, name: 'Fone', phone: '1234' }, 400)
const cli = await call(admin, 'POST', '/catalog/customers', { document: doc, name: 'Cliente completo', uf: 'SP', city: 'sao jose do rio preto', ie: '110.042.490.114', taxpayer: '1', contact: 'Maria', phone: '(17) 3222-1111', phone2: '(17) 99999-1111', zip: '15015-100', receita: { fonte: 'teste' } })
assert.equal(cli.city, 'São José do Rio Preto'); assert.equal(cli.cityCode, '3549805'); assert.equal(cli.ie, '110042490114'); assert.equal(cli.phone, '1732221111'); assert.equal(cli.zip, '15015100'); assert.equal(cli.contact, 'Maria'); assert.equal(cli.receita.fonte, 'teste')
const moved = await call(admin, 'PATCH', `/catalog/customers/${cli.id}`, { uf: 'RJ', city: 'Rio de Janeiro', ie: IE_RJ })
assert.equal(moved.cityCode, '3304557')
await call(admin, 'DELETE', `/catalog/customers/${cli.id}`, undefined, 204)
for (const x of await call(admin, 'GET', '/catalog/suppliers?q=11222333000181')) await call(admin, 'DELETE', `/catalog/suppliers/${x.id}`, undefined, 204)
for (const x of await call(admin, 'GET', '/catalog/customers?q=11444777000161')) await call(admin, 'DELETE', `/catalog/customers/${x.id}`, undefined, 204)
const sup = await call(admin, 'POST', '/catalog/suppliers', { cnpj: '11.222.333/0001-81', name: 'Fornecedor completo', uf: 'SP', city: 'Campinas', ie: 'ISENTO', contact: 'João', zip: '13010000' })
assert.equal(sup.cityCode, '3509502'); assert.equal(sup.contact, 'João')
assert.ok((await call(admin, 'GET', '/suppliers?q=Fornecedor completo')).some((x) => x.id === sup.id))
await call(admin, 'DELETE', `/catalog/suppliers/${sup.id}`, undefined, 204)
ok('CEP com código IBGE, municípios por UF, inscrição estadual conferida pela UF; cidade vira nome oficial + código; telefone e CEP só números; fornecedor com o mesmo cadastro')

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
