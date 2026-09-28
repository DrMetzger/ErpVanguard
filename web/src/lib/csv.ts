// Baixa um CSV que o Excel abre direto (ponto e vírgula, vírgula decimal e BOM para acentos).
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const cell = (c: string | number | null | undefined) => (typeof c === 'number' ? String(c).replace('.', ',') : `"${String(c ?? '').replace(/"/g, '""')}"`)
  const text = rows.map((r) => r.map(cell).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
