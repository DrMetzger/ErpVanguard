// Montagem do e-mail a partir do modelo: variáveis {{nome}}, HTML simples e tabela de itens.

export interface EmailTemplate {
  key: string; name: string; subject: string; header: string; body: string; signature: string; footer: string; showLogo: boolean
}

export interface DocItem { sku: string; name: string; unit: string; quantity: number; unitPrice: number; discountPct: number; total: number }
export interface DocData {
  values: Record<string, string> // cliente, numero, total, validade, empresa, vendedor, condicao, data, observacoes
  items: DocItem[]
  freight: number; discount: number; total: number
}

export const VARIABLES = [
  { name: 'cliente', label: 'Nome do cliente' },
  { name: 'numero', label: 'Número do documento (ORC-000123)' },
  { name: 'total', label: 'Valor total' },
  { name: 'validade', label: 'Validade do orçamento' },
  { name: 'data', label: 'Data de emissão' },
  { name: 'empresa', label: 'Nome da empresa/filial' },
  { name: 'vendedor', label: 'Nome do vendedor' },
  { name: 'condicao', label: 'Condição de pagamento' },
  { name: 'observacoes', label: 'Observações do documento' },
  { name: 'itens', label: 'Tabela de itens e totais' },
]

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
export const money = (n: number) => brl.format(n).replace(/ /g, ' ')
export const dateBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

// Só estas marcas passam no texto do modelo; o resto é mostrado como texto.
const ALLOWED = /&lt;(\/?)(b|strong|i|em|u|small|br|p|h1|h2|h3|hr)\s*\/?&gt;/gi

// Texto do modelo → HTML: escapa tudo, devolve as marcas permitidas e troca quebras de linha por <br>.
export function liteHtml(text: string) {
  return escapeHtml(text).replace(ALLOWED, (_m, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`).replace(/\r?\n/g, '<br>')
}

const TOKEN = /\{\{\s*([a-z]+)\s*\}\}/g

// Troca as variáveis. Em HTML os valores são escapados; {{itens}} vira a tabela.
function fill(text: string, doc: DocData, html: boolean) {
  return text.replace(TOKEN, (m, name: string) => {
    if (name === 'itens') return html ? '\u0000ITENS\u0000' : itemsText(doc)
    const value = doc.values[name]
    if (value === undefined) return m
    return html ? escapeHtml(value) : value
  })
}

function htmlBlock(text: string, doc: DocData) {
  // Escapa o texto do modelo antes de pôr os valores (já escapados) no lugar.
  const parts = text.split(TOKEN)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) out += liteHtml(parts[i]!)
    else out += fill(`{{${parts[i]}}}`, doc, true)
  }
  return out.replace(/\u0000ITENS\u0000/g, itemsTable(doc))
}

export function itemsTable(doc: DocData) {
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #d0d7de;font-size:12px;color:#57606a"'
  const thr = th.replace('text-align:left', 'text-align:right')
  const td = 'style="padding:6px 8px;border-bottom:1px solid #eaeef2;font-size:13px"'
  const tdr = td.replace('padding', 'text-align:right;padding')
  const rows = doc.items.map((i) =>
    `<tr><td ${td}>${escapeHtml(i.sku)}</td><td ${td}>${escapeHtml(i.name)}</td><td ${tdr}>${num.format(i.quantity)} ${escapeHtml(i.unit)}</td>` +
    `<td ${tdr}>${money(i.unitPrice)}</td><td ${tdr}>${i.discountPct ? `${num.format(i.discountPct)}%` : '-'}</td><td ${tdr}>${money(i.total)}</td></tr>`).join('')
  const sum = (label: string, value: string, bold = false) =>
    `<tr><td colspan="5" style="text-align:right;padding:4px 8px;font-size:13px${bold ? ';font-weight:700' : ''}">${label}</td><td style="text-align:right;padding:4px 8px;font-size:13px${bold ? ';font-weight:700' : ''}">${value}</td></tr>`
  const items = doc.items.reduce((s, i) => s + i.total, 0)
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:8px 0">` +
    `<thead><tr><th ${th}>Código</th><th ${th}>Produto</th><th ${thr}>Qtd.</th><th ${thr}>Preço unit.</th><th ${thr}>Desc.</th><th ${thr}>Total</th></tr></thead>` +
    `<tbody>${rows}</tbody><tfoot>${sum('Itens', money(items))}${doc.freight ? sum('Frete', money(doc.freight)) : ''}${doc.discount ? sum('Desconto', `- ${money(doc.discount)}`) : ''}${sum('Total', money(doc.total), true)}</tfoot></table>`
}

export function itemsText(doc: DocData) {
  const lines = doc.items.map((i) => `- ${i.sku} ${i.name}: ${num.format(i.quantity)} ${i.unit} x ${money(i.unitPrice)}${i.discountPct ? ` (-${num.format(i.discountPct)}%)` : ''} = ${money(i.total)}`)
  if (doc.freight) lines.push(`Frete: ${money(doc.freight)}`)
  if (doc.discount) lines.push(`Desconto: - ${money(doc.discount)}`)
  lines.push(`Total: ${money(doc.total)}`)
  return lines.join('\n')
}

// Assunto é texto puro, numa linha só.
export const renderSubject = (subject: string, doc: DocData) => fill(subject, doc, false).replace(/[\r\n]+/g, ' ').trim().slice(0, 250)

// Mensagem editável no envio: o corpo do modelo com as variáveis trocadas (texto), mantendo {{itens}}.
export const renderMessage = (body: string, doc: DocData) =>
  body.replace(TOKEN, (m, name: string) => (name === 'itens' ? m : doc.values[name] ?? m))

// E-mail completo. `logo` é o src da imagem (cid: no envio, data: na prévia).
export function renderEmail(tpl: EmailTemplate, doc: DocData, opts: { body?: string; logo?: string | null } = {}) {
  const body = opts.body ?? tpl.body
  let content = htmlBlock(body, doc)
  if (!/\{\{\s*itens\s*\}\}/.test(body)) content += itemsTable(doc)
  const header = tpl.header.trim() ? htmlBlock(tpl.header, doc) : ''
  const logo = tpl.showLogo && opts.logo ? `<img src="${escapeHtml(opts.logo)}" alt="${escapeHtml(doc.values.empresa ?? '')}" style="max-height:64px;max-width:220px;display:block">` : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>` +
    `<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2328">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:8px;border:1px solid #e1e4e8">` +
    (logo || header ? `<tr><td style="padding:20px 24px;border-bottom:1px solid #eaeef2">${logo}${header ? `<div style="margin-top:${logo ? 10 : 0}px;font-size:16px">${header}</div>` : ''}</td></tr>` : '') +
    `<tr><td style="padding:20px 24px;font-size:14px;line-height:1.5">${content}</td></tr>` +
    (tpl.signature.trim() ? `<tr><td style="padding:0 24px 20px;font-size:14px;line-height:1.5">${htmlBlock(tpl.signature, doc)}</td></tr>` : '') +
    (tpl.footer.trim() ? `<tr><td style="padding:14px 24px;border-top:1px solid #eaeef2;font-size:11px;color:#6e7781">${htmlBlock(tpl.footer, doc)}</td></tr>` : '') +
    `</table></td></tr></table></body></html>`
  // Versão texto: tira só as marcas permitidas (o resto já era texto).
  const strip = (t: string) => fill(t, doc, false).replace(/<(\/?)(b|strong|i|em|u|small|br|p|h1|h2|h3|hr)\s*\/?>/gi, '').trim()
  const text = [strip(tpl.header), strip(body) + (/\{\{\s*itens\s*\}\}/.test(body) ? '' : `\n\n${itemsText(doc)}`), strip(tpl.signature), strip(tpl.footer)].filter(Boolean).join('\n\n')
  return { subject: renderSubject(tpl.subject, doc), html, text }
}
