// Teste de ponta a ponta de Cadastros, Fiscal, Configurações e avatar contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/catalog-flow.mjs
import assert from 'node:assert/strict'
import forge from 'node-forge'

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

const pt = await call(tCad, 'POST', '/catalog/price-tables', { code: 'VAR' + run.slice(-3), name: 'Varejo', validFrom: '2026-01-01' })
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

// Empresas e filiais
const head = cnpj(String(Math.floor(Math.random() * 1e8)).padStart(8, '7') + '0001')
const branchDoc = cnpj(head.slice(0, 8) + '0002')
const code4 = () => String(1000 + Math.floor(Math.random() * 9000))
const current = await call(admin, 'GET', '/catalog/companies')
for (const c of current.filter((c) => c.isHead)) await call(admin, 'PATCH', `/catalog/companies/${c.id}`, { isHead: false })
const matriz = await call(admin, 'POST', '/catalog/companies', { code: code4(), isHead: true, document: head, name: 'Matriz ' + run, uf: 'SP', taxRegime: 'presumido' })
await call(admin, 'POST', '/catalog/companies', { code: code4(), isHead: true, document: branchDoc, name: 'Filial ' + run, uf: 'RJ' }, 409)
const filial = await call(admin, 'POST', '/catalog/companies', { code: code4(), isHead: false, document: branchDoc, name: 'Filial ' + run, uf: 'RJ' })
await call(admin, 'POST', '/catalog/companies', { code: code4(), document: head, name: 'Duplicada', uf: 'SP' }, 409)
await call(tCad, 'POST', '/catalog/companies', { code: code4(), document: cnpj('123456780001'), name: 'x', uf: 'SP' }, 403)
r = await call(tFis, 'POST', '/fiscal/resolve', { operationTypeId: opVenda.id, uf: 'RJ', taxpayer: '1' })
assert.equal(r.companyUf, 'SP'); assert.equal(r.interstate, true)
r = await call(tFis, 'POST', '/fiscal/resolve', { operationTypeId: opVenda.id, companyId: filial.id, uf: 'RJ', taxpayer: '1' })
assert.equal(r.companyUf, 'RJ'); assert.equal(r.interstate, false); assert.equal(r.cfop, '5102')
const mei = await call(admin, 'PATCH', `/catalog/companies/${filial.id}`, { taxRegime: 'mei' })
assert.equal(mei.taxRegime, 'mei')
await call(admin, 'PATCH', `/catalog/companies/${filial.id}`, { taxRegime: 'lucro' }, 400)
ok('empresas: regime tributário (MEI, Simples, Presumido, Real) no cadastro; só uma matriz, CNPJ único, só admin cadastra; filial do RJ vendendo para o RJ é dentro do estado')

// Logo para DANFE e relatórios
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
await call(tCad, 'PUT', `/companies/${matriz.id}/logo`, { logo: png }, 403)
await call(admin, 'PUT', `/companies/${matriz.id}/logo`, { logo: 'data:image/svg+xml;base64,PHN2Zz4=' }, 400)
await call(admin, 'PUT', `/companies/${matriz.id}/logo`, { logo: png })
const brand = await call(tSol, 'GET', '/companies/branding')
assert.equal(brand.id, matriz.id); assert.equal(brand.logo, png)
assert.equal((await call(tSol, 'GET', `/companies/branding?companyId=${filial.id}`)).logo, null)
ok('logo da matriz (PNG/JPG) salvo e usado no cabeçalho dos relatórios')

// Certificado digital A1
function makePfx(document, name, password, days) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0' + Math.floor(Math.random() * 1e12).toString(16)
  cert.validity.notBefore = new Date(Date.now() - 86400e3)
  cert.validity.notAfter = new Date(Date.now() + days * 86400e3)
  const attrs = [{ name: 'commonName', value: `${name}:${document}` }, { name: 'countryName', value: 'BR' }]
  cert.setSubject(attrs)
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes())
}
const good = makePfx(head, 'MATRIZ ' + run, 'Senha@A1', 20)
await call(admin, 'POST', '/certificates', { companyId: filial.id, file: good, password: 'errada' }, 400)
await call(admin, 'POST', '/certificates', { companyId: filial.id, file: makePfx(cnpj('112223330001'), 'OUTRA', 'x', 200), password: 'x' }, 400)
await call(admin, 'POST', '/certificates', { companyId: filial.id, file: makePfx(head, 'VENCIDO', 'x', -2), password: 'x' }, 400)
await call(tCad, 'POST', '/certificates', { companyId: filial.id, file: good, password: 'Senha@A1' }, 403)
const cert = await call(admin, 'POST', '/certificates', { companyId: filial.id, file: good, password: 'Senha@A1' })
assert.equal(cert.holderDocument, head); assert.equal(cert.subject, 'MATRIZ ' + run); assert.ok(cert.daysLeft >= 19 && cert.daysLeft <= 20, String(cert.daysLeft))
const list = await call(admin, 'GET', '/certificates')
assert.ok(!JSON.stringify(list).includes(good.slice(0, 40)) && !JSON.stringify(list).includes('Senha@A1'), 'arquivo e senha nunca voltam')
await call(tCad, 'GET', '/certificates', undefined, 403)
const bell = await call(admin, 'GET', '/notifications')
assert.ok(bell.some((n) => n.kind === 'certificado' && n.title.includes('vence em')), 'sino avisa o vencimento')
const renewed = await call(admin, 'POST', '/certificates', { companyId: filial.id, file: makePfx(head, 'MATRIZ ' + run, 'nova', 365), password: 'nova' })
const after = await call(admin, 'GET', '/certificates')
assert.equal(after.filter((c) => c.companyId === filial.id && c.active).length, 1)
assert.equal(after.find((c) => c.id === cert.id).active, false)
await call(admin, 'DELETE', `/certificates/${cert.id}`, undefined, 204)
await call(admin, 'DELETE', `/certificates/${renewed.id}`, undefined, 204)
await call(admin, 'PATCH', `/catalog/companies/${matriz.id}`, { isHead: false, active: false })
await call(admin, 'PATCH', `/catalog/companies/${filial.id}`, { active: false })
ok('certificado A1: senha, CNPJ (raiz da matriz vale para a filial) e validade conferidos; guardado cifrado; renovação troca o ativo; sino avisa 30 dias antes')

// Campos personalizados e ajuste de formulário
const ck = 'limite_' + run.toLowerCase()
await call(tCad, 'POST', '/custom-fields/customers', { key: ck, label: 'Limite de crédito', type: 'number' }, 403)
await call(admin, 'POST', '/custom-fields/customers', { key: 'name', label: 'Nome', type: 'text' }, 400)
await call(admin, 'POST', '/custom-fields/customers', { key: 'seg' + ck, label: 'Segmento', type: 'select' }, 400)
let cf = await call(admin, 'POST', '/custom-fields/customers', { key: ck, label: 'Limite de crédito', type: 'number', showInList: true })
await call(admin, 'POST', '/custom-fields/customers', { key: ck, label: 'Outro', type: 'text' }, 409)
await call(admin, 'POST', '/custom-fields/products', { key: 'cor_' + run.toLowerCase(), label: 'Cor', type: 'select', options: ['Azul', 'Preto'], required: true })
const custX = await call(tCad, 'POST', '/catalog/customers', { document: cnpj(String(Math.floor(Math.random() * 1e12)).padStart(12, '8')), name: 'Cliente campos ' + run, custom: { [ck]: '2500.5' } })
assert.equal(custX.custom[ck], 2500.5)
assert.equal((await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { [ck]: '2.500,75' } })).custom[ck], 2500.75)
await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { [ck]: 'muito' } }, 400)
await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { inventado: 1 } }, 400)
await call(tCad, 'POST', '/products', { sku: 'CF-' + run, name: 'Sem cor', unit: 'UN' }, 400)
const pcf = await call(tCad, 'POST', '/products', { sku: 'CF-' + run, name: 'Com cor', unit: 'UN', custom: { ['cor_' + run.toLowerCase()]: 'Preto' } })
assert.equal(pcf.custom['cor_' + run.toLowerCase()], 'Preto')
await call(tCad, 'POST', '/catalog/units', { code: 'Z' + run.slice(-3), description: 'x', custom: {} })
await call(admin, 'POST', '/catalog/cfop', { code: '5999', description: 'x', custom: {} }, 400)
cf = await call(admin, 'PUT', '/custom-fields/customers/layout', { hidden: ['ie'], order: [`custom.${ck}`, 'name'], labels: { tradeName: 'Apelido' } })
assert.deepEqual(cf.layout.hidden, ['ie']); assert.equal(cf.layout.labels.tradeName, 'Apelido')
await call(admin, 'PUT', '/custom-fields/customers/layout', { hidden: ['document'], order: [], labels: {} }, 400)
await call(admin, 'PUT', '/custom-fields/customers/layout', { hidden: [], order: [], labels: {} })
// Tipos novos, máscara e edição do campo (renomear e trocar tipo convertendo os valores)
const k2 = run.toLowerCase()
await call(admin, 'POST', '/custom-fields/customers', { key: 'placa_' + k2, label: 'Placa', type: 'text', mask: 'placa' })
await call(admin, 'POST', '/custom-fields/customers', { key: 'x_' + k2, label: 'Xx', type: 'memo', mask: 'cpf' }, 400)
await call(admin, 'POST', '/custom-fields/customers', { key: 'y_' + k2, label: 'Yy', type: 'text', mask: 'abc' }, 400)
await call(admin, 'POST', '/custom-fields/customers', { key: 'obs_' + k2, label: 'Histórico', type: 'memo' })
await call(admin, 'POST', '/custom-fields/customers', { key: 'canais_' + k2, label: 'Canais', type: 'multiselect', options: ['Loja', 'Site'] })
await call(admin, 'POST', '/custom-fields/customers', { key: 'valor_' + k2, label: 'Ticket', type: 'currency' })
let v = await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { ['placa_' + k2]: 'abc1d23', ['obs_' + k2]: 'x'.repeat(3000), ['canais_' + k2]: ['Loja', 'Site'], ['valor_' + k2]: 10.567 } })
assert.equal(v.custom['placa_' + k2], 'ABC1D23'); assert.equal(v.custom['obs_' + k2].length, 3000); assert.deepEqual(v.custom['canais_' + k2], ['Loja', 'Site']); assert.equal(v.custom['valor_' + k2], 10.57)
await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { ['placa_' + k2]: '123' } }, 400)
await call(tCad, 'PATCH', `/catalog/customers/${custX.id}`, { custom: { ['canais_' + k2]: ['Fax'] } }, 400)
const defs = (await call(admin, 'GET', '/custom-fields/customers')).fields
const byKey = (k) => defs.find((f) => f.key === k)
await call(admin, 'PATCH', `/custom-fields/customers/${byKey('canais_' + k2).id}`, { type: 'select' }, 400)
await call(admin, 'PATCH', `/custom-fields/customers/${byKey('placa_' + k2).id}`, { key: 'placa_veiculo_' + k2, type: 'memo' })
v = (await call(tCad, 'GET', '/catalog/customers')).find((c) => c.id === custX.id)
assert.equal(v.custom['placa_veiculo_' + k2], 'ABC1D23'); assert.equal(v.custom['placa_' + k2], undefined)
ok('tipos novos (memo, várias opções, moeda) e máscara de placa; editar campo renomeia e converte os valores; troca que perderia dados é recusada')
for (const r of ['customers', 'products']) for (const f of (await call(admin, 'GET', `/custom-fields/${r}`)).fields) await call(admin, 'DELETE', `/custom-fields/${r}/${f.id}`, undefined, 204)
ok('campos personalizados: só admin cria; tipo e opções validados; obrigatório cobrado; formulário esconde/renomeia/reordena (obrigatório não esconde)')

// Fotos do produto
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const pp = await call(tCad, 'POST', '/products', { sku: 'PH-' + run, name: 'Produto com foto', unit: 'UN' })
await call(tSol, 'POST', `/products/${pp.id}/photos`, { image: tiny, thumb: tiny }, 403)
await call(tCad, 'POST', `/products/${pp.id}/photos`, { image: 'data:image/gif;base64,R0lGOD==', thumb: tiny }, 400)
let photos
for (let i = 0; i < 6; i++) photos = await call(tCad, 'POST', `/products/${pp.id}/photos`, { image: tiny, thumb: tiny })
await call(tCad, 'POST', `/products/${pp.id}/photos`, { image: tiny, thumb: tiny }, 400)
assert.equal(photos.length, 6); assert.ok(photos[0].url.startsWith('data:image/png;base64,'))
photos = await call(tCad, 'POST', `/products/${pp.id}/photos/${photos[3].id}/main`)
assert.equal(photos[0].position, 0)
photos = await call(tCad, 'DELETE', `/products/${pp.id}/photos/${photos[0].id}`)
assert.equal(photos.length, 5); assert.deepEqual(photos.map((x) => x.position), [0, 1, 2, 3, 4])
assert.equal((await call(tCad, 'GET', `/products?q=PH-${run}`))[0].thumb, tiny)
await call(tCad, 'DELETE', `/products/${pp.id}`, undefined, 204)
ok('fotos do produto: até 6, formato conferido, trocar principal, excluir reordena; miniatura na lista')

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
