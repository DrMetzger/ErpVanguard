import { BadRequestException } from '@nestjs/common'
import { one, type Db } from '../common/db'
import { seriesModels, type ParametersService } from '../params/parameters.service'

export interface NumberingRow { id: string; company_id: string; series: number; model: '55' | '65'; next_number: number; active: boolean }

// Série da NF-e de venda (MV_SERNFE) e o modelo pela espécie do MV_ESPECIE.
export async function saleSeries(db: Db, params: ParametersService) {
  const all = await params.all(db)
  const series = Number(all.MV_SERNFE)
  const model = seriesModels(String(all.MV_ESPECIE)).get(series)
  return { series, model: model ?? null }
}

// Linha de numeração da empresa/série, criada na primeira vez a partir da maior nota já emitida.
// Com lock (FOR UPDATE): duas notas ao mesmo tempo esperam uma pela outra.
export async function lockNumbering(tx: Db, companyId: string, series: number, model: '55' | '65') {
  await tx.query(
    `INSERT INTO invoice_numbering (company_id, series, model, next_number)
     VALUES ($1, $2, $3, (SELECT coalesce(max(number), 0) + 1 FROM sales_invoices WHERE company_id = $1 AND series = $2))
     ON CONFLICT (company_id, series) DO NOTHING`,
    [companyId, series, model],
  )
  return (await one<NumberingRow>(tx, `SELECT * FROM invoice_numbering WHERE company_id = $1 AND series = $2 FOR UPDATE`, [companyId, series]))!
}

// Reserva o próximo número da NF-e de venda. Precisa rodar dentro da transação da nota.
export async function takeInvoiceNumber(tx: Db, params: ParametersService, companyId: string) {
  const { series, model } = await saleSeries(tx, params)
  if (!model) throw new BadRequestException(`A série ${series} (MV_SERNFE) não está no parâmetro MV_ESPECIE. Ajuste em Administração › Parâmetros.`)
  if (model !== '55') throw new BadRequestException(`A série ${series} é de NFC-e (modelo 65); a venda por pedido emite NF-e (SPED, modelo 55)`)
  const row = await lockNumbering(tx, companyId, series, model)
  if (!row.active) throw new BadRequestException(`A série ${series} está inativa em Numeração de notas`)
  if (row.model !== model) throw new BadRequestException(`A série ${series} está como modelo ${row.model} em Numeração de notas, mas o MV_ESPECIE diz ${model}`)
  // Segurança: se alguém voltou a numeração para um número já usado, pula para o próximo livre.
  let number = Number(row.next_number)
  while (await one(tx, `SELECT 1 FROM sales_invoices WHERE company_id = $1 AND series = $2 AND number = $3`, [companyId, series, number])) number++
  await tx.query(`UPDATE invoice_numbering SET next_number = $2, updated_at = now() WHERE id = $1`, [row.id, number + 1])
  return { series, model, number }
}
