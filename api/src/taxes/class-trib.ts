import type { Db } from '../common/db'

// Tabela oficial cClassTrib (Reforma Tributária: CST e classificação tributária do IBS/CBS).
// A Receita publica em CSV (Windows-1252, separador ";", textos longos entre aspas com quebra de linha).

export interface ClassTribRow {
  code: string // cClassTrib (6 dígitos)
  cst: string // CST do IBS/CBS (3 dígitos)
  cstDescription: string
  name: string
  description: string
  lcArticle: string | null // artigo da LC 214/2025
  aliquotType: string // Padrão, Fixa, Sem alíquota, Uniforme nacional, Uniforme setorial…
  pRedIbs: number
  pRedCbs: number
  flags: Record<string, boolean> // ind_gTribRegular, ind_gCredPresOper, ind_gMono…, ind_gEstornoCred
  tpRbsn: string | null
  validFrom: string | null // AAAA-MM-DD
  validTo: string | null
  sourceDate: string | null // DataAtualização da tabela
  indNfe: boolean
  indNfce: boolean
  annex: string | null
  link: string | null
}

// CSV com aspas (RFC 4180) e separador ";".
export function parseCsv(text: string, sep = ';') {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

// O arquivo da Receita vem em Windows-1252; se já estiver em UTF-8 (reaberto e salvo em outro programa), usa direto.
export function decodeCsv(buf: Buffer) {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(buf)
}

const brDate = (v: string) => { const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const pct = (v: string) => { const n = Number(v.trim().replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const clean = (v: string | undefined, max = 2000) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const FLAGS = ['ind_gTribRegular', 'ind_gCredPresOper', 'ind_gMonoPadrao', 'ind_gMonoReten', 'ind_gMonoRet', 'ind_gMonoDif', 'ind_gpBioDiferenca', 'ind_gEstornoCred']

// Lê a planilha oficial. Recusa se faltar coluna essencial; linhas com código inválido voltam em `errors`.
export function readClassTribCsv(text: string): { rows: ClassTribRow[]; errors: string[] } {
  const [head, ...lines] = parseCsv(text)
  if (!head) throw new Error('Arquivo vazio')
  const idx = new Map(head.map((h, i) => [norm(h), i]))
  const col = (name: string) => idx.get(norm(name))
  const need = ['CST-IBS/CBS', 'cClassTrib', 'Nome cClassTrib', 'Tipo de Alíquota', 'pRedIBS', 'pRedCBS']
  const missing = need.filter((n) => col(n) === undefined)
  if (missing.length) throw new Error(`Não parece a tabela cClassTrib oficial: faltam as colunas ${missing.join(', ')}`)
  const get = (r: string[], name: string) => { const i = col(name); return i === undefined ? '' : (r[i] ?? '') }
  const rows: ClassTribRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  lines.forEach((r, n) => {
    const code = get(r, 'cClassTrib').trim().padStart(6, '0')
    const cst = get(r, 'CST-IBS/CBS').trim().padStart(3, '0')
    if (!/^\d{6}$/.test(code) || !/^\d{3}$/.test(cst)) { errors.push(`Linha ${n + 2}: cClassTrib "${get(r, 'cClassTrib')}" ou CST "${get(r, 'CST-IBS/CBS')}" inválido`); return }
    if (seen.has(code)) { errors.push(`Linha ${n + 2}: cClassTrib ${code} repetido`); return }
    seen.add(code)
    rows.push({
      code, cst, cstDescription: clean(get(r, 'Descrição CST-IBS/CBS'), 250) ?? '', name: clean(get(r, 'Nome cClassTrib'), 250) ?? code,
      description: clean(get(r, 'Descrição cClassTrib')) ?? '', lcArticle: clean(get(r, 'LC 214/25'), 250),
      aliquotType: clean(get(r, 'Tipo de Alíquota'), 60) ?? '', pRedIbs: pct(get(r, 'pRedIBS')), pRedCbs: pct(get(r, 'pRedCBS')),
      flags: Object.fromEntries(FLAGS.map((f) => [f.replace(/^ind_/, ''), get(r, f).trim() === '1'])),
      tpRbsn: clean(get(r, 'tpRBSN'), 10), validFrom: brDate(get(r, 'dIniVig')), validTo: brDate(get(r, 'dFimVig')), sourceDate: brDate(get(r, 'DataAtualização')),
      indNfe: get(r, 'indNFe').trim() === '1', indNfce: get(r, 'indNFCe').trim() === '1', annex: clean(get(r, 'ANEXO'), 20), link: clean(get(r, 'Link'), 500),
    })
  })
  return { rows, errors }
}

// Grava (inclui ou atualiza pelo código). Códigos que saíram da tabela oficial não são apagados (podem estar em uso).
export async function upsertClassTrib(db: Db, rows: ClassTribRow[]) {
  let created = 0
  let updated = 0
  for (const r of rows) {
    const res = await db.query(
      `INSERT INTO class_trib (code, cst, cst_description, name, description, lc_article, aliquot_type, p_red_ibs, p_red_cbs, flags, tp_rbsn, valid_from, valid_to, source_date, ind_nfe, ind_nfce, annex, link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (code) DO UPDATE SET cst = EXCLUDED.cst, cst_description = EXCLUDED.cst_description, name = EXCLUDED.name, description = EXCLUDED.description,
         lc_article = EXCLUDED.lc_article, aliquot_type = EXCLUDED.aliquot_type, p_red_ibs = EXCLUDED.p_red_ibs, p_red_cbs = EXCLUDED.p_red_cbs, flags = EXCLUDED.flags,
         tp_rbsn = EXCLUDED.tp_rbsn, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, source_date = EXCLUDED.source_date,
         ind_nfe = EXCLUDED.ind_nfe, ind_nfce = EXCLUDED.ind_nfce, annex = EXCLUDED.annex, link = EXCLUDED.link, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [r.code, r.cst, r.cstDescription, r.name, r.description, r.lcArticle, r.aliquotType, r.pRedIbs, r.pRedCbs, JSON.stringify(r.flags), r.tpRbsn, r.validFrom, r.validTo, r.sourceDate, r.indNfe, r.indNfce, r.annex, r.link],
    )
    if (res[0]?.inserted) created++
    else updated++
  }
  return { created, updated }
}
