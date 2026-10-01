// PDF do orçamento ou do pedido de venda (enviado ao cliente pelo WhatsApp).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: any = require('pdfkit')

export interface DocPdfInput {
  title: string // "Orçamento ORC-000005"
  company: { name: string; document?: string | null; address?: string | null; phone?: string | null; email?: string | null; logo?: string | null }
  customer: { name: string; document?: string | null; address?: string | null }
  info: [string, string][] // data, validade, condição, vendedor…
  items: { sku: string; name: string; unit: string; quantity: number; unitPrice: number; discountPct: number; total: number }[]
  freight: number; discount: number; total: number; ipi?: number; st?: number
  notes?: string | null
}

const brl = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const phone = (p: string | null | undefined) => {
  const s = String(p ?? '').replace(/\D/g, '')
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return p ?? ''
}
const doc = (d: string | null | undefined) => {
  const s = String(d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d ?? ''
}

export function buildDocPdf(input: DocPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: input.title, Producer: 'ERP Vanguard' } })
    const chunks: Buffer[] = []
    pdf.on('data', (c: Buffer) => chunks.push(c))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
    const left = 40, right = 555, width = right - left

    // Cabeçalho: logo + empresa
    let x = left
    const m = String(input.company.logo ?? '').match(/^data:image\/(png|jpe?g);base64,(.+)$/)
    if (m) { try { pdf.image(Buffer.from(m[2]!, 'base64'), left, 40, { fit: [90, 50] }); x = left + 100 } catch { /* logo inválida: segue sem */ } }
    pdf.font('Helvetica-Bold').fontSize(13).text(input.company.name, x, 42, { width: right - x })
    pdf.font('Helvetica').fontSize(8.5).fillColor('#444')
    const companyLines = [input.company.document ? `CNPJ ${doc(input.company.document)}` : '', input.company.address ?? '', [phone(input.company.phone), input.company.email].filter(Boolean).join(' · ')].filter(Boolean)
    pdf.text(companyLines.join('\n'), x, pdf.y + 2, { width: right - x })
    pdf.fillColor('#000')
    let y = Math.max(pdf.y, 95) + 8
    pdf.moveTo(left, y).lineTo(right, y).strokeColor('#bbb').stroke()

    // Título e dados
    pdf.font('Helvetica-Bold').fontSize(15).text(input.title, left, y + 10)
    y = pdf.y + 6
    pdf.font('Helvetica-Bold').fontSize(9).text('Cliente', left, y)
    pdf.font('Helvetica').text([input.customer.name, input.customer.document ? doc(input.customer.document) : '', input.customer.address ?? ''].filter(Boolean).join('\n'), left, pdf.y, { width: width / 2 - 10 })
    const infoTop = y
    let iy = infoTop
    for (const [k, v] of input.info.filter(([, v]) => v)) {
      pdf.font('Helvetica-Bold').text(`${k}: `, left + width / 2, iy, { continued: true }).font('Helvetica').text(v)
      iy = pdf.y
    }
    y = Math.max(pdf.y, iy) + 12

    // Itens
    const cols = [
      { label: 'Código', w: 70, align: 'left' }, { label: 'Descrição', w: 190, align: 'left' }, { label: 'Un', w: 30, align: 'left' },
      { label: 'Qtd', w: 45, align: 'right' }, { label: 'Preço', w: 65, align: 'right' }, { label: 'Desc.', w: 40, align: 'right' }, { label: 'Total', w: 75, align: 'right' },
    ]
    const header = () => {
      pdf.rect(left, y, width, 18).fill('#eee').fillColor('#000')
      let cx = left + 4
      pdf.font('Helvetica-Bold').fontSize(8.5)
      for (const c of cols) { pdf.text(c.label, cx, y + 5, { width: c.w - 6, align: c.align }); cx += c.w }
      y += 20
    }
    header()
    pdf.font('Helvetica').fontSize(8.5)
    for (const it of input.items) {
      const vals = [it.sku, it.name, it.unit, num(it.quantity), brl(it.unitPrice), it.discountPct ? `${num(it.discountPct)}%` : '', brl(it.total)]
      const h = Math.max(14, pdf.heightOfString(it.name, { width: cols[1]!.w - 6 }) + 4)
      if (y + h > 760) { pdf.addPage(); y = 40; header(); pdf.font('Helvetica').fontSize(8.5) }
      let cx = left + 4
      vals.forEach((v, i) => { pdf.text(v, cx, y + 2, { width: cols[i]!.w - 6, align: cols[i]!.align }); cx += cols[i]!.w })
      y += h
      pdf.moveTo(left, y).lineTo(right, y).strokeColor('#e3e3e3').stroke()
    }

    // Totais
    const products = input.items.reduce((s, i) => s + i.total, 0)
    const totals: [string, number][] = [['Produtos', products]]
    if (input.discount) totals.push(['Desconto', -input.discount])
    if (input.freight) totals.push(['Frete', input.freight])
    if (input.ipi) totals.push(['IPI', input.ipi])
    if (input.st) totals.push(['ICMS-ST', input.st])
    if (y + 20 * (totals.length + 1) > 780) { pdf.addPage(); y = 40 }
    y += 8
    for (const [k, v] of totals) {
      pdf.font('Helvetica').fontSize(9).text(k, right - 220, y, { width: 120, align: 'right' }).text(brl(v), right - 95, y, { width: 95, align: 'right' })
      y += 14
    }
    pdf.font('Helvetica-Bold').fontSize(12).text('Total', right - 220, y + 2, { width: 120, align: 'right' }).text(brl(input.total), right - 120, y + 2, { width: 120, align: 'right' })
    y += 24
    if (input.notes) {
      pdf.font('Helvetica-Bold').fontSize(9).text('Observações', left, y)
      pdf.font('Helvetica').text(input.notes, left, pdf.y, { width })
    }
    pdf.page.margins.bottom = 0 // o rodapé fica abaixo da margem sem abrir página nova
    pdf.fontSize(7).fillColor('#888').text('Gerado pelo ERP Vanguard', left, 805, { width, align: 'center' })
    pdf.end()
  })
}
