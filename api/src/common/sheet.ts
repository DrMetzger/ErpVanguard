import { BadRequestException } from '@nestjs/common'
import ExcelJS from 'exceljs'

// Coluna da planilha de importação/exportação de um cadastro.
export interface SheetColumn {
  key: string
  label: string
  required?: boolean
  type: string // texto, número, data, sim/não, lista…
  help?: string
  options?: string[] // lista suspensa (valores aceitos)
  example?: string
}

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F2937' } }
const REQUIRED_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFB45309' } }

// Cabeçalho: o nome do campo; "*" marca obrigatório. A linha 2 (oculta) guarda a chave técnica de cada coluna.
function dataSheet(wb: ExcelJS.Workbook, title: string, columns: SheetColumn[], rows: unknown[][], listsSheet?: ExcelJS.Worksheet) {
  const ws = wb.addWorksheet('Dados', { views: [{ state: 'frozen', ySplit: 2 }] })
  ws.addRow(columns.map((c) => (c.required ? `${c.label} *` : c.label)))
  ws.addRow(columns.map((c) => c.key)).hidden = true
  ws.getRow(1).eachCell((cell, i) => {
    const c = columns[i - 1]!
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = c.required ? REQUIRED_FILL : HEADER_FILL
    cell.alignment = { vertical: 'middle', wrapText: true }
    if (c.help) cell.note = c.help
  })
  ws.getRow(1).height = 30
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(45, Math.max(12, c.label.length + 4, ...(c.options ?? []).map((o) => Math.min(o.length, 40)))) })
  for (const r of rows) ws.addRow(r)
  // Listas suspensas (até a linha 5000) para campos com opções.
  if (listsSheet) {
    columns.forEach((c, i) => {
      if (!c.options?.length) return
      const col = listsSheet.getColumn(i + 1)
      c.options.forEach((o, j) => { listsSheet.getCell(j + 1, i + 1).value = o })
      const letter = col.letter
      const ref = `Listas!$${letter}$1:$${letter}$${c.options.length}`
      for (let row = 3; row <= Math.max(500, rows.length + 200); row++) {
        ws.getCell(row, i + 1).dataValidation = { type: 'list', allowBlank: !c.required, formulae: [ref], showErrorMessage: true, errorTitle: c.label, error: 'Escolha um valor da lista' }
      }
    })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  void title
  return ws
}

export async function buildWorkbook(title: string, columns: SheetColumn[], rows: unknown[][] = []) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ERP Vanguard'
  wb.created = new Date()
  const lists = columns.some((c) => c.options?.length) ? wb.addWorksheet('Listas', { state: 'veryHidden' }) : undefined
  dataSheet(wb, title, columns, rows, lists)
  // Aba de instruções: um campo por linha.
  const help = wb.addWorksheet('Instruções')
  help.addRow([`Importação de ${title} — ERP Vanguard`]).font = { bold: true, size: 14 }
  help.addRow(['Preencha a aba "Dados" a partir da linha 3 (não apague as duas primeiras linhas). Colunas em laranja (*) são obrigatórias.'])
  help.addRow(['Linhas com o mesmo código/documento de um registro existente atualizam o registro; as demais são incluídas. Antes de gravar, o sistema mostra a conferência linha a linha.'])
  help.addRow([])
  const head = help.addRow(['Campo', 'Obrigatório', 'Tipo', 'Como preencher', 'Exemplo'])
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.eachCell((c) => { c.fill = HEADER_FILL })
  for (const c of columns) {
    const opts = c.options?.length ? `Um destes: ${c.options.slice(0, 30).join(' | ')}${c.options.length > 30 ? ` … (${c.options.length} opções na lista suspensa)` : ''}` : ''
    help.addRow([c.label, c.required ? 'Sim' : 'Não', c.type, [c.help, opts].filter(Boolean).join('. '), c.example ?? ''])
  }
  help.getColumn(1).width = 30; help.getColumn(2).width = 12; help.getColumn(3).width = 16; help.getColumn(4).width = 90; help.getColumn(5).width = 24
  help.getColumn(4).alignment = { wrapText: true, vertical: 'top' }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const cellValue = (v: ExcelJS.CellValue): unknown => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text
    return null
  }
  return v
}

// Lê a aba "Dados" (ou a primeira): devolve as linhas com as chaves técnicas das colunas.
// Aceita a planilha do modelo (linha 2 com chaves) ou uma planilha qualquer com os nomes dos campos no cabeçalho.
export async function readWorkbook(file: Buffer, columns: SheetColumn[]) {
  const wb = new ExcelJS.Workbook()
  try { await wb.xlsx.load(file as any) } catch { throw new BadRequestException('Arquivo inválido: envie a planilha .xlsx do modelo') }
  const ws = wb.getWorksheet('Dados') ?? wb.worksheets[0]
  if (!ws) throw new BadRequestException('Planilha vazia')
  const norm = (s: unknown) => String(s ?? '').replace(/\*/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const byLabel = new Map(columns.map((c) => [norm(c.label), c]))
  const keysRow = ws.getRow(2)
  const templateKeys = (keysRow.values as unknown[]).slice(1).map((v) => String(v ?? ''))
  const hasKeys = templateKeys.filter((k) => byKey.has(k)).length >= Math.min(2, columns.length)
  const header = hasKeys ? templateKeys : (ws.getRow(1).values as unknown[]).slice(1).map((v) => byLabel.get(norm(v))?.key ?? byKey.get(String(v ?? ''))?.key ?? '')
  if (!header.some(Boolean)) throw new BadRequestException('Não achei as colunas do cadastro: use a planilha modelo')
  const rows: { line: number; values: Record<string, unknown> }[] = []
  ws.eachRow((row, line) => {
    if (line === 1 || (hasKeys && line === 2)) return
    const values: Record<string, unknown> = {}
    header.forEach((key, i) => { if (key) { const v = cellValue(row.getCell(i + 1).value); if (v !== null && String(v).trim() !== '') values[key] = typeof v === 'string' ? v.trim() : v } })
    if (Object.keys(values).length) rows.push({ line, values })
  })
  if (rows.length > 5000) throw new BadRequestException('No máximo 5.000 linhas por importação')
  return rows
}

// Conversões comuns das células.
export const sheetBool = (v: unknown) => {
  const s = String(v).trim().toLowerCase()
  if (['sim', 's', 'yes', 'true', '1', 'x', 'verdadeiro'].includes(s)) return true
  if (['não', 'nao', 'n', 'no', 'false', '0', 'falso'].includes(s)) return false
  throw new Error('use Sim ou Não')
}
export const sheetNumber = (v: unknown) => {
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[R$\s%]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error('número inválido')
  return n
}
export const sheetDate = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  throw new Error('data inválida (use dd/mm/aaaa)')
}
// "9 · Não contribuinte" → "9"; também aceita só o código ou só o nome.
export const sheetOption = (v: unknown, options: { value: string; label: string }[]) => {
  const s = String(v).trim()
  const code = s.split(' · ')[0]!.trim()
  const hit = options.find((o) => o.value === code || o.value === s) ?? options.find((o) => o.label.toLowerCase() === s.toLowerCase())
  if (!hit) throw new Error(`opção inválida (use: ${options.map((o) => o.value).join(', ')})`)
  return hit.value
}
export const optionLabel = (o: { value: string; label: string }) => (o.label === o.value ? o.value : `${o.value} · ${o.label}`)
