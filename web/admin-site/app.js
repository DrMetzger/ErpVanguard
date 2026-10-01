// Painel da Prime ERP (admin.erpvanguard.com.br).
// Sem innerHTML: tudo que vem do servidor entra como texto (nada de código vindo de dados).
'use strict'

const DOMAIN = 'erpvanguard.com.br'
const SHARED = [
  ['products', 'Produtos', 'C'], ['product_groups', 'Grupos de produtos', 'C'], ['customers', 'Clientes', 'C'], ['suppliers', 'Fornecedores', 'C'],
  ['price_tables', 'Tabelas de preço', 'C'], ['payment_terms', 'Condições de pagamento', 'C'], ['finance_categories', 'Naturezas financeiras', 'C'],
  ['cost_centers', 'Centros de custo', 'C'], ['bank_accounts', 'Contas bancárias', 'E'],
]
const UF = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ')
const REGIMES = [['simples', 'Simples Nacional'], ['simples_excesso', 'Simples (excesso de sublimite)'], ['mei', 'MEI'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real']]
const STATUS = { criando: ['Criando', 'warn'], ativo: ['Ativo', 'ok'], suspenso: ['Suspenso', 'warn'], erro: ['Erro', 'err'] }
const JOBS = { criar: 'Criar sistema', suspender: 'Suspender', reativar: 'Reativar', reiniciar: 'Reiniciar', atualizar: 'Atualizar versão', backup: 'Backup' }
const JOB_STATUS = { pendente: ['Na fila', 'warn'], executando: ['Executando', 'warn'], ok: ['Concluído', 'ok'], erro: ['Erro', 'err'] }

// ---------- utilidades ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return el
}
const $app = () => document.getElementById('app')
const mount = (...nodes) => { const a = $app(); a.replaceChildren(...nodes) }
const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—'
const cnpjFmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const badge = (pair) => h('span', { class: `badge ${pair[1]}` }, pair[0])

let token = null
try { token = sessionStorage.getItem('painel-token') } catch { /* sem armazenamento: entra de novo */ }
const setToken = (t) => { token = t; try { t ? sessionStorage.setItem('painel-token', t) : sessionStorage.removeItem('painel-token') } catch { /* ignora */ } }

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401 && token) { setToken(null); route(); throw new Error('Sessão encerrada: entre de novo') }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new Error(Array.isArray(data?.message) ? data.message.join('; ') : data?.message || `Erro ${res.status}`)
  return data
}

function busy(btn, fn) {
  return async (ev) => {
    ev?.preventDefault?.()
    const old = btn.textContent
    btn.disabled = true; btn.textContent = 'Aguarde…'
    try { await fn() } finally { btn.disabled = false; btn.textContent = old }
  }
}

// ---------- login (senha + código por e-mail) ----------
function loginShell(...content) {
  return h('div', { class: 'login' }, h('div', { class: 'card' },
    h('img', { class: 'logo', src: '/favicon.svg', alt: '' }), h('h1', {}, 'Painel Prime ERP'), ...content))
}

function loginView() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true })
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const msg = h('div', { class: 'err' })
  const btn = h('button', { class: 'primary full', type: 'submit' }, 'Entrar')
  const form = h('form', {}, h('label', {}, 'E-mail'), email, h('label', {}, 'Senha'), pass, msg, btn,
    h('button', { class: 'link', type: 'button', onclick: () => passwordView(email.value) }, 'Primeiro acesso ou esqueci a senha'))
  form.addEventListener('submit', busy(btn, async () => {
    msg.textContent = ''
    try {
      const r = await api('POST', '/auth/login', { email: email.value, password: pass.value })
      codeView(r.challenge, r.sentTo)
    } catch (e) { msg.textContent = e.message }
  }))
  mount(loginShell(h('p', { class: 'muted small' }, 'Acesso restrito à Prime ERP Soluções.'), form))
  email.focus()
}

function codeView(challenge, sentTo) {
  const code = h('input', { class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })
  const msg = h('div', { class: 'err' })
  const btn = h('button', { class: 'primary full', type: 'submit' }, 'Confirmar')
  const form = h('form', {}, h('p', { class: 'muted small' }, `Mandamos um código de 6 números para ${sentTo}. Vale por 10 minutos.`),
    h('label', {}, 'Código'), code, msg, btn, h('button', { class: 'link', type: 'button', onclick: loginView }, 'Voltar'))
  form.addEventListener('submit', busy(btn, async () => {
    msg.textContent = ''
    try {
      const r = await api('POST', '/auth/verify', { challenge, code: code.value.replace(/\D/g, '') })
      setToken(r.token); location.hash = '#/'; route()
    } catch (e) { msg.textContent = e.message }
  }))
  mount(loginShell(form))
  code.focus()
}

function passwordView(prefill) {
  const email = h('input', { type: 'email', value: prefill || '', required: true })
  const msg = h('div', { class: 'err' })
  const btn = h('button', { class: 'primary full', type: 'submit' }, 'Mandar código')
  const form = h('form', {}, h('p', { class: 'muted small' }, 'Informe seu e-mail. Se ele tiver acesso ao painel, chega um código para criar a senha.'),
    h('label', {}, 'E-mail'), email, msg, btn, h('button', { class: 'link', type: 'button', onclick: loginView }, 'Voltar'))
  form.addEventListener('submit', busy(btn, async () => {
    msg.textContent = ''
    try { await api('POST', '/auth/password/start', { email: email.value }); passwordFinishView(email.value) } catch (e) { msg.textContent = e.message }
  }))
  mount(loginShell(form))
  email.focus()
}

function passwordFinishView(email) {
  const code = h('input', { class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })
  const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true })
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true })
  const msg = h('div', { class: 'err' })
  const btn = h('button', { class: 'primary full', type: 'submit' }, 'Salvar senha')
  const form = h('form', {}, h('p', { class: 'muted small' }, `Se ${email} tiver acesso, o código chegou por e-mail.`),
    h('label', {}, 'Código'), code, h('label', {}, 'Nova senha (mínimo 10 caracteres)'), pass, h('label', {}, 'Repita a senha'), pass2, msg, btn,
    h('button', { class: 'link', type: 'button', onclick: loginView }, 'Voltar'))
  form.addEventListener('submit', busy(btn, async () => {
    msg.textContent = ''
    if (pass.value !== pass2.value) { msg.textContent = 'As senhas não conferem'; return }
    try {
      await api('POST', '/auth/password/finish', { email, code: code.value.replace(/\D/g, ''), password: pass.value })
      loginView()
      const ok = h('div', { class: 'okmsg' }, 'Senha salva. Entre com ela.')
      document.querySelector('form')?.prepend(ok)
    } catch (e) { msg.textContent = e.message }
  }))
  mount(loginShell(form))
  code.focus()
}

// ---------- painel ----------
let me = null
let timer = null
function stopTimer() { if (timer) { clearTimeout(timer); timer = null } }

function shell(...content) {
  const agent = h('span', { class: 'small muted' })
  api('GET', '/vps-status').then((a) => {
    agent.replaceChildren(h('span', { class: `dot ${a.online ? 'ok' : 'err'}` }),
      a.online ? `Agente da VPS ativo${a.pending ? ` · ${a.pending} na fila` : ''}` : `Agente da VPS sem resposta${a.seenAt ? ` desde ${fmt(a.seenAt)}` : ''}`)
  }).catch(() => undefined)
  return [
    h('header', { class: 'top' }, h('img', { src: '/favicon.svg', alt: '' }), h('a', { class: 'title', href: '#/' }, 'Painel Prime ERP'), agent,
      h('span', { class: 'grow' }), h('span', { class: 'small muted hide-sm' }, me?.email || ''),
      h('button', { onclick: () => { setToken(null); me = null; stopTimer(); loginView() } }, 'Sair')),
    h('main', { class: 'page' }, ...content),
  ]
}

async function listView() {
  const tbody = h('tbody', {}, h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Carregando…')))
  const updateAll = h('button', { hidden: true }, 'Atualizar todos')
  updateAll.addEventListener('click', busy(updateAll, async () => {
    if (!confirm('Atualizar todos os clientes para a versão atual? Cada um ganha um backup antes.')) return
    try { const r = await api('POST', '/tenants-update-all'); alert(`${r.queued} pedido(s) na fila`); listView() } catch (e) { alert(e.message) }
  }))
  mount(...shell(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Clientes'), updateAll, h('button', { class: 'primary', onclick: () => { location.hash = '#/novo' } }, 'Novo cliente')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', {}, 'Endereço'), h('th', {}, 'Situação'),
      h('th', { class: 'hide-sm' }, 'No ar'), h('th', { class: 'hide-sm' }, 'Versão'), h('th', { class: 'hide-sm' }, 'Criado em'))), tbody)))))
  let rows
  try { rows = await api('GET', '/tenants') } catch (e) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'err' }, e.message))); return }
  updateAll.hidden = !rows.some((t) => t.updateAvailable)
  if (!rows.length) tbody.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'Nenhum cliente ainda. Clique em "Novo cliente".')))
  else tbody.replaceChildren(...rows.map((t) => h('tr', { class: 'click', onclick: () => { location.hash = `#/cliente/${t.id}` } },
    h('td', {}, h('div', {}, t.name), h('div', { class: 'small muted' }, cnpjFmt(t.document))),
    h('td', {}, h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, `${t.slug}.${DOMAIN}`)),
    h('td', {}, badge(STATUS[t.status] || [t.status, '']), t.pendingJob ? h('div', { class: 'small muted' }, `${JOBS[t.pendingJob] || t.pendingJob}…`) : null),
    h('td', { class: 'hide-sm' }, h('span', { class: `dot ${t.online ? 'ok' : 'err'}` }), t.online ? 'Sim' : 'Não'),
    h('td', { class: 'hide-sm' }, t.updateAvailable ? badge(['Atualização disponível', 'warn']) : t.imageId ? 'Atual' : '—'),
    h('td', { class: 'hide-sm small' }, fmt(t.createdAt)))))
  stopTimer()
  if (rows.some((t) => t.pendingJob || t.status === 'criando')) timer = setTimeout(() => { if (location.hash === '#/' || location.hash === '') listView() }, 5000)
}

function field(label, input, hint) {
  return h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'small muted' }, hint) : null)
}

function newView() {
  stopTimer()
  const slug = h('input', { placeholder: 'ex.: stark', maxlength: 30, required: true, autocomplete: 'off' })
  const preview = h('span', {}, `….${DOMAIN}`)
  slug.addEventListener('input', () => { slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); preview.textContent = `${slug.value || '…'}.${DOMAIN}` })
  const name = h('input', { maxlength: 200, required: true })
  const doc = h('input', { inputmode: 'numeric', maxlength: 18, required: true, placeholder: '00.000.000/0000-00' })
  const email = h('input', { type: 'email', maxlength: 120, required: true })
  const adminName = h('input', { maxlength: 120 })
  const uf = h('select', { required: true }, h('option', { value: '' }, 'Selecione'), ...UF.map((u) => h('option', { value: u }, u)))
  const zip = h('input', { inputmode: 'numeric', maxlength: 9, required: true, placeholder: '00000-000' })
  const regime = h('select', {}, ...REGIMES.map(([v, l]) => h('option', { value: v }, l)))
  const modes = Object.fromEntries(SHARED.map(([k, , d]) => [k, h('select', {}, h('option', { value: 'C', selected: d === 'C' }, 'Compartilhado entre filiais'), h('option', { value: 'E', selected: d === 'E' }, 'Exclusivo de cada filial'))]))
  const msg = h('div', { class: 'err' })
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Criar cliente')
  const form = h('form', {},
    h('div', { class: 'card' }, h('h2', {}, 'Novo cliente'),
      h('div', { class: 'grid' },
        field('Endereço do sistema', slug, preview),
        field('Razão social', name), field('CNPJ', doc), field('Regime tributário', regime),
        field('UF', uf), field('CEP', zip),
        field('E-mail do administrador do cliente', email, 'Recebe o endereço e a senha provisória'), field('Nome do administrador', adminName))),
    h('div', { class: 'card' }, h('h3', {}, 'Cadastros entre filiais'),
      h('p', { class: 'small muted' }, 'Só dá para mudar depois enquanto o cadastro estiver vazio.'),
      h('div', { class: 'grid' }, ...SHARED.map(([k, l]) => field(l, modes[k])))),
    h('div', { class: 'card' }, h('h3', {}, 'Antes de criar'),
      h('p', { class: 'small' }, 'Crie no DNS do domínio (Hostinger) um registro:'),
      h('div', { class: 'dns' }, 'Tipo A · Nome: ', h('b', {}, '…'), ' · Valor: 187.127.44.242'),
      h('p', { class: 'small muted' }, 'O sistema é criado mesmo antes do DNS propagar; o endereço com HTTPS passa a abrir quando o DNS apontar para a VPS.'),
      msg, h('div', { class: 'row' }, btn, h('button', { type: 'button', onclick: () => { location.hash = '#/' } }, 'Cancelar'))))
  slug.addEventListener('input', () => { form.querySelector('.dns b').textContent = slug.value || '…' })
  form.addEventListener('submit', busy(btn, async () => {
    msg.textContent = ''
    try {
      const t = await api('POST', '/tenants', {
        slug: slug.value, name: name.value, document: doc.value.replace(/\D/g, ''), adminEmail: email.value, adminName: adminName.value || undefined,
        uf: uf.value, zip: zip.value.replace(/\D/g, ''), taxRegime: regime.value, modes: Object.fromEntries(Object.entries(modes).map(([k, s]) => [k, s.value])),
      })
      location.hash = `#/cliente/${t.id}`
    } catch (e) { msg.textContent = e.message }
  }))
  mount(...shell(form))
  slug.focus()
}

async function detailView(id) {
  stopTimer()
  let t
  try { t = await api('GET', `/tenants/${id}`) } catch (e) { mount(...shell(h('div', { class: 'card err' }, e.message))); return }
  const pending = t.jobs.find((j) => ['pendente', 'executando'].includes(j.status))
  const act = (action, label, confirmText, cls) => {
    const b = h('button', { class: cls, disabled: !!pending }, label)
    b.addEventListener('click', busy(b, async () => {
      if (confirmText && !confirm(confirmText)) return
      try { await api('POST', `/tenants/${id}/${action}`); detailView(id) } catch (e) { alert(e.message) }
    }))
    return b
  }
  const ready = ['ativo', 'suspenso'].includes(t.status)
  const actions = h('div', { class: 'row' },
    ready && t.status === 'ativo' ? act('suspender', 'Suspender', `Suspender ${t.name}? O sistema sai do ar até reativar (os dados ficam).`, 'danger') : null,
    ready && t.status === 'suspenso' ? act('reativar', 'Reativar') : null,
    ready && t.status === 'ativo' ? act('reiniciar', 'Reiniciar', `Reiniciar o sistema de ${t.name}? Fica fora do ar por alguns segundos.`) : null,
    ready ? act('atualizar', t.updateAvailable ? 'Atualizar versão' : 'Recriar com a versão atual', 'Atualizar o sistema do cliente? Faz um backup antes e fica fora do ar por alguns segundos.', t.updateAvailable ? 'primary' : '') : null,
    act('backup', 'Fazer backup agora'),
    ['erro', 'criando'].includes(t.status) ? act('refazer', 'Refazer criação', null, 'primary') : null)
  mount(...shell(
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, t.name), badge(STATUS[t.status] || [t.status, ''])),
      h('div', { class: 'grid small' },
        h('div', {}, h('div', { class: 'muted' }, 'Endereço'), h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, t.url)),
        h('div', {}, h('div', { class: 'muted' }, 'CNPJ'), cnpjFmt(t.document)),
        h('div', {}, h('div', { class: 'muted' }, 'Administrador'), `${t.adminName ? t.adminName + ' · ' : ''}${t.adminEmail}`),
        h('div', {}, h('div', { class: 'muted' }, 'No ar'), h('span', { class: `dot ${t.online ? 'ok' : 'err'}` }), t.online ? 'Respondendo' : 'Não responde'),
        h('div', {}, h('div', { class: 'muted' }, 'Versão'), t.updateAvailable ? 'Atualização disponível' : t.imageId ? 'Atual' : '—'),
        h('div', {}, h('div', { class: 'muted' }, 'Criado'), `${fmt(t.createdAt)} por ${t.createdBy || '—'}`)),
      t.step ? h('p', { class: 'small muted' }, `Etapa: ${t.step}`) : null,
      t.lastError ? h('p', { class: 'err' }, t.lastError) : null,
      h('div', {}, h('h3', {}, 'Ações'), actions, pending ? h('p', { class: 'small muted' }, `Pedido em andamento: ${JOBS[pending.kind] || pending.kind} (${JOB_STATUS[pending.status][0].toLowerCase()})`) : null)),
    h('div', { class: 'card' }, h('h3', {}, 'DNS'),
      h('div', { class: 'dns' }, `Tipo ${t.dnsRecord.type} · Nome: ${t.dnsRecord.name} · Valor: ${t.dnsRecord.value}`),
      h('p', { class: 'small' }, h('span', { class: `dot ${t.dnsOk ? 'ok' : 'warn'}` }),
        t.dnsOk ? 'DNS apontando para a VPS' : `DNS ainda não aponta para a VPS${t.dnsIps.length ? ` (hoje: ${t.dnsIps.join(', ')})` : ''}`)),
    h('div', { class: 'card' }, h('h3', {}, 'Pedidos ao servidor'),
      t.jobs.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Pedido'), h('th', {}, 'Situação'), h('th', {}, 'Resultado'))),
        h('tbody', {}, ...t.jobs.map((j) => h('tr', {}, h('td', { class: 'small' }, fmt(j.createdAt), h('div', { class: 'muted' }, j.requestedBy || '')),
          h('td', {}, JOBS[j.kind] || j.kind), h('td', {}, badge(JOB_STATUS[j.status] || [j.status, ''])), h('td', { class: 'small' }, j.message || '')))))) : h('p', { class: 'muted small' }, 'Nenhum.')),
    h('div', { class: 'card' }, h('h3', {}, 'Histórico'),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, ...t.events.map((e) => h('tr', {}, h('td', { class: 'small' }, fmt(e.createdAt)),
        h('td', { class: 'small' }, e.message, e.adminEmail ? h('span', { class: 'muted' }, ` · ${e.adminEmail}`) : null)))))))))
  if (pending || t.status === 'criando' || t.step) timer = setTimeout(() => { if (location.hash === `#/cliente/${id}`) detailView(id) }, 4000)
}

async function route() {
  stopTimer()
  if (!token) return loginView()
  if (!me) { try { me = await api('GET', '/me') } catch { return } }
  const hash = location.hash || '#/'
  const m = hash.match(/^#\/cliente\/([0-9a-f-]{36})$/)
  if (m) return detailView(m[1])
  if (hash === '#/novo') return newView()
  return listView()
}

window.addEventListener('hashchange', route)
route()
