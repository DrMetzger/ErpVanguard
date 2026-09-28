import { useEffect } from 'react'

// No celular as tabelas viram cartões (CSS em global.css); aqui cada célula ganha o nome da coluna (data-label).
function labelTable(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1]
  if (!headRow) return
  const labels: string[] = []
  for (const th of Array.from(headRow.cells)) for (let i = 0; i < (th.colSpan || 1); i++) labels.push(th.textContent?.trim() ?? '')
  for (const body of Array.from(table.tBodies).concat(table.tFoot ? [table.tFoot as HTMLTableSectionElement] : [])) {
    for (const tr of Array.from(body.rows)) {
      let col = 0
      for (const td of Array.from(tr.cells)) {
        const label = td.colSpan > 1 && td.colSpan >= labels.length - 1 ? '' : labels[col] ?? ''
        if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label)
        col += td.colSpan || 1
      }
    }
  }
}

export function ResponsiveTables() {
  useEffect(() => {
    let frame = 0
    const run = () => { frame = 0; document.querySelectorAll<HTMLTableElement>('table.mantine-Table-table').forEach(labelTable) }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run) }
    run()
    const obs = new MutationObserver(schedule)
    obs.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { obs.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [])
  return null
}
