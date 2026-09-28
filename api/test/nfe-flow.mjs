// NF-e própria de ponta a ponta com uma SEFAZ de mentira (HTTPS local, certificado autoassinado).
// A API precisa subir com SEFAZ_URL_OVERRIDE=https://127.0.0.1:3988/ws (só vale fora de produção), de preferência
// com SEFAZ_TIMEOUT_MS=4000 e SEFAZ_RECIBO_WAIT_MS=200.
// Uso: API=http://127.0.0.1:4005/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/nfe-flow.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import forge from 'node-forge'
import { checkKey, checkTotals, makePfx, verifySignature } from './nfe-helpers.mjs'

const API = process.env.API ?? 'http://localhost:3000/api'
const MOCK_PORT = Number(process.env.SEFAZ_MOCK_PORT ?? 3988)
const run = Date.now().toString(36).slice(-5).toUpperCase()
const SCHEMAS = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@brasil-fiscal/nfe/schemas')
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function request(token, method, path, body) {
  return fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function call(token, method, path, body, expect) {
  const res = await request(token, method, path, body)
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '4')

// ---- SEFAZ de mentira

const mode = { auth: 'ok', consult: 'notfound' }
const received = { auth: [], consult: 0, recibo: 0, events: [], inut: 0, status: 0 }
let protSeq = 135260000000000
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
const now = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00'
const envelope = (wsdl, inner) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}">${inner}</nfeResultMsg></soap:Body></soap:Envelope>`
const prot = (key, cStat, xMotivo, digest) => `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><chNFe>${key}</chNFe><dhRecbto>${now()}</dhRecbto>${cStat === '100' || cStat === '302' ? `<nProt>${++protSeq}</nProt>` : ''}<digVal>${digest}</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`
const authorized = new Map() // chave → digest

function sefaz(body) {
  if (body.includes('<enviNFe')) {
    const key = body.match(/Id="NFe(\d{44})"/)[1]
    const digest = tag(body, 'DigestValue')
    received.auth.push(body.match(/<NFe[\s\S]*<\/NFe>/)[0])
    const lote = (cStat, xMotivo, inner = '') => envelope('NFeAutorizacao4', `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF><dhRecbto>${now()}</dhRecbto>${inner}</retEnviNFe>`)
    if (mode.auth === 'drop') return 'drop'
    if (mode.auth === 'reject539') return lote('104', 'Lote processado', prot(key, '539', `Rejeição: Duplicidade de NF-e com diferença na Chave de Acesso [chNFe: 35260911222333000181550010000000011000000011][nRec:351000000000001]`, digest))
    if (mode.auth === 'reject204') return lote('104', 'Lote processado', prot(key, '204', 'Rejeição: Duplicidade de NF-e [nRec:351000000000002]', digest))
    if (mode.auth === 'denied') { authorized.set(key, { digest, cStat: '302' }); return lote('104', 'Lote processado', prot(key, '302', 'Uso Denegado: Irregularidade fiscal do destinatário', digest)) }
    if (mode.auth === 'async') { authorized.set(key, { digest, cStat: '100', pending: true }); return lote('103', 'Lote recebido com sucesso', `<infRec><nRec>351000000${String(received.auth.length).padStart(6, '0')}</nRec><tMed>1</tMed></infRec>`) }
    authorized.set(key, { digest, cStat: '100' })
    return lote('104', 'Lote processado', prot(key, '100', 'Autorizado o uso da NF-e', digest))
  }
  if (body.includes('<consReciNFe')) {
    received.recibo++
    const [key, a] = [...authorized.entries()].find(([, v]) => v.pending) ?? []
    if (!key) return envelope('NFeRetAutorizacao4', `<retConsReciNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic><nRec>${tag(body, 'nRec')}</nRec><cStat>106</cStat><xMotivo>Lote não localizado</xMotivo><cUF>35</cUF></retConsReciNFe>`)
    if (received.recibo === 1) return envelope('NFeRetAutorizacao4', `<retConsReciNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic><nRec>${tag(body, 'nRec')}</nRec><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>35</cUF></retConsReciNFe>`)
    a.pending = false
    return envelope('NFeRetAutorizacao4', `<retConsReciNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic><nRec>${tag(body, 'nRec')}</nRec><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF><dhRecbto>${now()}</dhRecbto>${prot(key, '100', 'Autorizado o uso da NF-e', a.digest)}</retConsReciNFe>`)
  }
  if (body.includes('<consSitNFe')) {
    received.consult++
    const key = tag(body, 'chNFe')
    const ret = (cStat, xMotivo, inner = '') => envelope('NFeConsultaProtocolo4', `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF><dhRecbto>${now()}</dhRecbto><chNFe>${key}</chNFe>${inner}</retConsSitNFe>`)
    const a = authorized.get(key)
    if (mode.consult === 'authorized' && a) return ret('100', 'Autorizado o uso da NF-e', prot(key, '100', 'Autorizado o uso da NF-e', a.digest))
    return ret('217', 'Rejeição: NF-e não consta na base de dados da SEFAZ')
  }
  if (body.includes('<envEvento')) {
    received.events.push(body)
    const tp = tag(body, 'tpEvento')
    const key = tag(body, 'chNFe')
    return envelope('NFeRecepcaoEvento4', `<retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${key}</chNFe><tpEvento>${tp}</tpEvento><xEvento>${tp === '110111' ? 'Cancelamento' : 'Carta de Correção'}</xEvento><nSeqEvento>${tag(body, 'nSeqEvento')}</nSeqEvento><dhRegEvento>${now()}</dhRegEvento><nProt>${++protSeq}</nProt></infEvento></retEvento></retEnvEvento>`)
  }
  if (body.includes('<inutNFe')) {
    received.inut++
    return envelope('NFeInutilizacao4', `<retInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut><tpAmb>2</tpAmb><verAplic>SP</verAplic><cStat>102</cStat><xMotivo>Inutilização de número homologado</xMotivo><cUF>35</cUF><ano>${tag(body, 'ano')}</ano><CNPJ>${tag(body, 'CNPJ')}</CNPJ><mod>55</mod><serie>${tag(body, 'serie')}</serie><nNFIni>${tag(body, 'nNFIni')}</nNFIni><nNFFin>${tag(body, 'nNFFin')}</nNFFin><dhRecbto>${now()}</dhRecbto><nProt>${++protSeq}</nProt></infInut></retInutNFe>`)
  }
  if (body.includes('<consStatServ')) {
    received.status++
    return envelope('NFeStatusServico4', `<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><cStat>107</cStat><xMotivo>Serviço em Operação</xMotivo><cUF>35</cUF><dhRecbto>${now()}</dhRecbto><tMed>1</tMed></retConsStatServ>`)
  }
  return null
}

function selfSigned() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400e3)
  cert.validity.notAfter = new Date(Date.now() + 86400e3)
  cert.setSubject([{ name: 'commonName', value: '127.0.0.1' }])
  cert.setIssuer([{ name: 'commonName', value: '127.0.0.1' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) }
}

const server = createServer(selfSigned(), (req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const out = sefaz(Buffer.concat(chunks).toString('utf8'))
    if (out === 'drop') return req.socket.destroy()
    if (!out) { res.writeHead(500); return res.end('serviço desconhecido') }
    res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' })
    res.end(out)
  })
})
await new Promise((r, j) => server.once('error', j).listen(MOCK_PORT, '127.0.0.1', r))

// ---- fluxo

console.log('NF-e própria: XML, SEFAZ (mock), DANFE, CC-e, cancelamento e inutilização')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const user = async (name, permissions) => {
  const u = await call(admin, 'POST', '/users', { name: `${name} ${run}`, email: `${name.toLowerCase()}.${run}@nfe.com`.toLowerCase(), password: pass, permissions })
  return (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
}
const tFat = await user('Faturista', ['faturamento'])
const tVend = await user('Vendedor', ['vendedor'])
const tCad = await user('Cadastro', ['cadastro'])
const saved = Object.fromEntries((await call(admin, 'GET', '/parameters')).map((p) => [p.key, p.value]))

try {
  await call(admin, 'PUT', '/parameters', { MV_ESPECIE: '1=SPED', MV_SERNFE: 1 })
  // Empresa em SP (Lucro Presumido) com endereço completo e certificado A1 de homologação
  const doc = cnpj(r12())
  const company = await call(admin, 'POST', '/catalog/companies', {
    code: String(1000 + Math.floor(Math.random() * 9000)), document: doc, name: `Vanguard NF-e ${run} & Cia`, tradeName: 'Vanguard', uf: 'SP', taxRegime: 'presumido',
    ie: '110042490114', zip: '01001000', street: 'Praça da Sé', number: '100', district: 'Sé', city: 'São Paulo', cityCode: '3550308', phone: '1133334444',
  })
  const custSP = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: `Cliente NF-e ${run}`, uf: 'SP', taxpayer: '1', ie: '110042490114',
    zip: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', cityCode: '3550308', email: 'compras@cliente.com.br' })
  const custBA = await call(admin, 'POST', '/catalog/customers', { document: '52998224725', name: `Consumidor BA ${run}`, uf: 'BA', taxpayer: '9',
    zip: '40020000', street: 'Rua Chile', number: '10', district: 'Centro', city: 'Salvador', cityCode: '2927408' }).catch(async () =>
    (await call(admin, 'GET', '/catalog/customers?q=52998224725')).find((c) => c.document === '52998224725'))
  if (custBA.uf !== 'BA' || !custBA.street) await call(admin, 'PATCH', `/catalog/customers/${custBA.id}`, { uf: 'BA', taxpayer: '9', ie: null, zip: '40020000', street: 'Rua Chile', number: '10', district: 'Centro', city: 'Salvador', cityCode: '2927408', active: true })
  const prod = await call(tCad, 'POST', '/products', { sku: `NFE-${run}`, name: 'Furadeira de impacto', unit: 'UN', ncm: '84672100', barcode: '7891000315507', costPrice: 100, salePrice: 450, stock: 100 })
  const terms = await call(admin, 'GET', '/catalog/payment-terms')
  const vista = terms.find((t) => t.days === '0')
  const prazo = terms.find((t) => t.days === '30/60')
  const invoiceFor = async (customerId, termId = prazo.id, extra = {}) => {
    const order = await call(tVend, 'POST', '/sales-orders', { companyId: company.id, customerId, paymentTermId: termId, freight: 20, discount: 5, items: [{ productId: prod.id, quantity: 2, discountPct: 3 }], ...extra })
    return call(tFat, 'POST', `/sales-orders/${order.id}/invoice`)
  }

  // Sem certificado: mensagem clara
  const nf1 = await invoiceFor(custSP.id)
  assert.equal(nf1.sefazStatus, 'pendente')
  const noCert = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/xml`, undefined, 400)
  assert.match(noCert.message, /certificado A1/i)
  await call(admin, 'POST', '/certificates', { companyId: company.id, file: makePfx(doc, `VANGUARD ${run}`, 'Senha@A1', 365), password: 'Senha@A1' })
  ok('sem certificado A1 a NF-e não é gerada (mensagem clara); com o A1 enviado, segue')

  // 1. Gerar e validar (sem transmitir)
  await call(tVend, 'POST', `/sales-invoices/${nf1.id}/nfe/xml`, undefined, 403)
  const gen = await call(tFat, 'POST', `/sales/invoices/${nf1.id}/nfe/xml`)
  assert.equal(gen.valid, true, gen.errors.join('\n')); assert.deepEqual(gen.errors, []); assert.deepEqual(gen.warnings, [])
  assert.match(gen.accessKey, /^35\d{4}\d{14}55001\d{9}1\d{9}$/); assert.equal(gen.accessKey.slice(6, 20), doc); assert.equal(gen.environment, 'homologacao')
  let res = await request(tFat, 'GET', `/sales-invoices/${nf1.id}/nfe/xml`)
  assert.equal(res.status, 200); assert.match(res.headers.get('content-disposition'), new RegExp(`${gen.accessKey}-nfe.xml`))
  const xml1 = await res.text()
  verifySignature(xml1); checkTotals(xml1); checkKey(xml1, gen.accessKey)
  assert.match(xml1, /<tpAmb>2<\/tpAmb>/); assert.match(xml1, /<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome>/)
  assert.match(xml1, /<cobr><fat><nFat>\d+<\/nFat>.*<dup><nDup>001<\/nDup>.*<nDup>002<\/nDup>/); assert.match(xml1, /<indPag>1<\/indPag><tPag>15<\/tPag>/)
  assert.match(xml1, /<modFrete>0<\/modFrete>/); assert.match(xml1, /<natOp>[^<]+<\/natOp>/); assert.match(xml1, /<verProc>ERP Vanguard 1.0<\/verProc>/)
  assert.ok(!xml1.includes('<infRespTec>'), 'sem responsável técnico configurado, o grupo fica de fora')
  const inv1 = await call(tFat, 'GET', `/sales-invoices/${nf1.id}`)
  assert.equal(Number(xml1.match(/<vNF>([^<]+)<\/vNF>/)[1]), inv1.total, 'vNF = total da nota')
  ok(`XML gerado, assinado e válido no XSD (chave ${gen.accessKey}); totais, duplicatas 30/60 e textos de homologação conferidos`)

  // Responsável técnico pelos parâmetros
  await call(admin, 'PUT', '/parameters', { MV_RTCNPJ: '11222333000181', MV_RTCONT: 'Kleber  Farias', MV_RTMAIL: 'suporte@primeerp.com.br', MV_RTFONE: '11999998888' })
  const gen2 = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/xml`)
  assert.equal(gen2.accessKey, gen.accessKey, 'no mesmo mês a chave (cNF) não muda ao gerar de novo')
  const xml1b = await (await request(tFat, 'GET', `/sales-invoices/${nf1.id}/nfe/xml`)).text()
  assert.match(xml1b, /<infRespTec><CNPJ>11222333000181<\/CNPJ><xContato>Kleber Farias<\/xContato><email>suporte@primeerp.com.br<\/email><fone>11999998888<\/fone><\/infRespTec>/)
  assert.equal(gen2.valid, true, gen2.errors.join('\n'))
  ok('infRespTec sai só quando configurado nos parâmetros (MV_RTCNPJ...) e o XML continua válido')

  // 2. Status do serviço
  const st = await call(tFat, 'GET', `/sefaz/status?companyId=${company.id}`)
  assert.equal(st.online, true); assert.equal(st.code, '107'); assert.equal(st.environment, 'homologacao'); assert.equal(st.uf, 'SP')
  ok('status do serviço da SEFAZ-SP em homologação: 107 (em operação)')

  // 3. Rejeição (539) → corrige nada, transmite de novo → autorizada
  mode.auth = 'reject539'
  let t = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'rejeitada'); assert.equal(t.code, '539'); assert.match(t.message, /Duplicidade/); assert.match(t.message, /avance a numeração/)
  mode.auth = 'ok'
  t = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'autorizada', JSON.stringify(t)); assert.match(t.protocol, /^\d{15}$/); assert.equal(t.accessKey, gen.accessKey)
  const sent = received.auth.at(-1)
  verifySignature(sent); checkTotals(sent)
  res = await request(tFat, 'GET', `/sales-invoices/${nf1.id}/nfe/xml`)
  assert.match(res.headers.get('content-disposition'), /-procNFe\.xml/)
  const proc = await res.text()
  assert.ok(proc.startsWith('<?xml') && proc.includes('<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe') && proc.includes('<protNFe versao="4.00"><infProt>'))
  execFileSync('xmllint', ['--noout', '--schema', resolve(SCHEMAS, 'procNFe_v4.00.xsd'), '-'], { input: proc, stdio: ['pipe', 'pipe', 'pipe'] })
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/transmit`, undefined, 400)
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/xml`, undefined, 400)
  ok(`rejeição 539 mostrada com dica; nova transmissão autorizada (protocolo ${t.protocol}); nfeProc válido no XSD procNFe`)

  // 4. DANFE
  res = await request(tFat, 'GET', `/sales-invoices/${nf1.id}/nfe/danfe`)
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/pdf')
  const pdf = Buffer.from(await res.arrayBuffer())
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 3000)
  ok(`DANFE em PDF (${Math.round(pdf.length / 1024)} KB)`)

  // 5. Carta de correção (sequência) e cancelamento
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/cce`, { correcao: 'curta' }, 400)
  let cce = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/cce`, { correcao: 'Endereço de entrega: Rua das Flores, 100 & fundos' })
  assert.equal(cce.ok, true); assert.equal(cce.sequence, 1)
  cce = await call(tFat, 'POST', `/sales/invoices/${nf1.id}/nfe/cce`, { correcao: 'Correção do complemento do endereço de entrega' })
  assert.equal(cce.sequence, 2)
  const lastCce = received.events.at(-1)
  assert.match(lastCce, /<nSeqEvento>2<\/nSeqEvento>/); assert.match(lastCce, /ID110110\d{44}02/)
  assert.ok(received.events[0].includes('Rua das Flores, 100 e fundos'), '& vira "e" no texto do evento')
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/cancel`, { reason: 'Cancelamento interno sem SEFAZ' }, 400)
  const stockBefore = (await call(tCad, 'GET', `/products/${prod.id}`)).stock
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/cancel`, { justificativa: 'curta' }, 400)
  const cancel = await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/cancel`, { justificativa: 'Cliente desistiu da compra antes da entrega' })
  assert.equal(cancel.ok, true); assert.equal(cancel.code, '135')
  assert.match(received.events.at(-1), /<tpEvento>110111<\/tpEvento>.*<nProt>\d{15}<\/nProt><xJust>Cliente desistiu/)
  const inv1c = await call(tFat, 'GET', `/sales-invoices/${nf1.id}`)
  assert.equal(inv1c.status, 'cancelada'); assert.equal(inv1c.sefazStatus, 'cancelada'); assert.ok(inv1c.titles.every((x) => x.status === 'cancelado'))
  assert.equal((await call(tCad, 'GET', `/products/${prod.id}`)).stock, stockBefore + 2, 'estoque devolvido')
  const types = inv1c.nfeEvents.map((e) => e.type)
  for (const ty of ['transmissao', 'cce', 'cancelamento']) assert.ok(types.includes(ty), ty)
  assert.equal(inv1c.nfeEvents.filter((e) => e.type === 'transmissao').length, 2)
  await call(tFat, 'POST', `/sales-invoices/${nf1.id}/nfe/cce`, { correcao: 'Depois de cancelada não pode mais' }, 400)
  ok('CC-e com sequência (1, 2); cancelamento interno bloqueado para NF-e autorizada; cancelamento na SEFAZ (135) devolve estoque e títulos; histórico completo')

  // 6. Falha de comunicação: marca "erro"; a nova tentativa consulta a chave antes e não reemite
  const nf2 = await invoiceFor(custSP.id, vista.id)
  mode.auth = 'drop'
  t = await call(tFat, 'POST', `/sales-invoices/${nf2.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'erro'); assert.match(t.message, /consultar pela chave/)
  await call(tFat, 'POST', `/sales-invoices/${nf2.id}/nfe/xml`, undefined, 400)
  await call(tFat, 'POST', `/sales-invoices/${nf2.id}/cancel`, { reason: 'Tentativa de cancelar com erro pendente' }, 400)
  const key2 = t.accessKey
  const xml2 = received.auth.at(-1)
  // A SEFAZ tinha autorizado apesar da queda: a consulta devolve o protocolo
  authorized.set(key2, { digest: xml2.match(/<DigestValue>([^<]+)</)[1], cStat: '100' })
  mode.consult = 'authorized'
  const authCount = received.auth.length
  t = await call(tFat, 'POST', `/sales-invoices/${nf2.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'autorizada'); assert.equal(t.accessKey, key2); assert.equal(received.auth.length, authCount, 'não reenviou a nota')
  const proc2 = await (await request(tFat, 'GET', `/sales-invoices/${nf2.id}/nfe/xml`)).text()
  execFileSync('xmllint', ['--noout', '--schema', resolve(SCHEMAS, 'procNFe_v4.00.xsd'), '-'], { input: proc2, stdio: ['pipe', 'pipe', 'pipe'] })
  assert.match(proc2, /<indPag>0<\/indPag><tPag>01<\/tPag>/); assert.ok(!proc2.includes('<cobr>'), 'à vista sem duplicatas')
  ok('queda na transmissão → "erro"; nova tentativa consulta a chave, acha autorizada e guarda o protocolo sem reemitir')

  // 7. Erro e a chave não consta (217): reenvia o MESMO XML (mesma chave)
  mode.consult = 'notfound'
  const nf3 = await invoiceFor(custSP.id)
  mode.auth = 'drop'
  t = await call(tFat, 'POST', `/sales-invoices/${nf3.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'erro')
  const firstSent = received.auth.at(-1)
  mode.auth = 'ok'
  t = await call(tFat, 'POST', `/sales-invoices/${nf3.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'autorizada'); assert.equal(received.auth.at(-1), firstSent, 'reenviou o mesmo XML assinado')
  const ev3 = (await call(tFat, 'GET', `/sales-invoices/${nf3.id}`)).nfeEvents.map((e) => `${e.type}:${e.statusCode ?? '-'}`)
  assert.deepEqual(ev3.slice().reverse(), ['transmissao:-', 'consulta:217', 'transmissao:100'])
  ok('com "erro" e chave fora da base (217), reenvia o mesmo XML assinado; cada ida à SEFAZ fica no histórico')

  // 8. Lote assíncrono (103 → 105 → 104) e uso denegado (302)
  const nf4 = await invoiceFor(custSP.id)
  mode.auth = 'async'
  t = await call(tFat, 'POST', `/sales-invoices/${nf4.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'autorizada', JSON.stringify(t)); assert.equal(received.recibo, 2)
  const nf5 = await invoiceFor(custSP.id)
  mode.auth = 'denied'
  t = await call(tFat, 'POST', `/sales-invoices/${nf5.id}/nfe/transmit`)
  assert.equal(t.sefazStatus, 'denegada'); assert.match(t.message, /destinatário/)
  mode.auth = 'ok'
  ok('lote recebido (103) consultado pelo recibo até autorizar; uso denegado (302) marcado como denegada')

  // 9. Interestadual para não contribuinte (DIFAL) e CPF: XML válido pelos dados do cadastro
  const nf6 = await invoiceFor(custBA.id, vista.id, { freight: 0, discount: 0 })
  const gen6 = await call(tFat, 'POST', `/sales-invoices/${nf6.id}/nfe/xml`)
  assert.equal(gen6.valid, true, gen6.errors.join('\n'))
  const xml6 = await (await request(tFat, 'GET', `/sales-invoices/${nf6.id}/nfe/xml`)).text()
  assert.match(xml6, /<CPF>52998224725<\/CPF>/); assert.match(xml6, /<idDest>2<\/idDest>/); assert.match(xml6, /<indFinal>1<\/indFinal>/); assert.match(xml6, /<ICMSUFDest>/)
  checkTotals(xml6)
  ok('venda SP → BA para consumidor (CPF): idDest 2, indFinal 1, ICMSUFDest com DIFAL, XSD válido')

  // 10. Inutilização de faixa
  const numbering = await call(admin, 'GET', '/invoice-numbering')
  const row = numbering.rows.find((r) => r.companyId === company.id && r.series === 1)
  await call(tVend, 'POST', '/invoice-numbering/inutilizar', { companyId: company.id, serie: 1, inicio: 1, fim: 1, justificativa: 'Teste de permissão sem perfil' }, 403)
  await call(tFat, 'POST', '/invoice-numbering/inutilizar', { companyId: company.id, serie: 1, inicio: inv1.number, fim: inv1.number, justificativa: 'Número já usado não pode' }, 400)
  await call(tFat, 'POST', '/invoice-numbering/inutilizar', { companyId: company.id, serie: 1, inicio: 900, fim: 899, justificativa: 'Faixa invertida não pode' }, 400)
  await call(tFat, 'POST', '/invoice-numbering/inutilizar', { companyId: company.id, serie: 1, inicio: 900, fim: 905, justificativa: 'curta' }, 400)
  const inut = await call(tFat, 'POST', '/invoice-numbering/inutilizar', { companyId: company.id, serie: 1, inicio: row.nextNumber + 100, fim: row.nextNumber + 105, justificativa: 'Numeração pulada por falha no sistema' })
  assert.equal(inut.ok, true); assert.equal(inut.code, '102')
  const list = await call(tFat, 'GET', `/invoice-numbering/inutilizacoes?companyId=${company.id}`)
  assert.equal(list[0].from, row.nextNumber + 100); assert.equal(list[0].success, true)
  ok(`inutilização da faixa ${row.nextNumber + 100}–${row.nextNumber + 105} homologada (102); número já usado é recusado`)

  // 11. SEFAZ fora do ar no status
  server.close()
  await new Promise((r) => setTimeout(r, 100))
  const off = await call(tFat, 'GET', `/sefaz/status?companyId=${company.id}`)
  assert.equal(off.online, false); assert.match(off.message, /Sem resposta/)
  ok('SEFAZ fora do ar: status responde "sem resposta" sem quebrar')
} finally {
  server.close()
  await call(admin, 'PUT', '/parameters', { MV_ESPECIE: saved.MV_ESPECIE, MV_SERNFE: saved.MV_SERNFE, MV_RTCNPJ: saved.MV_RTCNPJ ?? '', MV_RTCONT: saved.MV_RTCONT ?? '', MV_RTMAIL: saved.MV_RTMAIL ?? '', MV_RTFONE: saved.MV_RTFONE ?? '' })
}
console.log(`\n${passed} verificações da NF-e passaram`)
