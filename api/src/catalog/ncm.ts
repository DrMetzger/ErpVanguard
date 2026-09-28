import { Logger } from '@nestjs/common'
import { one, type Db } from '../common/db'
import { generateJson, type GeminiOptions } from '../purchasing/gemini'

const logger = new Logger('NCM')
const MAX_DESCRIPTION = 250
export const pendingDescription = (code: string) => `NCM ${code} (descrição pendente)`

export interface NcmInfo { description: string; ipiRate: number | null }

// Pede ao Gemini a descrição oficial (TIPI/NCM do Mercosul) e a alíquota de IPI; confere a resposta.
export async function describeNcm(code: string, opts: GeminiOptions): Promise<NcmInfo | null> {
  if (!/^\d{8}$/.test(code) || !opts.apiKey) return null
  const prompt = `Você é um especialista em classificação fiscal brasileira.
Informe a descrição oficial do NCM ${code} conforme a Nomenclatura Comum do Mercosul / TIPI vigente
(texto do item/subitem, em português, sem o código) e a alíquota de IPI da TIPI se souber (null se não souber).
Se o código não existir na nomenclatura, responda {"exists": false}.
Responda somente com JSON: {"exists": true, "code": "${code}", "description": "…", "ipiRate": number|null}`
  const { parsed } = await generateJson(prompt, opts)
  return parseNcmAnswer(code, parsed)
}

// Valida o que veio da IA: mesmo código de 8 dígitos, descrição não vazia e com tamanho limitado, IPI entre 0 e 400%.
export function parseNcmAnswer(code: string, parsed: any): NcmInfo | null {
  const a = Array.isArray(parsed) ? parsed[0] : parsed
  if (!a || typeof a !== 'object' || a.exists === false) return null
  if (a.code !== undefined && String(a.code).replace(/\D/g, '') !== code) return null
  const description = String(a.description ?? '').replace(/\s+/g, ' ').replace(/^[-–\s]+/, '').trim()
  if (description.length < 3) return null
  const rate = a.ipiRate === null || a.ipiRate === undefined || a.ipiRate === '' ? null : Number(String(a.ipiRate).replace(',', '.').replace('%', ''))
  return {
    description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    ipiRate: rate !== null && Number.isFinite(rate) && rate >= 0 && rate <= 400 ? Math.round(rate * 100) / 100 : null,
  }
}

// Garante que o NCM do produto exista no cadastro. Novo entra como pendente e, se der, a IA completa.
// Nunca lança erro: quem chama não pode falhar por causa disso.
export async function ensureNcm(db: Db, code: string | null | undefined, gemini: () => Promise<GeminiOptions>) {
  try {
    if (!code || !/^\d{8}$/.test(code)) return
    const created = await one(
      db,
      `INSERT INTO ncm (code, description, pending, source) VALUES ($1, $2, true, 'auto') ON CONFLICT (code) DO NOTHING RETURNING id`,
      [code, pendingDescription(code)],
    )
    if (!created) return
    logger.log(`NCM ${code} cadastrado automaticamente (descrição pendente)`)
    await fillNcm(db, code, await gemini())
  } catch (error) {
    logger.error(`Falha ao cadastrar o NCM ${code}: ${(error as Error).message}`)
  }
}

// Busca a descrição com a IA para um NCM pendente. Devolve se conseguiu.
export async function fillNcm(db: Db, code: string, opts: GeminiOptions): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.apiKey) return { ok: false, reason: 'Gemini não configurado (Configurações)' }
  let info: NcmInfo | null
  try {
    info = await describeNcm(code, opts)
  } catch (error) {
    logger.warn(`Gemini não descreveu o NCM ${code}: ${(error as Error).message}`)
    return { ok: false, reason: (error as Error).message }
  }
  if (!info) return { ok: false, reason: 'A IA não reconheceu este NCM' }
  await db.query(
    `UPDATE ncm SET description = $2, ipi_rate = coalesce(ipi_rate, $3), pending = false, source = 'ia' WHERE code = $1 AND pending`,
    [code, info.description, info.ipiRate],
  )
  return { ok: true }
}
