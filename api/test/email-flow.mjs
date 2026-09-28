// Teste de ponta a ponta do envio de orçamento por e-mail, com um servidor SMTP local que guarda as mensagens.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/email-flow.mjs
// (a API precisa alcançar 127.0.0.1:SMTP_TEST_PORT, padrão 2599)
import assert from 'node:assert/strict'
import { SMTPServer } from 'smtp-server'

const API = process.env.API ?? 'http://localhost:3000/api'
const IE = { ES: '082560013', AM: '043413412', MS: '283115947', AC: '0100482300112', AL: '240000048', AP: '030123459', BA: '12345663', CE: '060000015', DF: '0730000100109', GO: '109876547', MA: '120000385', MT: '00130000019', MG: '0623079040081', PA: '159999995', PB: '060000015', PR: '1234567850', PE: '032141840', PI: '012345679', RJ: '99999993', RN: '200400401', RS: '2243658792', RO: '00000000625213', RR: '240066281', SC: '251040852', SP: '110042490114', SE: '271234563', TO: '29010227836' } // exemplos válidos das SEFAZ
const PORT = Number(process.env.SMTP_TEST_PORT ?? 2599)
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
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '4')

// --- MIME mínimo: cabeçalhos, partes multipart e decodificação ---
const decodeWords = (s) => s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_m, _cs, enc, text) =>
  enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8')
    : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'))
function parse(raw) {
  const i = raw.search(/\r?\n\r?\n/)
  const head = raw.slice(0, i).replace(/\r?\n[ \t]+/g, ' ')
  const body = raw.slice(i).replace(/^\r?\n\r?\n/, '')
  const headers = {}
  for (const line of head.split(/\r?\n/)) { const k = line.indexOf(':'); if (k > 0) headers[line.slice(0, k).toLowerCase()] = line.slice(k + 1).trim() }
  const type = headers['content-type'] ?? 'text/plain'
  const boundary = type.match(/boundary="?([^";]+)"?/)?.[1]
  if (boundary) return { headers, parts: body.split(`--${boundary}`).slice(1, -1).map((p) => parse(p.replace(/^\r?\n/, ''))) }
  const enc = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase()
  let content = body
  if (enc === 'base64') content = Buffer.from(body.replace(/\s/g, ''), 'base64')
  else if (enc === 'quoted-printable') content = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
  return { headers, content }
}
const flat = (node) => (node.parts ? node.parts.flatMap(flat) : [node])

const inbox = []
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['STARTTLS'], logger: false,
  onAuth: (auth, _s, cb) => (auth.username === 'vendas@teste.local' && auth.password === 'Senha-SMTP-987' ? cb(null, { user: auth.username }) : cb(new Error('Senha inválida'))),
  onData(stream, session, cb) {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => { inbox.push({ envelope: session.envelope, user: session.user, raw: Buffer.concat(chunks).toString('latin1') }); cb() })
  },
})
await new Promise((resolve) => smtp.listen(PORT, '127.0.0.1', resolve))
const nextMail = async () => { for (let i = 0; i < 50 && !inbox.length; i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(inbox.length, 'e-mail chegou no SMTP local'); return inbox.shift() }

try {
  console.log('Envio de orçamento por e-mail')
  const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
  const pass = 'Senha-forte-123'
  const user = async (name, permissions) => {
    const u = await call(admin, 'POST', '/users', { name: `${name} ${run}`, email: `${name.toLowerCase()}.${run}@t.com`.toLowerCase(), password: pass, permissions })
    return (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
  }
  const tVend = await user('Vendedor', ['vendedor'])
  const tVend2 = await user('Outro', ['vendedor'])
  const tFin = await user('Financeiro', ['financeiro'])

  // Carga: matriz com logo, cliente com nome "perigoso", produto e orçamento
  let companies = (await call(admin, 'GET', '/catalog/companies')).filter((c) => c.active)
  if (!companies.some((c) => c.isHead)) await call(admin, 'POST', '/catalog/companies', { code: String(1000 + Math.floor(Math.random() * 9000)), isHead: true, document: cnpj(r12()), name: 'Matriz ' + run, uf: 'SP' })
  const head = await call(admin, 'GET', '/companies/branding')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  await call(admin, 'PUT', `/companies/${head.id}/logo`, { logo: `data:image/png;base64,${png}` })
  const custName = `Cliente <script>alert(1)</script> & Filhos ${run}`
  const cust = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: custName, uf: head.uf, taxpayer: '1', ie: IE[head.uf], email: `compras.${run.toLowerCase()}@cliente.test` })
  const prod = await call(admin, 'POST', '/products', { sku: `EM-${run}`, name: 'Serra <circular> 7"', unit: 'UN', costPrice: 100, salePrice: 250, stock: 10 })
  const terms = await call(admin, 'GET', '/catalog/payment-terms')
  const quote = await call(tVend, 'POST', '/sales-quotes', { customerId: cust.id, paymentTermId: terms[0].id, items: [{ productId: prod.id, quantity: 2 }] })
  ok(`carga: logo na matriz, cliente com HTML no nome e orçamento ${quote.code}`)

  // Sem SMTP: erro claro apontando para a tela de configurações
  const draft0 = await call(tVend, 'GET', `/sales-quotes/${quote.id}/email`)
  const before = (await call(admin, 'GET', '/settings')).smtp
  if (!before.configured) {
    assert.equal(draft0.smtpConfigured, false)
    const err = await call(tVend, 'POST', `/sales-quotes/${quote.id}/email`, { to: ['x@y.test'] }, 400)
    assert.match(err.message, /Administração › Configurações/)
    ok('sem SMTP configurado o envio falha com erro claro (Administração › Configurações)')
  }

  // Configuração do SMTP: só admin, senha nunca volta inteira
  const smtpBody = { host: '127.0.0.1', port: PORT, security: 'nenhuma', user: 'vendas@teste.local', password: 'Senha-SMTP-987', fromName: 'Vendas Vanguard', fromEmail: 'vendas@teste.local', replyTo: 'comercial@teste.local' }
  await call(tVend, 'PUT', '/settings/smtp', smtpBody, 403)
  await call(admin, 'PUT', '/settings/smtp', { ...smtpBody, fromEmail: 'não-é-email' }, 400)
  let settings = await call(admin, 'PUT', '/settings/smtp', smtpBody)
  assert.equal(settings.smtp.configured, true); assert.equal(settings.smtp.source, 'tela'); assert.equal(settings.smtp.host, '127.0.0.1')
  assert.ok(!JSON.stringify(settings).includes('Senha-SMTP-987'), 'senha não volta')
  assert.ok(settings.smtp.passwordHint)
  // Salvar sem senha mantém a senha
  settings = await call(admin, 'PUT', '/settings/smtp', { ...smtpBody, password: undefined })
  assert.ok(settings.smtp.passwordHint)
  ok('SMTP salvo (só admin), senha criptografada e mascarada, mantida quando o campo vem vazio')

  await call(tVend, 'POST', '/settings/smtp/test', {}, 403)
  const test = await call(admin, 'POST', '/settings/smtp/test', { to: 'teste@destino.test' })
  assert.equal(test.to, 'teste@destino.test')
  let mail = await nextMail()
  assert.equal(mail.user, 'vendas@teste.local', 'autenticou com usuário e senha')
  assert.deepEqual(mail.envelope.rcptTo.map((r) => r.address), ['teste@destino.test'])
  assert.match(decodeWords(parse(mail.raw).headers.subject), /Teste de e-mail/)
  ok('e-mail de teste chegou com autenticação')

  // Modelo: só admin edita; prévia escapa dados do cliente
  await call(tVend, 'GET', '/email-templates', undefined, 403)
  const { templates, variables } = await call(admin, 'GET', '/email-templates')
  assert.ok(templates.some((t) => t.key === 'quote' && t.name === 'Orçamento para o cliente'))
  assert.ok(templates.some((t) => t.key === 'order'))
  assert.ok(['cliente', 'numero', 'total', 'validade', 'empresa', 'vendedor', 'itens'].every((v) => variables.some((x) => x.name === v)))
  const tpl = {
    subject: 'Proposta {{numero}} para {{cliente}}',
    header: '<b>{{empresa}}</b> <script>x</script>',
    body: 'Prezado(a) {{cliente}},\n\nSegue a proposta {{numero}} no valor de {{total}}, válida até {{validade}}.\n{{itens}}\nAtendido por {{vendedor}}.',
    signature: 'Abraço,\n<i>{{vendedor}}</i>',
    footer: 'Rodapé {{empresa}} ' + run,
    showLogo: true,
  }
  await call(tVend, 'PUT', '/email-templates/quote', tpl, 403)
  await call(admin, 'PUT', '/email-templates/nada', tpl, 400)
  const saved = await call(admin, 'PUT', '/email-templates/quote', tpl)
  assert.equal(saved.subject, tpl.subject)
  const preview = await call(admin, 'POST', '/email-templates/quote/preview', tpl)
  assert.ok(preview.html.includes('Construtora Exemplo &lt;Ltda&gt; &amp; Cia'), 'prévia escapa o cliente de exemplo')
  assert.ok(preview.html.includes('&lt;script&gt;x&lt;/script&gt;') && !preview.html.includes('<script>'), 'marcas fora da lista não passam')
  assert.ok(preview.html.includes('<i>') && preview.html.includes('data:image/png;base64'), 'marcas simples e logo na prévia')
  ok('modelo "Orçamento para o cliente" editado (só admin) com prévia; HTML fora da lista é escapado')

  // Rascunho do envio: e-mail do cadastro e texto do modelo
  const draft = await call(tVend, 'GET', `/sales-quotes/${quote.id}/email`)
  assert.equal(draft.smtpConfigured, true)
  assert.deepEqual(draft.to, [cust.email])
  assert.equal(draft.subject, `Proposta ${quote.code} para ${custName}`)
  assert.ok(draft.message.includes(`Prezado(a) ${custName}`) && draft.message.includes('{{itens}}'))
  await call(tVend2, 'GET', `/sales-quotes/${quote.id}/email`, undefined, 404)
  await call(tFin, 'POST', `/sales-quotes/${quote.id}/email`, { to: [cust.email] }, 403)
  await call(tVend2, 'POST', `/sales-quotes/${quote.id}/email`, { to: [cust.email] }, 404)
  await call(tVend, 'POST', `/sales-quotes/${quote.id}/email`, { to: ['inválido'] }, 400)
  ok('rascunho com o e-mail do cadastro, assunto e mensagem do modelo; outro vendedor e financeiro não enviam')

  // Envio com cópia, usando o modelo salvo
  const sent = await call(tVend, 'POST', `/sales-quotes/${quote.id}/email`, { to: [cust.email], cc: ['gerente@cliente.test'] })
  assert.equal(sent.history[0].status, 'enviado')
  mail = await nextMail()
  assert.deepEqual(mail.envelope.rcptTo.map((r) => r.address).sort(), [cust.email, 'gerente@cliente.test'].sort())
  const msg = parse(mail.raw)
  assert.equal(decodeWords(msg.headers.subject), `Proposta ${quote.code} para ${custName}`)
  assert.match(msg.headers.to, new RegExp(cust.email.replace(/\./g, '\\.')))
  assert.match(msg.headers.cc, /gerente@cliente\.test/)
  assert.match(decodeWords(msg.headers.from), /Vendas Vanguard.*vendas@teste\.local/)
  assert.match(msg.headers['reply-to'], /comercial@teste\.local/)
  const parts = flat(msg)
  const html = parts.find((p) => /text\/html/.test(p.headers['content-type'])).content.toString('utf8')
  const text = parts.find((p) => /text\/plain/.test(p.headers['content-type'])).content.toString('utf8')
  const logo = parts.find((p) => /image\/png/.test(p.headers['content-type']))
  const safeName = `Cliente &lt;script&gt;alert(1)&lt;/script&gt; &amp; Filhos ${run}`
  assert.ok(html.includes(`Prezado(a) ${safeName}`), 'cliente escapado no corpo')
  assert.ok(!html.includes('<script>'), 'nenhum <script> no HTML')
  assert.ok(html.includes(`proposta ${quote.code}`) && html.includes('R$ 500,00'), 'número e total')
  assert.ok(html.includes('Serra &lt;circular&gt; 7&quot;'), 'tabela de itens com o produto escapado')
  assert.ok(html.includes(`<i>Vendedor ${run}</i>`), 'assinatura com o vendedor')
  assert.ok(html.includes(`Rodapé `) && html.includes(run), 'rodapé')
  assert.ok(!html.includes('{{'), 'todas as variáveis trocadas')
  assert.ok(html.includes('src="cid:logo@erpvanguard"'), 'logo referenciado por CID')
  assert.ok(logo && /logo@erpvanguard/.test(logo.headers['content-id']) && logo.content.toString('base64') === png, 'logo anexado inline')
  assert.ok(text.includes(`Prezado(a) ${custName}`) && text.includes('Total: R$ 500,00'), 'versão texto')
  ok('e-mail chegou: assunto, destinatário, cópia, variáveis trocadas, cliente escapado, itens, assinatura e logo inline (CID)')

  // Assunto e mensagem editados no modal
  await call(tVend, 'POST', `/sales-quotes/${quote.id}/email`, { to: [cust.email], subject: 'Revisão {{numero}}', message: 'Olá <b>{{cliente}}</b>, segue a revisão.' })
  mail = await nextMail()
  const msg2 = parse(mail.raw)
  const html2 = flat(msg2).find((p) => /text\/html/.test(p.headers['content-type'])).content.toString('utf8')
  assert.equal(decodeWords(msg2.headers.subject), `Revisão ${quote.code}`)
  assert.ok(html2.includes(`Olá <b>${safeName}</b>, segue a revisão.`), 'mensagem editada com variável escapada')
  assert.ok(html2.includes('Serra &lt;circular&gt;'), 'sem {{itens}} a tabela entra no fim')
  ok('assunto e mensagem editados no envio; tabela de itens incluída automaticamente')

  // Falha do servidor fica no histórico
  await call(admin, 'PUT', '/settings/smtp', { ...smtpBody, password: 'Senha-errada-000' })
  const fail = await call(tVend, 'POST', `/sales-quotes/${quote.id}/email`, { to: [cust.email] }, 503)
  assert.match(fail.message, /servidor de e-mail/)
  const loaded = await call(tVend, 'GET', `/sales-quotes/${quote.id}`)
  assert.equal(loaded.emails.length, 3)
  assert.equal(loaded.emails[0].status, 'erro'); assert.ok(loaded.emails[0].error)
  assert.equal(loaded.emails[1].status, 'enviado'); assert.equal(loaded.emails[1].userName, `Vendedor ${run}`)
  assert.equal(loaded.emails[2].cc, 'gerente@cliente.test')
  await call(admin, 'PUT', '/settings/smtp', smtpBody)
  ok('envio recusado pelo servidor volta erro 503 e fica no histórico do orçamento (data, destinatário, usuário, situação)')

  // Pedido de venda usa o modelo "Pedido de venda"
  const order = await call(tVend, 'POST', `/sales-quotes/${quote.id}/win`)
  const orderDraft = await call(tVend, 'GET', `/sales-orders/${order.id}/email`)
  assert.equal(orderDraft.template, 'Pedido de venda')
  assert.ok(orderDraft.subject.includes(order.code))
  await call(tVend, 'POST', `/sales-orders/${order.id}/email`, { to: [cust.email] })
  mail = await nextMail()
  assert.ok(decodeWords(parse(mail.raw).headers.subject).includes(order.code))
  ok(`pedido ${order.code} enviado com o modelo "Pedido de venda"`)

  console.log(`\n${passed} verificações de e-mail passaram`)
} finally {
  smtp.close()
}
