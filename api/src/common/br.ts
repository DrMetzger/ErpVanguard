import { validateBr } from 'js-brasil'
import { MUNICIPIOS } from '../database/data/municipios'

export interface Municipio { code: string; name: string; uf: string }

// Nome sem acento, minúsculo e sem pontuação, para comparar cidades.
export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const ALL: Municipio[] = MUNICIPIOS.split('\n').map((l) => { const [code, name, uf] = l.split('|'); return { code: code!, name: name!, uf: uf! } })
const BY_UF = new Map<string, Municipio[]>()
for (const m of ALL) BY_UF.set(m.uf, [...(BY_UF.get(m.uf) ?? []), m])
const BY_CODE = new Map(ALL.map((m) => [m.code, m]))
const BY_NAME = new Map(ALL.map((m) => [`${m.uf}|${normName(m.name)}`, m]))

export const municipiosDaUf = (uf: string) => BY_UF.get(uf.toUpperCase()) ?? []
export const municipioPorCodigo = (code: string) => BY_CODE.get(code)
export const municipioPorNome = (uf: string, name: string) => BY_NAME.get(`${uf.toUpperCase()}|${normName(name)}`)

// Inscrição estadual: "ISENTO" ou números válidos para a UF (algoritmo de cada SEFAZ).
export function ieValida(ie: string, uf: string) {
  if (ie.toUpperCase() === 'ISENTO') return true
  const d = ie.replace(/\D/g, '')
  return !!d && validateBr.inscricaoestadual(d, uf.toUpperCase())
}
