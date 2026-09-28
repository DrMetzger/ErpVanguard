// Importação e exportação de cadastros por planilha (Excel) contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/sheet-flow.mjs
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

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
async function download(token, path, expect = 200) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(res.status, expect, `${path}: ${res.status}`)
  if (expect !== 200) return null
  assert.match(res.headers.get('content-type'), /spreadsheetml/)
  assert.match(res.headers.get('content-disposition'), /attachment; filename=".+\.xlsx"/)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()))
  return wb
}
const toB64 = async (wb) => Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')
// Preenche a aba Dados pelas chaves técnicas (linha 2) a partir da linha 3.
function fill(wb, rows) {
  const ws = wb.getWorksheet('Dados')
  const keys = ws.getRow(2).values.slice(1)
  rows.forEach((r, i) => { const row = ws.getRow(3 + i); for (const [k, v] of Object.entries(r)) row.getCell(keys.indexOf(k) + 1).value = v; row.commit() })
  return wb
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '7')

console.log('Importação e exportação por planilha')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const sol = await call(admin, 'POST', '/users', { name: 'Sol ' + run, email: `solp.${run}@t.com`.toLowerCase(), password: pass, permissions: ['solicitante'] })
const tSol = (await call(null, 'POST', '/auth/login', { email: sol.email, password: pass })).token

// Modelo e exportação de todos os cadastros
const meta = await call(admin, 'GET', '/catalog/meta')
for (const name of [...meta.map((m) => m.name), 'products']) {
  const t = await download(admin, `/catalog/${name}/sheet/template`)
  assert.ok(t.getWorksheet('Dados') && t.getWorksheet('Instruções'), name)
  await download(admin, `/catalog/${name}/sheet/export`)
}
await download(tSol, '/catalog/customers/sheet/template', 403)
ok(`modelo (com instruções) e exportação de ${meta.length + 1} cadastros; sem permissão não baixa o modelo`)

// Clientes: modelo tem obrigatórios marcados, listas e instruções
const tpl = await download(admin, '/catalog/customers/sheet/template')
const head = tpl.getWorksheet('Dados').getRow(1).values.slice(1)
assert.ok(head.includes('CPF/CNPJ *') && head.includes('CEP *') && head.includes('Contribuinte'), head.join('|'))
assert.ok(tpl.getWorksheet('Instruções').getColumn(1).values.includes('Inscrição estadual'))
const d1 = cnpj(r12()), d2 = cnpj(r12())
const bad = fill(tpl, [
  { document: d1, name: 'Planilha Um ' + run, taxpayer: '1 · Contribuinte de ICMS', ie: '110042490114', zip: '15015100', uf: 'SP', city: 'São José do Rio Preto', phone: '(17) 3222-1111', contact: 'Ana' },
  { document: '123', name: 'Doc ruim ' + run, zip: '15015100' },
  { document: d2, name: 'Sem CEP ' + run, taxpayer: 'Não contribuinte' },
  { document: d1, name: 'Repetido ' + run, zip: '15015100' },
])
let r = await call(admin, 'POST', '/catalog/customers/sheet/import', { file: await toB64(bad), commit: true })
assert.equal(r.committed, false); assert.equal(r.total, 4); assert.equal(r.errors, 3)
assert.match(r.rows[1].errors.join(), /CPF\/CNPJ/); assert.match(r.rows[2].errors.join(), /CEP/); assert.match(r.rows[3].errors.join(), /repetido/)
assert.equal((await call(admin, 'GET', `/catalog/customers?q=${d1}`)).length, 0, 'com erro nada é gravado')
ok('conferência linha a linha: documento inválido, obrigatório faltando e linha repetida; com erro nada é gravado')

const good = fill(await download(admin, '/catalog/customers/sheet/template'), [
  { document: d1, name: 'Planilha Um ' + run, taxpayer: '1 · Contribuinte de ICMS', ie: '110042490114', zip: '15015100', uf: 'SP', city: 'sao jose do rio preto', phone: '17 32221111', contact: 'Ana' },
  { document: d2, name: 'Planilha Dois ' + run, taxpayer: 'Não contribuinte', zip: 1310100, uf: 'SP', city: 'São Paulo', active: 'Não' },
])
r = await call(admin, 'POST', '/catalog/customers/sheet/import', { file: await toB64(good) })
assert.equal(r.committed, false); assert.equal(r.create, 2); assert.equal(r.errors, 0)
assert.equal((await call(admin, 'GET', `/catalog/customers?q=${d1}`)).length, 0, 'conferir não grava')
r = await call(admin, 'POST', '/catalog/customers/sheet/import', { file: await toB64(good), commit: true })
assert.equal(r.committed, true)
const c1 = (await call(admin, 'GET', `/catalog/customers?q=${d1}`))[0]
assert.equal(c1.city, 'São José do Rio Preto'); assert.equal(c1.cityCode, '3549805'); assert.equal(c1.phone, '1732221111'); assert.equal(c1.taxpayer, '1'); assert.equal(c1.contact, 'Ana')
const c2 = (await call(admin, 'GET', `/catalog/customers?q=${d2}`))[0]
assert.equal(c2.zip, '01310100', 'CEP que virou número no Excel recupera o zero'); assert.equal(c2.active, false)
ok('conferir não grava; gravar inclui com cidade oficial + código IBGE, telefone e CEP normalizados, Sim/Não e listas')

// Exportar → editar → importar de volta atualiza (não duplica)
const exp = await download(admin, '/catalog/customers/sheet/export')
const ws = exp.getWorksheet('Dados')
const keys = ws.getRow(2).values.slice(1)
let rowNum = 0
ws.eachRow((row, n) => { if (n > 2 && row.getCell(keys.indexOf('document') + 1).value === d2) rowNum = n })
assert.ok(rowNum > 2, 'exportação traz o cliente')
assert.equal(ws.getRow(rowNum).getCell(keys.indexOf('taxpayer') + 1).value, '9 · Não contribuinte')
ws.getRow(rowNum).getCell(keys.indexOf('name') + 1).value = 'Planilha Dois Editado ' + run
r = await call(admin, 'POST', '/catalog/customers/sheet/import', { file: await toB64(exp), commit: true })
assert.equal(r.errors, 0, JSON.stringify(r.rows.filter((x) => x.errors.length).slice(0, 3))); assert.equal(r.create, 0); assert.ok(r.update >= 2)
assert.equal((await call(admin, 'GET', `/catalog/customers?q=${d2}`))[0].name, 'Planilha Dois Editado ' + run)
ok(`exportação no formato do modelo; editar e importar de volta atualiza ${r.update} registros sem duplicar`)

// Produtos: grupo pela lista ou pelo código, origem, preços com vírgula, NCM
const grp = await call(admin, 'POST', '/catalog/product-groups', { code: 'PL' + run.slice(-3), name: 'Grupo planilha ' + run })
const pt = fill(await download(admin, '/catalog/products/sheet/template'), [
  { sku: 'PL-' + run + '-1', name: 'Produto planilha 1', unit: 'un', groupId: grp.code, origin: '0 · Nacional', salePrice: '1.234,56', costPrice: 700, ncm: '39269090' },
  { sku: 'PL-' + run + '-2', name: 'Produto planilha 2', groupId: `${grp.code} · ${grp.name}`, salePrice: 10 },
  { sku: 'PL-' + run + '-3', name: 'Grupo errado', groupId: 'NAOEXISTE' },
])
r = await call(admin, 'POST', '/catalog/products/sheet/import', { file: await toB64(pt), commit: true })
assert.equal(r.errors, 1); assert.match(r.rows[2].errors.join(), /não encontrado/)
fill(pt, [{}, {}, { sku: 'PL-' + run + '-3', name: 'Grupo certo', groupId: grp.code }])
r = await call(admin, 'POST', '/catalog/products/sheet/import', { file: await toB64(pt), commit: true })
assert.equal(r.committed, true); assert.equal(r.create, 3)
const p1 = (await call(admin, 'GET', `/products?q=PL-${run}-1`))[0]
assert.equal(Number(p1.salePrice), 1234.56); assert.equal(p1.unit, 'UN'); assert.equal(p1.groupId, grp.id); assert.equal(p1.origin, 0)
fill(pt, [{ sku: 'PL-' + run + '-1', salePrice: 99 }])
r = await call(admin, 'POST', '/catalog/products/sheet/import', { file: await toB64(pt), commit: true })
assert.equal(r.update, 3); assert.equal(Number((await call(admin, 'GET', `/products?q=PL-${run}-1`))[0].salePrice), 99)
await call(tSol, 'POST', '/catalog/products/sheet/import', { file: await toB64(pt) }, 403)
ok('produtos: grupo pelo código ou pela lista, preço com vírgula, unidade maiúscula; SKU existente atualiza; sem permissão não importa')

// Planilha qualquer (sem a linha de chaves): reconhece as colunas pelo nome
const loose = new ExcelJS.Workbook()
const lw = loose.addWorksheet('Plan1')
lw.addRow(['Sigla *', 'Descrição']); lw.addRow(['L' + run.slice(-4), 'Unidade solta ' + run])
r = await call(admin, 'POST', '/catalog/units/sheet/import', { file: await toB64(loose), commit: true })
assert.equal(r.committed, true, JSON.stringify(r.rows)); assert.equal(r.create, 1)
await call(admin, 'POST', '/catalog/units/sheet/import', { file: Buffer.from('não é planilha').toString('base64') }, 400)
ok('planilha própria com os nomes das colunas também entra; arquivo que não é planilha é recusado')

console.log(`\n${passed} verificações passaram`)
