import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { Db } from '../common/db'

export interface ParamDef { key: string; group: string; label: string; type: 'bool' | 'int' | 'decimal' | 'text'; default: boolean | number | string; help: string; min?: number; max?: number; pattern?: RegExp; patternMessage?: string; keepSpaces?: boolean }
export type ParamValue = boolean | number | string

// Parâmetros do sistema (como os MV_ do Protheus). O valor padrão vale até alguém mudar na tela.
export const PARAMS: ParamDef[] = [
  { key: 'MV_ESTNEG', group: 'Faturamento', label: 'Permite faturar sem estoque', type: 'bool', default: false, help: 'Se ligado, o faturamento deixa o estoque ficar negativo.' },
  { key: 'MV_ESPECIE', group: 'Faturamento', label: 'Séries × espécie do documento', type: 'text', default: '1=SPED', help: 'Como no Protheus: série=espécie separadas por ";". SPED = NF-e (modelo 55), NFCE = NFC-e (modelo 65). Ex.: 1=SPED;2=SPED;3=NFCE', pattern: /^\d{1,3}=(SPED|NFCE)(;\d{1,3}=(SPED|NFCE))*$/i, patternMessage: 'use série=SPED ou série=NFCE separados por ";" (ex.: 1=SPED;2=NFCE)' },
  { key: 'MV_SERNFE', group: 'Faturamento', label: 'Série da NF-e de venda', type: 'int', default: 1, help: 'Série usada ao faturar pedidos. Precisa estar no MV_ESPECIE como SPED; o próximo número fica em Numeração de notas.', min: 0, max: 999 },
  { key: 'MV_ORCVAL', group: 'Faturamento', label: 'Validade padrão do orçamento (dias)', type: 'int', default: 15, help: 'Preenche a validade de orçamentos novos.', min: 1, max: 365 },
  { key: 'MV_FRETICM', group: 'Impostos', label: 'Frete compõe a base do ICMS', type: 'bool', default: true, help: 'Frete cobrado na nota entra na base de cálculo do ICMS e do ICMS-ST.' },
  { key: 'MV_IPIBICM', group: 'Impostos', label: 'IPI compõe a base do ICMS para consumidor final', type: 'bool', default: true, help: 'Venda para não contribuinte (uso e consumo): IPI entra na base do ICMS.' },
  { key: 'MV_DIFAL', group: 'Impostos', label: 'Calcula DIFAL para não contribuinte de outra UF', type: 'bool', default: true, help: 'EC 87/2015: diferença entre a alíquota interna do destino e a interestadual (+ FCP do destino).' },
  { key: 'MV_ICMSPIS', group: 'Impostos', label: 'Exclui o ICMS da base do PIS/COFINS', type: 'bool', default: true, help: 'Tema 69 do STF (“tese do século”).' },
  { key: 'MV_IBPTPCT', group: 'Impostos', label: 'Tributos aproximados, padrão (%)', type: 'decimal', default: 0, help: 'Lei 12.741/2012 (“Valor aproximado dos tributos”, tabela IBPT: federal + estadual). Vale quando o NCM não tem o percentual dele.', min: 0, max: 100 },
  { key: 'MV_PISPRE', group: 'Impostos', label: 'PIS no Lucro Presumido (%)', type: 'decimal', default: 0.65, help: 'Regime cumulativo.', min: 0, max: 100 },
  { key: 'MV_COFPRE', group: 'Impostos', label: 'COFINS no Lucro Presumido (%)', type: 'decimal', default: 3, help: 'Regime cumulativo.', min: 0, max: 100 },
  { key: 'MV_PISREAL', group: 'Impostos', label: 'PIS no Lucro Real (%)', type: 'decimal', default: 1.65, help: 'Regime não cumulativo.', min: 0, max: 100 },
  { key: 'MV_COFREAL', group: 'Impostos', label: 'COFINS no Lucro Real (%)', type: 'decimal', default: 7.6, help: 'Regime não cumulativo.', min: 0, max: 100 },
  // Reforma tributária (LC 214/2025). 2026 é ano de teste: CBS 0,9% e IBS 0,1%, destacados na nota sem somar no total.
  { key: 'MV_IBSCBS', group: 'IBS/CBS', label: 'Calcula IBS e CBS (reforma tributária)', type: 'bool', default: true, help: 'Calcula e informa o grupo IBSCBS na NF-e. A classificação (cClassTrib) vem da TES ou do produto; sem nenhuma, 000001 (tributação integral).' },
  { key: 'MV_IBSCBSSN', group: 'IBS/CBS', label: 'Informa IBS/CBS também no Simples Nacional e MEI', type: 'bool', default: false, help: 'Em 2026 o Simples/MEI não é obrigado a informar. Ligue só se o contador pedir.' },
  { key: 'MV_CBSALQ', group: 'IBS/CBS', label: 'Alíquota da CBS (%)', type: 'decimal', default: 0.9, help: 'Contribuição federal. 2026: 0,9% (teste). A redução do cClassTrib é aplicada sobre ela.', min: 0, max: 100 },
  { key: 'MV_IBSUFALQ', group: 'IBS/CBS', label: 'Alíquota do IBS estadual (%)', type: 'decimal', default: 0.1, help: 'Parte da UF. 2026: 0,1% (teste).', min: 0, max: 100 },
  { key: 'MV_IBSMUNALQ', group: 'IBS/CBS', label: 'Alíquota do IBS municipal (%)', type: 'decimal', default: 0, help: 'Parte do município. 2026: 0% (o 0,1% de teste fica todo com a UF).', min: 0, max: 100 },
  // NF-e
  { key: 'MV_INDPRES', group: 'NF-e', label: 'Presença do comprador (indPres)', type: 'int', default: 1, help: '0 = não se aplica, 1 = presencial, 2 = internet, 3 = teleatendimento, 4 = entrega em domicílio, 5 = presencial fora do estabelecimento, 9 = outros.', min: 0, max: 9 },
  { key: 'MV_TPAGVIS', group: 'NF-e', label: 'Forma de pagamento à vista (tPag)', type: 'text', default: '01', help: 'Código da SEFAZ: 01 dinheiro, 03 cartão de crédito, 04 cartão de débito, 15 boleto, 17 PIX, 99 outros.', pattern: /^\d{2}$/, patternMessage: 'use o código de 2 dígitos (ex.: 01, 17)' },
  { key: 'MV_TPAGPRZ', group: 'NF-e', label: 'Forma de pagamento a prazo (tPag)', type: 'text', default: '15', help: 'Código da SEFAZ para vendas com duplicatas: 15 boleto, 05 crédito loja, 99 outros.', pattern: /^\d{2}$/, patternMessage: 'use o código de 2 dígitos (ex.: 15)' },
  { key: 'MV_RTCNPJ', group: 'NF-e', label: 'Responsável técnico: CNPJ', type: 'text', default: '', help: 'Grupo infRespTec (software house). Vazio = não informa o grupo.', pattern: /^(\d{14})?$/, patternMessage: 'CNPJ com 14 dígitos, sem pontos' },
  { key: 'MV_RTCONT', group: 'NF-e', label: 'Responsável técnico: contato', type: 'text', default: '', help: 'Nome da pessoa de contato.', keepSpaces: true, pattern: /^.{0,60}$/, patternMessage: 'até 60 caracteres' },
  { key: 'MV_RTMAIL', group: 'NF-e', label: 'Responsável técnico: e-mail', type: 'text', default: '', help: 'E-mail do responsável técnico.', pattern: /^([^@\s]+@[^@\s]+\.[^@\s]+)?$/, patternMessage: 'e-mail inválido' },
  { key: 'MV_RTFONE', group: 'NF-e', label: 'Responsável técnico: telefone', type: 'text', default: '', help: 'Só números, com DDD.', pattern: /^(\d{6,14})?$/, patternMessage: 'de 6 a 14 dígitos' },
]

@Injectable()
export class ParametersService {
  constructor(private readonly db: DataSource) {}

  async all(db: Db = this.db) {
    const rows: { key: string; value: string }[] = await db.query(`SELECT key, value FROM parameters`)
    const saved = new Map(rows.map((r) => [r.key, r.value]))
    return Object.fromEntries(PARAMS.map((p) => [p.key, saved.has(p.key) ? this.parse(p, saved.get(p.key)!) : p.default])) as Record<string, ParamValue>
  }

  async get<T extends ParamValue>(key: string, db: Db = this.db): Promise<T> {
    return (await this.all(db))[key] as T
  }

  async save(values: Record<string, unknown>, userId: string) {
    for (const [key, raw] of Object.entries(values)) {
      const def = PARAMS.find((p) => p.key === key)
      if (!def) throw new BadRequestException(`Parâmetro desconhecido: ${key}`)
      let value: ParamValue
      if (def.type === 'text') {
        const text = def.keepSpaces ? String(raw ?? '').replace(/\s+/g, ' ').trim() : String(raw ?? '').replace(/\s+/g, '').trim()
        if (def.pattern && !def.pattern.test(text)) throw new BadRequestException(`${def.label}: ${def.patternMessage ?? 'formato inválido'}`)
        value = def.key === 'MV_ESPECIE' ? text.toUpperCase() : text
      } else if (def.type === 'bool') {
        if (typeof raw !== 'boolean') throw new BadRequestException(`${def.label}: use sim ou não`)
        value = raw
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n) || (def.type === 'int' && !Number.isInteger(n))) throw new BadRequestException(`${def.label}: número inválido`)
        if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw new BadRequestException(`${def.label}: fora do limite (${def.min} a ${def.max})`)
        value = n
      }
      await this.db.query(
        `INSERT INTO parameters (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, String(value), userId],
      )
    }
  }

  private parse(def: ParamDef, v: string) {
    return def.type === 'bool' ? v === 'true' : def.type === 'text' ? v : Number(v)
  }
}

// MV_ESPECIE "1=SPED;3=NFCE" → Map(série → modelo 55/65).
export function seriesModels(especie: string) {
  const map = new Map<number, '55' | '65'>()
  for (const part of String(especie).split(';')) {
    const [series, kind] = part.split('=')
    if (series && /^\d+$/.test(series) && kind) map.set(Number(series), kind.toUpperCase() === 'NFCE' ? '65' : '55')
  }
  return map
}
