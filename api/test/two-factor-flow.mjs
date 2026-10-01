// Login em duas etapas (senha + código por e-mail), obrigatório por padrão.
// Rodar contra uma API SEM LOGIN_2FA=off, com SETUP_TOKEN definido e banco novo:
//   API=http://127.0.0.1:4010/api DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... SETUP_TOKEN=... node test/two-factor-flow.mjs
import assert from 'node:assert/strict'
import pg from 'pg'
import { SMTPServer } from 'smtp-server'

const API = process.env.API ?? 'http://127.0.0.1:4010/api'
const ADMIN = process.env.ADMIN_EMAIL
const PASS = process.env.ADMIN_PASSWORD
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2527)

const mails = []
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) { let d = ''; stream.on('data', (c) => { d += c }); stream.on('end', () => { mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: d.replace(/=\r?\n/g, '') }); cb() }) },
})
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r))
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function call(token, method, path, body, expect = 200, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  assert.equal(res.status, expect, `${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
async function codeFor(to, since) {
  for (let i = 0; i < 50; i++) {
    const m = mails.slice(since).find((x) => x.to.includes(to))
    if (m) return m.raw.match(/Subject:.*?(\d{6})/s)[1]
    await sleep(100)
  }
  throw new Error(`código não chegou para ${to}`)
}
const wrong = (c) => (c === '000000' ? '111111' : '000000')

let ok = 0
const check = async (name, fn) => { await fn(); ok++; console.log(`✓ ${name}`) }
try {
  await check('sem servidor de e-mail o login não entra (nada de pular o código)', async () => {
    const r = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS }, 503)
    assert.match(r.message, /código de acesso por e-mail/)
  })

  await db.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('smtp', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ host: '127.0.0.1', port: SMTP_PORT, security: 'nenhuma', fromEmail: 'erp@teste.local', fromName: 'ERP' })])

  await check('chave de configuração inicial do painel: só a certa, só antes do primeiro login', async () => {
    const r = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS }, 200, { 'X-Setup-Token': 'x'.repeat(64) })
    assert.ok(r.challenge && !r.token)
    const s = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS }, 200, { 'X-Setup-Token': process.env.SETUP_TOKEN })
    assert.ok(s.token)
    await call(s.token, 'GET', '/auth/me')
  })

  let admin
  await check('senha certa → código por e-mail; o desafio não abre nada; código errado conta tentativa', async () => {
    await call(null, 'POST', '/auth/login', { email: ADMIN, password: 'errada-123' }, 401)
    const n = mails.length
    const r = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS })
    assert.equal(r.twoFactor, true); assert.equal(r.token, undefined); assert.match(r.sentTo, /\*+@/)
    const code = await codeFor(ADMIN, n)
    await call(r.challenge, 'GET', '/auth/me', undefined, 401)
    const bad = await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code: wrong(code) }, 400)
    assert.match(bad.message, /4 tentativa/)
    const v = await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code })
    admin = v.token
    assert.equal(v.user.email, ADMIN)
    await call(admin, 'GET', '/auth/me')
    await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code }, 400) // código já usado
  })

  await check('depois do primeiro login real a chave do painel não vale mais', async () => {
    const r = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS }, 200, { 'X-Setup-Token': process.env.SETUP_TOKEN })
    assert.ok(r.challenge && !r.token)
  })

  const email = `u${Date.now()}@teste.local`
  const codeMail = `codigo.${Date.now()}@pessoal.test`
  await check('e-mail próprio para o código (definido pelo administrador)', async () => {
    const u = await call(admin, 'POST', '/users', { name: 'Usuário 2FA', email, password: 'Senha-forte-1', permissions: ['vendedor'], twoFactorEmail: codeMail }, 201)
    const list = await call(admin, 'GET', '/users')
    assert.equal(list.find((x) => x.id === u.id).twoFactorEmail, codeMail)
    const n = mails.length
    const r = await call(null, 'POST', '/auth/login', { email, password: 'Senha-forte-1' })
    const code = await codeFor(codeMail, n)
    assert.ok(!mails.slice(n).some((m) => m.to.includes(email)))
    const v = await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code })
    // usuário comum não vê o e-mail do código dos outros
    const seen = await call(v.token, 'GET', '/users')
    assert.ok(seen.every((x) => x.twoFactorEmail === undefined))
    await call(v.token, 'PUT', '/settings/security', { twoFactor: false }, 403)
  })

  await check('5 códigos errados bloqueiam aquele código', async () => {
    const n = mails.length
    const r = await call(null, 'POST', '/auth/login', { email, password: 'Senha-forte-1' })
    const code = await codeFor(codeMail, n)
    for (let i = 0; i < 5; i++) await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code: wrong(code) }, 400)
    const blocked = await call(null, 'POST', '/auth/verify', { challenge: r.challenge, code }, 400)
    assert.match(blocked.message, /Muitas tentativas/)
  })

  await check('administrador desliga e liga o código em Configurações', async () => {
    let s = await call(admin, 'PUT', '/settings/security', { twoFactor: false })
    assert.equal(s.security.twoFactor, false)
    const r = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS })
    assert.ok(r.token)
    s = await call(admin, 'PUT', '/settings/security', { twoFactor: true })
    assert.equal(s.security.twoFactor, true)
    const r2 = await call(null, 'POST', '/auth/login', { email: ADMIN, password: PASS })
    assert.ok(r2.challenge && !r2.token)
  })

  console.log(`\nLogin em duas etapas: ${ok} verificações ok`)
} finally {
  smtp.close()
  await db.end()
}
