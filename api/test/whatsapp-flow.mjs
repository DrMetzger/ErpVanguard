// WhatsApp (Meta Cloud API) contra uma API rodando e uma "Meta" de mentira (HTTP local).
// A API precisa subir com WHATSAPP_API_URL=http://127.0.0.1:3989 (só vale fora de produção).
// Uso: API=http://127.0.0.1:3996/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/whatsapp-flow.mjs
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const API = process.env.API ?? 'http://localhost:3000/api'
const PORT = Number(process.env.WA_MOCK_PORT ?? 3989)
const run = Date.now().toString(36).slice(-5).toUpperCase()
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect, headers = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await res.text()
  let data = null; try { data = JSON.parse(text) } catch { data = text }
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${text}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${text}`)
  return data
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '6')

// ── Meta de mentira ──
const PHONE_ID = '1098765432'
const sent = []; const media = []
let seq = 0
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks)
  const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.headers.authorization !== 'Bearer tok-certo') return reply(401, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } })
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === `/v23.0/${PHONE_ID}`) return reply(200, { id: PHONE_ID, display_phone_number: '+55 17 3000-0000', verified_name: 'Prime ERP', quality_rating: 'GREEN' })
  if (req.method === 'POST' && url.pathname === `/v23.0/${PHONE_ID}/media`) {
    const body = raw.toString('latin1')
    media.push({ pdf: body.includes('%PDF-'), filename: body.match(/filename="([^"]+)"/)?.[1], type: body.match(/name="type"\r\n\r\n([^\r]+)/)?.[1], size: raw.length })
    return reply(200, { id: `media-${media.length}` })
  }
  if (req.method === 'POST' && url.pathname === `/v23.0/${PHONE_ID}/messages`) {
    const msg = JSON.parse(raw.toString())
    sent.push(msg)
    if (msg.to === '5511000000000') return reply(400, { error: { message: '(#131026) Message undeliverable', code: 131026, error_data: { details: 'Recipient is not a valid WhatsApp user' } } })
    return reply(200, { messaging_product: 'whatsapp', contacts: [{ input: msg.to, wa_id: msg.to }], messages: [{ id: `wamid.${++seq}` }] })
  }
  reply(404, { error: { message: 'not found', code: 100 } })
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

console.log('WhatsApp (Meta)')
try {
  const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
  const pass = 'Senha-forte-123'
  const vend = await call(admin, 'POST', '/users', { name: 'Vend WA ' + run, email: `wa.${run}@t.com`.toLowerCase(), password: pass, permissions: ['vendedor'] })
  const tVend = (await call(null, 'POST', '/auth/login', { email: vend.email, password: pass })).token
  const saved = (await call(admin, 'GET', '/integrations')).find((i) => i.provider === 'whatsapp')

  // 1. Configuração: só admin; chaves nunca voltam abertas
  await call(tVend, 'GET', '/integrations', undefined, 403)
  await call(tVend, 'PUT', '/integrations/whatsapp', { enabled: true }, 403)
  let it = await call(admin, 'PUT', '/integrations/whatsapp', {
    enabled: true, config: { phoneNumberId: PHONE_ID, businessAccountId: '555', templateName: 'documento_erp', templateLanguage: 'pt_BR' },
    secrets: { accessToken: 'tok-errado', appSecret: 'segredo-do-app', verifyToken: 'verifica-' + run },
  })
  assert.equal(it.secrets.accessToken.set, true); assert.equal(it.secrets.accessToken.end, 'rado')
  assert.ok(!JSON.stringify(await call(admin, 'GET', '/integrations')).includes('tok-errado'), 'token não volta para a tela')
  await call(admin, 'PUT', '/integrations/whatsapp', { config: { naoExiste: 'x' } }, 400)
  ok('configuração só pelo admin; token, App Secret e verify token criptografados e mascarados (só os 4 últimos)')

  // 2. Teste de conexão
  const bad = await call(admin, 'POST', '/integrations/whatsapp/test', {}, 400)
  assert.match(bad.message, /token de acesso inválido/)
  assert.equal((await call(admin, 'GET', '/integrations')).find((i) => i.provider === 'whatsapp').status, 'erro')
  await call(admin, 'PUT', '/integrations/whatsapp', { secrets: { accessToken: 'tok-certo' } })
  const t = await call(admin, 'POST', '/integrations/whatsapp/test', { to: '(17) 99123-4567' })
  assert.equal(t.number, '+55 17 3000-0000'); assert.equal(t.name, 'Prime ERP')
  assert.deepEqual(sent.at(-1), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5517991234567', type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } })
  assert.equal((await call(admin, 'GET', '/integrations')).find((i) => i.provider === 'whatsapp').status, 'conectado')
  ok('teste: token errado explica o motivo em português; certo mostra o número/nome e manda o hello_world para (17) 99123-4567 → 5517991234567')

  // 3. Orçamento pelo WhatsApp com modelo aprovado (PDF no cabeçalho)
  const terms = await call(admin, 'GET', '/catalog/payment-terms')
  const vista = terms.find((x) => x.days === '0')
  const cust = await call(admin, 'POST', '/catalog/customers', { zip: '01001000', document: cnpj(r12()), name: 'Cliente WhatsApp ' + run, uf: 'SP', taxpayer: '9', phone: '1733334444', phone2: '17988887777' })
  const prod = await call(admin, 'POST', '/products', { sku: `WA-${run}`, name: 'Produto do zap', unit: 'UN', ncm: '84672100', salePrice: 123.45, stock: 10 })
  const quote = await call(tVend, 'POST', '/sales-quotes', { customerId: cust.id, paymentTermId: vista.id, items: [{ productId: prod.id, quantity: 2 }] })
  const draft = await call(tVend, 'GET', `/sales-quotes/${quote.id}/whatsapp`)
  assert.equal(draft.to, '5517988887777', 'usa o celular do cadastro'); assert.equal(draft.configured, true); assert.equal(draft.template, 'documento_erp')
  assert.match(draft.message, new RegExp(`o orçamento ${quote.code} da .*, total R\\$\\s?246,90`))
  const r = await call(tVend, 'POST', `/sales-quotes/${quote.id}/whatsapp`, { to: draft.to, message: 'Linha 1\nLinha 2' })
  const m = sent.at(-1)
  assert.equal(m.type, 'template'); assert.equal(m.template.name, 'documento_erp'); assert.equal(m.template.language.code, 'pt_BR')
  assert.deepEqual(m.template.components[0], { type: 'header', parameters: [{ type: 'document', document: { id: `media-${media.length}`, filename: `${quote.code}.pdf` } }] })
  assert.deepEqual(m.template.components[1], { type: 'body', parameters: [{ type: 'text', text: 'Linha 1 · Linha 2' }] })
  assert.ok(media.at(-1).pdf && media.at(-1).type === 'application/pdf' && media.at(-1).filename === `${quote.code}.pdf`, JSON.stringify(media.at(-1)))
  assert.equal(r.history[0].status, 'enviado'); assert.equal(r.history[0].externalId, m.to && r.id)
  ok(`orçamento ${quote.code}: PDF gerado e enviado no modelo aprovado (documento no cabeçalho, texto sem quebra de linha) para o celular do cliente`)

  // 4. Sem modelo: documento direto (só funciona com conversa aberta nas últimas 24 h)
  await call(admin, 'PUT', '/integrations/whatsapp', { config: { templateName: '' } })
  await call(tVend, 'POST', `/sales-quotes/${quote.id}/whatsapp`, { to: '17988887777' })
  assert.equal(sent.at(-1).type, 'document'); assert.equal(sent.at(-1).document.filename, `${quote.code}.pdf`); assert.match(sent.at(-1).document.caption, /^Segue o orçamento/)
  const fail = await call(tVend, 'POST', `/sales-quotes/${quote.id}/whatsapp`, { to: '11000000000' }, 400)
  assert.match(fail.message, /não tem WhatsApp/)
  const hist = await call(tVend, 'GET', `/sales-quotes/${quote.id}/whatsapp`)
  assert.equal(hist.history[0].status, 'erro'); assert.equal(hist.history.length, 3)
  await call(tVend, 'POST', `/sales-quotes/${quote.id}/whatsapp`, { to: '123' }, 400)
  ok('sem modelo vai como documento com legenda; número sem WhatsApp volta o motivo e fica no histórico do orçamento')

  // 5. Webhook da Meta
  const verifyToken = 'verifica-' + run
  assert.equal(await call(null, 'GET', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345`), 12345)
  await call(null, 'GET', `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`, undefined, 403)
  const wamid = r.id
  const event = (statuses, messages) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '555', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses, messages, contacts: [{ wa_id: '5517988887777', profile: { name: 'Cliente' } }] } }] }] })
  const sign = (body, secret = 'segredo-do-app') => ({ 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') })
  let body = event([{ id: wamid, status: 'read', timestamp: '1' }])
  await call(null, 'POST', '/webhooks/whatsapp', body, 200, sign(body, 'outro-segredo'))
  let log = (await call(admin, 'GET', '/integrations/logs?provider=whatsapp')).find((l) => l.externalId === wamid)
  assert.equal(log.status, 'enviado', 'assinatura errada é ignorada')
  await call(null, 'POST', '/webhooks/whatsapp', body, 200, sign(body))
  body = event([{ id: wamid, status: 'delivered', timestamp: '2' }])
  await call(null, 'POST', '/webhooks/whatsapp', body, 200, sign(body))
  log = (await call(admin, 'GET', '/integrations/logs?provider=whatsapp')).find((l) => l.externalId === wamid)
  assert.equal(log.status, 'lido', 'aviso atrasado de "entregue" não volta o status')
  body = event(undefined, [{ from: '5517988887777', id: 'wamid.in.' + run, type: 'text', text: { body: 'Recebi, obrigado!' } }])
  await call(null, 'POST', '/webhooks/whatsapp', body, 200, sign(body))
  const incoming = (await call(admin, 'GET', '/integrations/logs?provider=whatsapp')).find((l) => l.externalId === 'wamid.in.' + run)
  assert.equal(incoming.direction, 'in'); assert.equal(incoming.summary, 'Cliente: Recebi, obrigado!')
  ok('webhook: verificação com o verify token, assinatura conferida com o App Secret, enviado → lido (fora de ordem não volta) e resposta do cliente registrada')

  // 6. NF só autorizada
  await call(admin, 'GET', `/sales-invoices/00000000-0000-0000-0000-000000000000/whatsapp`, undefined, 400)
  ok('nota inexistente ou não autorizada não é enviada')

  // volta a configuração anterior do ambiente
  if (!saved?.secrets?.accessToken?.set) await call(admin, 'PUT', '/integrations/whatsapp', { enabled: false, secrets: { accessToken: '', appSecret: '', verifyToken: '' }, config: { phoneNumberId: '', businessAccountId: '', templateLanguage: '' } })
} finally {
  server.close()
}
console.log(`\n${passed} verificações passaram`)
