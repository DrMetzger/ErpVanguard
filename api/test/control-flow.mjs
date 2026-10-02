// Painel da Prime ERP + agente da VPS, de ponta a ponta com Docker de verdade.
// Pré-requisitos (ver infra/agent.sh e deploy): rede vanguard_default, vanguard-db-1, vanguard-api-1 (imagem),
// painel em 127.0.0.1:3100 com SMTP apontando para este teste (porta SMTP_PORT, padrão 2526) e o agente rodando.
//   PANEL=http://127.0.0.1:3100/api OWNER=dono@teste.local APP_DIR=/caminho/da/vps node test/control-flow.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { SMTPServer } from 'smtp-server'

const PANEL = process.env.PANEL ?? 'http://127.0.0.1:3100/api'
const OWNER = process.env.OWNER ?? 'dono@teste.local'
const APP_DIR = process.env.APP_DIR
const SLUG = process.env.SLUG ?? `t${Date.now().toString(36).slice(-6)}`
const PASSWORD = 'Senha-do-painel-123'

const mails = []
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) { let d = ''; stream.on('data', (c) => { d += c }); stream.on('end', () => { mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: d }); cb() }) },
})
await new Promise((r) => smtp.listen(Number(process.env.SMTP_PORT ?? 2526), '0.0.0.0', r))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function call(token, method, path, body, expect = 200, headers = {}) {
  const res = await fetch(`${PANEL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  assert.equal(res.status, expect, `${method} ${path}: ${res.status} ${text}`)
  try { return JSON.parse(text) } catch { return text }
}
// Texto do e-mail (quoted-printable decodificado)
const plain = (raw) => raw.replace(/=\r?\n/g, '').replace(/(=[0-9A-F]{2})+/g, (m) => Buffer.from(m.slice(1).split('=').map((x) => parseInt(x, 16))).toString())
async function waitMail(to, match, since) {
  for (let i = 0; i < 100; i++) {
    const m = mails.slice(since).find((x) => x.to.includes(to) && match.test(plain(x.raw)))
    if (m) return plain(m.raw)
    await sleep(200)
  }
  throw new Error(`e-mail para ${to} não chegou (${match})`)
}
const codeOf = (raw) => raw.match(/\b(\d{6})\b/)[1]
async function waitTenant(token, id, pred, label, secs = 240) {
  let t
  for (let i = 0; i < secs; i++) {
    t = await call(token, 'GET', `/tenants/${id}`)
    if (pred(t)) return t
    await sleep(1000)
  }
  throw new Error(`${label}: ${JSON.stringify({ status: t.status, step: t.step, err: t.lastError, jobs: t.jobs.slice(0, 2) })}`)
}
const dbExec = (...args) => execFileSync('docker', ['exec', '-i', 'vanguard-db-1', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

let ok = 0
const check = async (name, fn) => { await fn(); ok++; console.log(`✓ ${name}`) }

try {
  let token
  await check('primeiro acesso: código por e-mail e senha nova; login exige o código', async () => {
    let n = mails.length
    await call(null, 'POST', '/auth/password/start', { email: OWNER })
    await call(null, 'POST', '/auth/password/start', { email: 'ninguem@teste.local' }) // mesma resposta, sem e-mail
    const code = codeOf(await waitMail(OWNER, /definir a senha/, n))
    await call(null, 'POST', '/auth/password/finish', { email: OWNER, code, password: 'curta' }, 400)
    await call(null, 'POST', '/auth/password/finish', { email: OWNER, code, password: PASSWORD })
    await call(null, 'POST', '/auth/password/finish', { email: OWNER, code, password: PASSWORD }, 400) // código já usado
    assert.ok(!mails.some((m) => m.to.includes('ninguem@teste.local')))
    await call(null, 'POST', '/auth/login', { email: OWNER, password: 'errada-errada' }, 401)
    n = mails.length
    const { challenge } = await call(null, 'POST', '/auth/login', { email: OWNER, password: PASSWORD })
    const login = codeOf(await waitMail(OWNER, /entrar no/, n))
    await call(null, 'POST', '/auth/verify', { challenge, code: login === '000000' ? '111111' : '000000' }, 400)
    await call(null, 'GET', '/tenants', undefined, 401)
    await call(null, 'GET', '/tenants', undefined, 401, { Authorization: `Bearer ${challenge}` }) // o desafio não vale como sessão
    n = mails.length
    token = (await call(null, 'POST', '/auth/verify', { challenge, code: login })).token
    await waitMail(OWNER, /Entraram no painel/, n) // aviso de entrada
    assert.equal((await call(token, 'GET', '/me')).email, OWNER)
  })

  await check('rotas do agente: só com a senha dele e nunca vindo do Caddy', async () => {
    await call(null, 'GET', '/agent/next', undefined, 401)
    await call(token, 'GET', '/agent/next', undefined, 401) // sessão do painel não serve
    const env = readFileSync(`${APP_DIR}/.env`, 'utf8')
    const agentToken = env.match(/^AGENT_TOKEN=(.*)$/m)[1]
    await call(null, 'GET', '/agent/next', undefined, 403, { Authorization: `Bearer ${agentToken}`, 'X-Forwarded-For': '1.2.3.4' })
    await call(null, 'POST', '/agent/state', undefined, 401)
  })

  const dto = { slug: SLUG, name: 'Stark Indústrias Ltda', document: '11222333000181', adminEmail: `adm@${SLUG}.test`, adminName: 'Tony', uf: 'SP', zip: '01310100', taxRegime: 'presumido', modes: { customers: 'E', products: 'C', '"; DROP': 'C' } }
  let tenant
  await check('validações ao criar cliente', async () => {
    await call(token, 'POST', '/tenants', { ...dto, slug: 'admin' }, 400)
    await call(token, 'POST', '/tenants', { ...dto, slug: 'a;rm -rf' }, 400)
    await call(token, 'POST', '/tenants', { ...dto, slug: 'Stark' }, 400)
    await call(token, 'POST', '/tenants', { ...dto, document: '11222333000180' }, 400)
    await call(token, 'POST', '/tenants', { ...dto, adminEmail: 'a"b@x.com' }, 400)
    await call(token, 'POST', '/tenants', { ...dto, extra: 1 }, 400)
  })

  await check('cria o cliente: banco próprio, sistema no ar, matriz configurada e e-mail de acesso', async () => {
    const n = mails.length
    tenant = await call(token, 'POST', '/tenants', dto, 201)
    assert.equal(tenant.status, 'criando')
    assert.equal(tenant.jobs[0].kind, 'criar')
    await call(token, 'POST', '/tenants', dto, 400) // repetido
    await call(token, 'POST', `/tenants/${tenant.id}/backup`, undefined, 400) // um pedido por vez
    const t = await waitTenant(token, tenant.id, (x) => x.status === 'ativo' || x.status === 'erro', 'criação')
    assert.equal(t.status, 'ativo', t.lastError)
    assert.equal(t.online, true)
    const mail = await waitMail(dto.adminEmail, /O sistema da .* est. no ar/, n)
    const pass = mail.match(/Senha provis.ria: ([A-Za-z0-9]{14})/)[1]
    // A senha provisória não fica guardada no painel e não ficou arquivo dela no servidor.
    const tdir = `${APP_DIR}/tenants/${SLUG}`
    assert.deepEqual(readdirSync(tdir).sort(), ['app.env', 'shared.env'])
    const ctl = dbExec('psql', '-X', '-tA', '-U', 'vanguard', '-d', 'vanguard_control', '-c', `SELECT admin_password IS NULL AND configured FROM tenants WHERE slug = '${SLUG}'`).trim()
    assert.equal(ctl, 't')
    // Entra no sistema do cliente (rede interna) e confere a matriz e o compartilhamento.
    const js = `const a='http://localhost:3000/api';(async()=>{const r=await fetch(a+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':process.env.SETUP_TOKEN},body:JSON.stringify({email:process.argv[1],password:process.argv[2]})});const {token}=await r.json();const h={Authorization:'Bearer '+token};const c=await (await fetch(a+'/catalog/companies',{headers:h})).json();const m=await (await fetch(a+'/branch-modes',{headers:h})).json();console.log(JSON.stringify({c,m}))})()`
    // O login do cliente exige código por e-mail; aqui entra com a chave de configuração (só vale antes do 1º login real).
    const out = JSON.parse(execFileSync('docker', ['exec', `vanguard-t-${SLUG}`, 'node', '-e', js, dto.adminEmail, pass], { encoding: 'utf8' }))
    assert.equal(out.c.length, 1)
    assert.equal(out.c[0].document, dto.document)
    assert.equal(out.c[0].isHead, true)
    const modes = Object.fromEntries((Array.isArray(out.m) ? out.m : out.m.modes ?? []).map((x) => [x.table ?? x.tableName, x.mode]))
    assert.equal(modes.customers, 'E')
  })

  await check('isolamento: o banco do cliente não abre o ERP principal nem o painel', async () => {
    const env = readFileSync(`${APP_DIR}/tenants/${SLUG}/app.env`, 'utf8')
    const url = env.match(/^DATABASE_URL=(.*)$/m)[1]
    const u = new URL(url)
    const tryDb = (db) => { try { execFileSync('docker', ['exec', '-e', `PGPASSWORD=${u.password}`, 'vanguard-db-1', 'psql', '-h', '127.0.0.1', '-U', u.username, '-d', db, '-tAc', 'select 1'], { encoding: 'utf8', stdio: 'pipe' }); return true } catch { return false } }
    assert.equal(tryDb(u.pathname.slice(1)), true)
    assert.equal(tryDb('vanguard'), false)
    assert.equal(tryDb('vanguard_control'), false)
    const su = execFileSync('docker', ['exec', '-e', `PGPASSWORD=${u.password}`, 'vanguard-db-1', 'psql', '-h', '127.0.0.1', '-U', u.username, '-d', u.pathname.slice(1), '-tAc', 'select rolsuper or rolcreatedb or rolcreaterole from pg_roles where rolname = current_user'], { encoding: 'utf8' }).trim()
    assert.equal(su, 'f')
    // Sistema do cliente sem privilégios extras
    const insp = JSON.parse(execFileSync('docker', ['inspect', `vanguard-t-${SLUG}`], { encoding: 'utf8' }))[0]
    assert.deepEqual(insp.HostConfig.CapDrop, ['ALL'])
    assert.ok(insp.HostConfig.SecurityOpt.includes('no-new-privileges'))
    assert.ok(insp.HostConfig.Memory > 0)
  })

  await check('certificado HTTPS só para cliente cadastrado', async () => {
    assert.equal((await fetch(`${PANEL}/tls-check?domain=${SLUG}.erpvanguard.com.br`)).status, 200)
    assert.equal((await fetch(`${PANEL}/tls-check?domain=admin.erpvanguard.com.br`)).status, 200)
    assert.equal((await fetch(`${PANEL}/tls-check?domain=naoexiste.erpvanguard.com.br`)).status, 403)
    assert.equal((await fetch(`${PANEL}/tls-check?domain=${SLUG}.outrodominio.com`)).status, 403)
  })

  const id = () => tenant.id
  const doneJob = (kind) => (t) => t.jobs[0]?.kind === kind && ['ok', 'erro'].includes(t.jobs[0].status)
  await check('suspender, reativar, reiniciar, backup e atualizar (pela fila do agente)', async () => {
    await call(token, 'POST', `/tenants/${id()}/excluir`, undefined, 400) // não existe pelo painel
    await call(token, 'POST', `/tenants/${id()}/suspender`)
    let t = await waitTenant(token, id(), doneJob('suspender'), 'suspender', 60)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message); assert.equal(t.status, 'suspenso'); assert.equal(t.online, false)
    await call(token, 'POST', `/tenants/${id()}/reiniciar`, undefined, 400)
    await call(token, 'POST', `/tenants/${id()}/reativar`)
    t = await waitTenant(token, id(), doneJob('reativar'), 'reativar', 120)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message); assert.equal(t.status, 'ativo'); assert.equal(t.online, true)
    await call(token, 'POST', `/tenants/${id()}/reiniciar`)
    t = await waitTenant(token, id(), doneJob('reiniciar'), 'reiniciar', 120)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message)
    await call(token, 'POST', `/tenants/${id()}/backup`)
    t = await waitTenant(token, id(), doneJob('backup'), 'backup', 60)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message)
    assert.ok(readdirSync(`${APP_DIR}/backups/clientes/${SLUG}`).some((f) => f.endsWith('-manual.dump')))
    await call(token, 'POST', `/tenants/${id()}/atualizar`)
    t = await waitTenant(token, id(), doneJob('atualizar'), 'atualizar', 180)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message); assert.equal(t.online, true)
    assert.ok(readdirSync(`${APP_DIR}/backups/clientes/${SLUG}`).some((f) => f.endsWith('-antes-atualizar.dump')))
    const env = execFileSync('docker', ['inspect', '-f', '{{json .Config.Env}}', `vanguard-t-${SLUG}`], { encoding: 'utf8' })
    assert.ok(!env.includes('ADMIN_PASSWORD'), 'senha provisória não volta ao recriar')
  })

  await check('bloquear e desbloquear o acesso do cliente (fatura em aberto)', async () => {
    const tryLogin = () => JSON.parse(execFileSync('docker', ['exec', `vanguard-t-${SLUG}`, 'node', '-e',
      `fetch('http://localhost:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'x@y.com',password:'z'})}).then(async r=>console.log(JSON.stringify({s:r.status,b:await r.json()})))`], { encoding: 'utf8' }))
    assert.equal(tryLogin().s, 401) // liberado: só recusa a senha errada
    await call(token, 'POST', `/tenants/${id()}/desbloquear`, undefined, 400) // não está bloqueado
    await call(token, 'POST', `/tenants/${id()}/bloquear`)
    let t = await waitTenant(token, id(), doneJob('bloquear'), 'bloquear', 60)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message); assert.equal(t.blocked, true)
    await sleep(11_000) // o sistema do cliente relê o bloqueio a cada 10 s
    const blocked = tryLogin()
    assert.equal(blocked.s, 403); assert.equal(blocked.b.code, 'ACCESS_BLOCKED')
    assert.match(blocked.b.message, /Seu acesso encontra-se desativado\. Favor contactar a equipe de suporte pelo e-mail kleber\.farias@primeerp\.com\.br/)
    assert.equal(t.online, true) // continua no ar (health), só o acesso fica bloqueado
    await call(token, 'POST', `/tenants/${id()}/desbloquear`)
    t = await waitTenant(token, id(), doneJob('desbloquear'), 'desbloquear', 60)
    assert.equal(t.jobs[0].status, 'ok', t.jobs[0].message); assert.equal(t.blocked, false)
    await sleep(11_000)
    assert.equal(tryLogin().s, 401)
  })

  await check('agente recusa pedido adulterado direto no banco do painel', async () => {
    const evil = `x$(touch /tmp/hacked-${SLUG})`
    dbExec('psql', '-X', '-q', '-U', 'vanguard', '-d', 'vanguard_control', '-c',
      `WITH t AS (INSERT INTO tenants (slug, name, document, admin_email, status) VALUES ('${evil.replace(/'/g, "''")}', 'Mal', '11222333000181', 'a@b.c', 'ativo') RETURNING id)
       INSERT INTO agent_jobs (tenant_id, kind) SELECT id, 'backup' FROM t`)
    let st = ''
    for (let i = 0; i < 30 && !['ok', 'erro'].includes(st); i++) {
      await sleep(1000)
      st = dbExec('psql', '-X', '-tA', '-U', 'vanguard', '-d', 'vanguard_control', '-c', `SELECT j.status || ' ' || coalesce(j.message,'') FROM agent_jobs j JOIN tenants t ON t.id = j.tenant_id WHERE t.slug = '${evil.replace(/'/g, "''")}'`).trim().split(' ')[0]
    }
    assert.equal(st, 'erro')
    assert.equal(existsSync(`/tmp/hacked-${SLUG}`), false)
    dbExec('psql', '-X', '-q', '-U', 'vanguard', '-d', 'vanguard_control', '-c', `DELETE FROM tenants WHERE slug = '${evil.replace(/'/g, "''")}'`)
  })

  await check('lista mostra o cliente no ar e o agente ativo', async () => {
    const list = await call(token, 'GET', '/tenants')
    const t = list.find((x) => x.slug === SLUG)
    assert.equal(t.status, 'ativo'); assert.equal(t.online, true); assert.equal(t.updateAvailable, false)
    const a = await call(token, 'GET', '/vps-status')
    assert.equal(a.online, true)
  })

  console.log(`\nPainel + agente: ${ok} verificações ok (cliente ${SLUG})`)
} finally {
  smtp.close()
}
