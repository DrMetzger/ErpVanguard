import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import type { Db } from '../common/db'

export interface ParamDef { key: string; group: string; label: string; type: 'bool' | 'int' | 'decimal'; default: boolean | number; help: string; min?: number; max?: number }

// Parâmetros do sistema (como os MV_ do Protheus). O valor padrão vale até alguém mudar na tela.
export const PARAMS: ParamDef[] = [
  { key: 'MV_ESTNEG', group: 'Faturamento', label: 'Permite faturar sem estoque', type: 'bool', default: false, help: 'Se ligado, o faturamento deixa o estoque ficar negativo.' },
  { key: 'MV_ORCVAL', group: 'Faturamento', label: 'Validade padrão do orçamento (dias)', type: 'int', default: 15, help: 'Preenche a validade de orçamentos novos.', min: 1, max: 365 },
  { key: 'MV_FRETICM', group: 'Impostos', label: 'Frete compõe a base do ICMS', type: 'bool', default: true, help: 'Frete cobrado na nota entra na base de cálculo do ICMS e do ICMS-ST.' },
  { key: 'MV_IPIBICM', group: 'Impostos', label: 'IPI compõe a base do ICMS para consumidor final', type: 'bool', default: true, help: 'Venda para não contribuinte (uso e consumo): IPI entra na base do ICMS.' },
  { key: 'MV_DIFAL', group: 'Impostos', label: 'Calcula DIFAL para não contribuinte de outra UF', type: 'bool', default: true, help: 'EC 87/2015: diferença entre a alíquota interna do destino e a interestadual (+ FCP do destino).' },
  { key: 'MV_ICMSPIS', group: 'Impostos', label: 'Exclui o ICMS da base do PIS/COFINS', type: 'bool', default: true, help: 'Tema 69 do STF (“tese do século”).' },
  { key: 'MV_PISPRE', group: 'Impostos', label: 'PIS no Lucro Presumido (%)', type: 'decimal', default: 0.65, help: 'Regime cumulativo.', min: 0, max: 100 },
  { key: 'MV_COFPRE', group: 'Impostos', label: 'COFINS no Lucro Presumido (%)', type: 'decimal', default: 3, help: 'Regime cumulativo.', min: 0, max: 100 },
  { key: 'MV_PISREAL', group: 'Impostos', label: 'PIS no Lucro Real (%)', type: 'decimal', default: 1.65, help: 'Regime não cumulativo.', min: 0, max: 100 },
  { key: 'MV_COFREAL', group: 'Impostos', label: 'COFINS no Lucro Real (%)', type: 'decimal', default: 7.6, help: 'Regime não cumulativo.', min: 0, max: 100 },
]

@Injectable()
export class ParametersService {
  constructor(private readonly db: DataSource) {}

  async all(db: Db = this.db) {
    const rows: { key: string; value: string }[] = await db.query(`SELECT key, value FROM parameters`)
    const saved = new Map(rows.map((r) => [r.key, r.value]))
    return Object.fromEntries(PARAMS.map((p) => [p.key, saved.has(p.key) ? this.parse(p, saved.get(p.key)!) : p.default])) as Record<string, boolean | number>
  }

  async get<T extends boolean | number>(key: string, db: Db = this.db): Promise<T> {
    return (await this.all(db))[key] as T
  }

  async save(values: Record<string, unknown>, userId: string) {
    for (const [key, raw] of Object.entries(values)) {
      const def = PARAMS.find((p) => p.key === key)
      if (!def) throw new BadRequestException(`Parâmetro desconhecido: ${key}`)
      let value: boolean | number
      if (def.type === 'bool') {
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
    return def.type === 'bool' ? v === 'true' : Number(v)
  }
}
