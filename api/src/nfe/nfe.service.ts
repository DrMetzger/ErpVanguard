import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { GerarDanfeUseCase, type CertificateData } from '@brasil-fiscal/nfe'
import { one, type Db } from '../common/db'
import { round2 } from '../finance/finance.logic'
import { ParametersService } from '../params/parameters.service'
import { checkReversible, reverseInvoice } from '../sales/invoice-reversal'
import { decrypt } from '../settings/settings.service'
import type { ItemTaxes } from '../taxes/tax-engine'
import { buildNfeXml, brasiliaDateTime, d2, onlyDigits, randomCNF, UF_CODE, type NfeInput } from './nfe-xml'
import {
  AuditTransport, authorize, autorizadorOf, cancelEvent, certificateFromPfx, consultKey, correctionEvent, hasUrls, hintFor, nfeProc, serviceStatus,
  signXml, summarize, validateXsd, voidRange, type AuthResult, type Environment,
} from './sefaz'

const CRT: Record<string, '1' | '2' | '3' | '4'> = { simples: '1', simples_excesso: '2', mei: '4', presumido: '3', real: '3' }
const DENIED = ['110', '301', '302', '303']
const AUTHORIZED = ['100', '150']
const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type EventType = 'transmissao' | 'consulta' | 'cancelamento' | 'cce' | 'inutilizacao' | 'status'

// Emissão da NF-e modelo 55: monta, assina, valida, transmite e registra os eventos (tudo auditado em nfe_events).
@Injectable()
export class NfeService {
  constructor(private readonly db: DataSource, private readonly params: ParametersService) {}

  // Certificado A1 ativo da empresa; a filial pode usar o da matriz (mesma raiz de CNPJ).
  async certificate(db: Db, companyId: string): Promise<{ cert: CertificateData; environment: Environment; companyDocument: string }> {
    const company = await one(db, `SELECT id, document FROM companies WHERE id = $1`, [companyId])
    if (!company) throw new NotFoundException('Empresa não encontrada')
    const row = await one(
      db,
      `SELECT c.pfx, c.password, c.environment, c.valid_to FROM certificates c JOIN companies co ON co.id = c.company_id
       WHERE c.active AND (c.company_id = $1 OR left(co.document, 8) = left($2, 8))
       ORDER BY (c.company_id = $1) DESC, co.is_head DESC, c.valid_to DESC LIMIT 1`,
      [companyId, company.document],
    )
    if (!row) throw new BadRequestException('Nenhum certificado A1 ativo para esta empresa (nem da matriz). Envie em Administração › Empresas › Certificado digital.')
    if (new Date(row.valid_to).getTime() < Date.now()) throw new BadRequestException(`Certificado A1 vencido em ${new Date(row.valid_to).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: envie o novo`)
    let cert: CertificateData
    try {
      cert = certificateFromPfx(decrypt(row.pfx), decrypt(row.password))
    } catch (error: any) {
      throw new BadRequestException(`Não foi possível abrir o certificado A1: ${error.message}`)
    }
    return { cert, environment: row.environment, companyDocument: company.document }
  }

  // ---- dados da nota para o XML

  private async input(db: Db, invoiceId: string, environment: Environment, cNF: string, issuedAt: Date): Promise<NfeInput> {
    const inv = (await one(
      db,
      `SELECT i.*, ot.name AS op_name, ot.is_return, o.number AS order_number, o.notes AS order_notes FROM sales_invoices i
       JOIN operation_types ot ON ot.id = i.operation_type_id LEFT JOIN sales_orders o ON o.id = i.order_id WHERE i.id = $1`,
      [invoiceId],
    ))!
    if (inv.is_return) throw new BadRequestException('NF-e de devolução precisa da chave da nota de origem (NFref): ainda não suportada na emissão própria')
    if (inv.model !== '55') throw new BadRequestException(`A nota é modelo ${inv.model}; a emissão aqui é da NF-e modelo 55`)
    const co = (await one(db, `SELECT * FROM companies WHERE id = $1`, [inv.company_id]))!
    const cu = (await one(db, `SELECT * FROM customers WHERE id = $1`, [inv.customer_id]))!
    const missing: string[] = []
    const need = (ok: unknown, what: string) => { if (!ok) missing.push(what) }
    need(onlyDigits(co.document).length === 14, 'CNPJ da empresa'); need(co.ie, 'IE da empresa'); need(co.street, 'endereço da empresa'); need(co.district, 'bairro da empresa')
    need(/^\d{7}$/.test(co.city_code ?? ''), 'código IBGE do município da empresa'); need(onlyDigits(co.zip).length === 8, 'CEP da empresa'); need(UF_CODE[co.uf], 'UF da empresa')
    need([11, 14].includes(onlyDigits(cu.document).length), 'CPF/CNPJ do cliente'); need(cu.street, 'endereço do cliente'); need(cu.district, 'bairro do cliente')
    need(/^\d{7}$/.test(cu.city_code ?? ''), 'código IBGE do município do cliente'); need(onlyDigits(cu.zip).length === 8, 'CEP do cliente'); need(cu.uf, 'UF do cliente')
    if (missing.length) throw new BadRequestException(`Faltam dados para a NF-e: ${missing.join(', ')}`)

    const items = await db.query(
      `SELECT i.*, p.sku, p.barcode, p.origin, p.custom->>'cest' AS cest FROM sales_invoice_items i JOIN products p ON p.id = i.product_id
       WHERE i.invoice_id = $1 ORDER BY i.item_number`,
      [invoiceId],
    )
    const noNcm = items.filter((i: any) => onlyDigits(i.ncm).length !== 8).map((i: any) => i.sku)
    if (noNcm.length) throw new BadRequestException(`Produto sem NCM válido: ${noNcm.join(', ')}`)
    const titles = await db.query(`SELECT installment, due_date::text AS due, amount FROM financial_titles WHERE sales_invoice_id = $1 AND kind = 'R' AND status <> 'cancelado' ORDER BY installment`, [invoiceId])
    const all = await this.params.all(db)

    const lines = items.map((i: any) => {
      const quantity = Number(i.quantity)
      const unitPrice = Number(i.unit_price)
      const gross = round2(quantity * unitPrice)
      return {
        code: i.sku, barcode: i.barcode, name: i.description, ncm: i.ncm, cest: i.cest, cfop: i.cfop, unit: i.unit, origin: Number(i.origin ?? 0),
        quantity, unitPrice, gross, itemDiscount: Math.max(0, round2(gross - Number(i.total))), taxes: i.taxes as ItemTaxes,
      }
    })
    // Parcelas: a prazo vão em <cobr><dup>; vencidas antes da emissão ficam de fora (a SEFAZ recusa).
    const issueDay = brasiliaDateTime(issuedAt).slice(0, 10)
    const dups = titles.filter((t: any) => t.due >= issueDay).map((t: any, n: number) => ({ number: String(n + 1).padStart(3, '0'), dueDate: t.due, amount: Number(t.amount) }))
    const onCredit = titles.some((t: any) => t.due > issueDay)
    const crt = CRT[co.tax_regime] ?? '3'

    // Informações complementares: Simples, crédito de ICMS, tributos aproximados, pedido e observações.
    const info: string[] = []
    const taxes = inv.taxes ?? {}
    if (crt === '1' || crt === '4') info.push('DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NAO GERA DIREITO A CREDITO FISCAL DE IPI.')
    const snCredit = round2(lines.reduce((s: number, l: any) => s + (l.taxes?.icms?.snCredit ?? 0), 0))
    const snRate = lines.find((l: any) => l.taxes?.icms?.snCreditRate)?.taxes.icms.snCreditRate
    if (snCredit > 0) info.push(`PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ ${fmt(snCredit)}, CORRESPONDENTE A ALIQUOTA DE ${fmt(snRate ?? 0)}%, NOS TERMOS DO ART. 23 DA LC 123/2006.`)
    if (Number(taxes.approxTax) > 0) info.push(`Valor aproximado dos tributos: R$ ${fmt(Number(taxes.approxTax))} (Lei 12.741/2012).`)
    if (inv.order_number) info.push(`Pedido PV-${String(inv.order_number).padStart(6, '0')}.`)
    if (inv.order_notes) info.push(String(inv.order_notes))

    const rt = String(all.MV_RTCNPJ ?? '')
    return {
      environment, number: Number(inv.number), series: Number(inv.series), cNF, issuedAt, natOp: inv.op_name, finNFe: '1', indPres: String(all.MV_INDPRES ?? 1),
      emit: { cnpj: co.document, name: co.name, tradeName: co.trade_name, ie: co.ie, crt, street: co.street, number: co.number, complement: co.complement, district: co.district,
        cityCode: co.city_code, city: co.city, uf: co.uf, zip: co.zip, phone: co.phone },
      dest: { document: cu.document, name: cu.name, ie: cu.ie, taxpayer: String(cu.taxpayer ?? '9'), street: cu.street, number: cu.number, complement: cu.complement,
        district: cu.district, cityCode: cu.city_code, city: cu.city, uf: String(cu.uf).toUpperCase(), zip: cu.zip, phone: cu.phone, email: cu.email },
      items: lines, freight: Number(inv.freight), duplicates: onCredit ? dups : [],
      payment: titles.length ? { tPag: String(onCredit ? all.MV_TPAGPRZ : all.MV_TPAGVIS) || (onCredit ? '15' : '01'), indPag: onCredit ? '1' : '0' } : null,
      additionalInfo: info.join(' '),
      respTec: rt ? { cnpj: rt, contact: String(all.MV_RTCONT ?? ''), email: String(all.MV_RTMAIL ?? ''), phone: String(all.MV_RTFONE ?? '') } : null,
    }
  }

  // Monta, assina e valida; grava na nota (sem transmitir). Reaproveita o cNF no mesmo mês para a chave não mudar.
  private async buildAndStore(tx: Db, inv: any, cert: CertificateData, environment: Environment) {
    const issuedAt = new Date()
    const sameMonth = inv.access_key && inv.access_key.slice(2, 6) === brasiliaDateTime(issuedAt).slice(2, 7).replace('-', '')
    const cNF = sameMonth ? inv.access_key.slice(35, 43) : randomCNF(Number(inv.number))
    let built
    try {
      built = buildNfeXml(await this.input(tx, inv.id, environment, cNF, issuedAt))
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException(error.message)
    }
    const signed = signXml(built.xml, cert)
    const check = validateXsd(signed)
    const warnings: string[] = []
    if (Math.abs(built.totals.vNF - Number(inv.total)) > 0.009) warnings.push(`Total do XML (R$ ${d2(built.totals.vNF)}) difere do total da nota (R$ ${d2(Number(inv.total))})`)
    await tx.query(
      `UPDATE sales_invoices SET access_key = $2, environment = $3, xml = $4, xml_proc = NULL, nfe_issued_at = $5, sefaz_status = CASE WHEN sefaz_status = 'rejeitada' THEN 'rejeitada' ELSE 'pendente' END
       WHERE id = $1`,
      [inv.id, built.accessKey, environment, signed, issuedAt],
    )
    return { accessKey: built.accessKey, valid: check.valid, errors: check.errors, warnings, xml: signed, totals: built.totals }
  }

  private async lockInvoice(tx: Db, id: string) {
    const inv = await one(tx, `SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE`, [id])
    if (!inv) throw new NotFoundException('Nota não encontrada')
    return inv
  }

  private async event(tx: Db, e: { invoiceId?: string | null; companyId: string; type: EventType; environment: Environment; transport?: AuditTransport; result?: Partial<AuthResult> & { ok?: boolean }; success: boolean; userId: string; sequence?: number; text?: string; series?: number; from?: number; to?: number; error?: string }) {
    // Uma linha por ida à SEFAZ; o resultado (código, mensagem, protocolo) fica na última.
    // clock_timestamp: dentro da mesma transação o now() é igual e a ordem do histórico se perderia.
    const calls = e.transport?.calls.length ? e.transport.calls : [null]
    for (const [i, call] of calls.entries()) {
      const last = i === calls.length - 1
      const type = ['nfeConsultaNF', 'nfeRetAutorizacaoLote'].includes(call?.service ?? '') ? 'consulta' : e.type
      const own = summarize(call?.response ?? null)
      await tx.query(
        `INSERT INTO nfe_events (invoice_id, company_id, type, environment, sequence, series, number_from, number_to, text, request_xml, response_xml, status_code, message, protocol, success, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, clock_timestamp())`,
        [e.invoiceId ?? null, e.companyId, type, e.environment, e.sequence ?? null, e.series ?? null, e.from ?? null, e.to ?? null, e.text ?? null,
          call?.request ?? null, call?.response ?? null, last ? e.result?.cStat ?? own.cStat : own.cStat, last ? (e.error ?? e.result?.xMotivo ?? own.xMotivo) : call?.error ?? own.xMotivo,
          last ? e.result?.nProt ?? null : null, last ? e.success : false, e.userId],
      )
    }
  }

  // POST .../nfe/xml: gera e valida sem transmitir.
  async generate(id: string) {
    return this.db.transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, id)
      if (inv.status === 'cancelada') throw new BadRequestException('Nota cancelada')
      if (['autorizada', 'cancelada', 'denegada'].includes(inv.sefaz_status)) throw new BadRequestException(`NF-e já ${inv.sefaz_status}: o XML não pode mais ser gerado de novo`)
      if (inv.sefaz_status === 'erro') throw new BadRequestException('A última transmissão falhou e a SEFAZ pode ter recebido a nota: use "Transmitir à SEFAZ" (consulta a chave antes de reenviar)')
      const { cert, environment } = await this.certificate(tx, inv.company_id)
      const r = await this.buildAndStore(tx, inv, cert, environment)
      return { accessKey: r.accessKey, valid: r.valid, errors: r.errors, warnings: r.warnings, environment, totals: r.totals }
    })
  }

  // POST .../nfe/transmit: autorização síncrona. Nunca reemite com erro pendente: consulta a chave antes.
  async transmit(id: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, id)
      if (inv.status === 'cancelada') throw new BadRequestException('Nota cancelada no sistema')
      if (['autorizada', 'cancelada', 'denegada'].includes(inv.sefaz_status)) throw new BadRequestException(`NF-e já ${inv.sefaz_status}`)
      const cred = await this.certificate(tx, inv.company_id)
      const cert = cred.cert
      const uf = (await one(tx, `SELECT uf FROM companies WHERE id = $1`, [inv.company_id]))!.uf
      if (!AuditTransport.override() && !hasUrls(uf)) throw new BadRequestException(`Sem endereço da SEFAZ para a UF ${uf} (autorizador ${autorizadorOf(uf) ?? '?'})`)
      const transport = new AuditTransport()
      let environment: Environment = inv.environment ?? cred.environment
      let signed: string = inv.xml
      let key: string = inv.access_key

      // Erro na tentativa anterior: primeiro pergunta à SEFAZ se a chave já existe.
      if (inv.sefaz_status === 'erro' && signed && key) {
        let consult: AuthResult
        try {
          consult = await consultKey(transport, cert, environment, key)
        } catch (error: any) {
          const message = `Sem resposta da SEFAZ na consulta da chave: ${error.message}. Tente de novo em instantes.`
          await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'consulta', environment, transport, success: false, userId, error: message })
          await tx.query(`UPDATE sales_invoices SET sefaz_message = $2 WHERE id = $1`, [id, message])
          return this.outcome(tx, id)
        }
        if (consult.cStat !== '217') {
          await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'consulta', environment, transport, result: consult, success: AUTHORIZED.includes(consult.cStat), userId })
          await this.apply(tx, inv, signed, consult)
          return this.outcome(tx, id)
        }
        // 217 = não consta na base: reenvia o mesmo XML (mesma chave), sem montar de novo.
        await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'consulta', environment, transport, result: consult, success: true, userId })
        transport.calls = []
      } else {
        environment = cred.environment
        const built = await this.buildAndStore(tx, inv, cert, environment)
        if (!built.valid) throw new BadRequestException({ message: `XML fora do padrão (XSD): ${built.errors.slice(0, 3).join('; ')}`, errors: built.errors })
        signed = built.xml
        key = built.accessKey
      }

      await tx.query(`UPDATE sales_invoices SET sent_at = now() WHERE id = $1`, [id])
      let result: AuthResult
      try {
        result = await authorize(transport, cert, uf, environment, signed, String(Date.now()).slice(-15))
        // 204 = duplicidade: a SEFAZ já tem esta chave; busca o protocolo.
        if (result.cStat === '204') {
          const c = await consultKey(transport, cert, environment, key)
          if (AUTHORIZED.includes(c.cStat)) result = c
        }
      } catch (error: any) {
        const message = `Falha na comunicação com a SEFAZ: ${error.message}. A nota pode ter sido recebida; use "Transmitir à SEFAZ" de novo para consultar pela chave antes de reenviar.`
        await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'transmissao', environment, transport, success: false, userId, error: message })
        await tx.query(`UPDATE sales_invoices SET sefaz_status = 'erro', sefaz_code = NULL, sefaz_message = $2 WHERE id = $1`, [id, message])
        return this.outcome(tx, id)
      }
      await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'transmissao', environment, transport, result, success: AUTHORIZED.includes(result.cStat), userId })
      await this.apply(tx, { ...inv, access_key: key }, signed, result)
      return this.outcome(tx, id)
    })
  }

  // Grava o resultado da autorização/consulta na nota.
  private async apply(tx: Db, inv: any, signed: string, r: AuthResult) {
    const hint = hintFor(r.cStat)
    const message = [r.xMotivo, hint].filter(Boolean).join(' — ')
    if (AUTHORIZED.includes(r.cStat) || DENIED.includes(r.cStat)) {
      const status = AUTHORIZED.includes(r.cStat) ? 'autorizada' : 'denegada'
      await tx.query(
        `UPDATE sales_invoices SET sefaz_status = $2, sefaz_code = $3, sefaz_message = $4, protocol = $5, authorized_at = $6, xml_proc = $7 WHERE id = $1`,
        [inv.id, status, r.cStat, message, r.nProt ?? null, r.dhRecbto ? new Date(r.dhRecbto) : new Date(), r.protNFe ? nfeProc(signed, r.protNFe) : null],
      )
    } else if (['101', '151', '155'].includes(r.cStat)) {
      await tx.query(`UPDATE sales_invoices SET sefaz_status = 'cancelada', sefaz_code = $2, sefaz_message = $3 WHERE id = $1`, [inv.id, r.cStat, message])
    } else if (['103', '105'].includes(r.cStat)) {
      await tx.query(`UPDATE sales_invoices SET sefaz_status = 'erro', sefaz_code = $2, sefaz_message = $3 WHERE id = $1`,
        [inv.id, r.cStat, `${r.xMotivo}. Transmita de novo em instantes para consultar o resultado.`])
    } else {
      await tx.query(`UPDATE sales_invoices SET sefaz_status = 'rejeitada', sefaz_code = $2, sefaz_message = $3 WHERE id = $1`, [inv.id, r.cStat, message])
    }
  }

  private async outcome(db: Db, id: string) {
    const r = (await one(db, `SELECT sefaz_status, sefaz_code, sefaz_message, protocol, access_key, environment, authorized_at FROM sales_invoices WHERE id = $1`, [id]))!
    return { sefazStatus: r.sefaz_status, code: r.sefaz_code, message: r.sefaz_message, protocol: r.protocol, accessKey: r.access_key, environment: r.environment, authorizedAt: r.authorized_at }
  }

  // Cancelamento (evento 110111): só NF-e autorizada; homologado, desfaz a nota no sistema.
  async cancel(id: string, reason: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, id)
      if (inv.sefaz_status !== 'autorizada' || !inv.protocol) throw new BadRequestException('Só NF-e autorizada pode ser cancelada na SEFAZ')
      await checkReversible(tx, id)
      const { cert } = await this.certificate(tx, inv.company_id)
      const transport = new AuditTransport()
      const environment: Environment = inv.environment
      let r
      try {
        r = await cancelEvent(transport, cert, environment, { key: inv.access_key, cnpj: (await this.cnpjOf(tx, inv.company_id)), protocol: inv.protocol, reason })
      } catch (error: any) {
        await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'cancelamento', environment, transport, success: false, userId, text: reason, error: `Falha na comunicação com a SEFAZ: ${error.message}` })
        return { ok: false, code: null, message: `Falha na comunicação com a SEFAZ: ${error.message}. Tente de novo.` }
      }
      await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'cancelamento', environment, transport, result: r, success: r.ok, userId, text: reason, sequence: 1 })
      if (!r.ok) return { ok: false, code: r.cStat, message: [r.xMotivo, hintFor(r.cStat)].filter(Boolean).join(' — ') }
      await tx.query(`UPDATE sales_invoices SET sefaz_status = 'cancelada', sefaz_code = $2, sefaz_message = $3 WHERE id = $1`, [id, r.cStat, r.xMotivo])
      await reverseInvoice(tx, inv, reason, userId)
      return { ok: true, code: r.cStat, message: r.xMotivo, protocol: r.nProt }
    })
  }

  // Carta de correção (evento 110110): sequência 1 a 20, a última substitui as anteriores.
  async correction(id: string, text: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, id)
      if (inv.sefaz_status !== 'autorizada') throw new BadRequestException('Carta de correção só para NF-e autorizada')
      const [{ n }] = await tx.query(`SELECT count(*)::int AS n FROM nfe_events WHERE invoice_id = $1 AND type = 'cce' AND success`, [id])
      const sequence = n + 1
      if (sequence > 20) throw new BadRequestException('Limite de 20 cartas de correção por NF-e')
      const { cert } = await this.certificate(tx, inv.company_id)
      const transport = new AuditTransport()
      const environment: Environment = inv.environment
      let r
      try {
        r = await correctionEvent(transport, cert, environment, { key: inv.access_key, cnpj: await this.cnpjOf(tx, inv.company_id), text, sequence })
      } catch (error: any) {
        await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'cce', environment, transport, success: false, userId, text, sequence, error: `Falha na comunicação com a SEFAZ: ${error.message}` })
        return { ok: false, code: null, message: `Falha na comunicação com a SEFAZ: ${error.message}. Tente de novo.` }
      }
      await this.event(tx, { invoiceId: id, companyId: inv.company_id, type: 'cce', environment, transport, result: r, success: r.ok, userId, text, sequence })
      return r.ok ? { ok: true, code: r.cStat, message: r.xMotivo, protocol: r.nProt, sequence } : { ok: false, code: r.cStat, message: [r.xMotivo, hintFor(r.cStat)].filter(Boolean).join(' — ') }
    })
  }

  // Inutilização de faixa de números (nunca de número já transmitido).
  async voidNumbers(input: { companyId: string; series: number; from: number; to: number; reason: string }, userId: string) {
    if (input.from > input.to) throw new BadRequestException('O número inicial deve ser menor ou igual ao final')
    return this.db.transaction(async (tx) => {
      const co = await one(tx, `SELECT id, document, uf FROM companies WHERE id = $1`, [input.companyId])
      if (!co) throw new NotFoundException('Empresa não encontrada')
      const used = await tx.query(
        `SELECT number FROM sales_invoices WHERE company_id = $1 AND series = $2 AND number BETWEEN $3 AND $4 AND sefaz_status IN ('autorizada', 'denegada', 'cancelada', 'erro') ORDER BY number LIMIT 10`,
        [co.id, input.series, input.from, input.to],
      )
      if (used.length) throw new BadRequestException(`Números já transmitidos à SEFAZ não podem ser inutilizados: ${used.map((u: any) => u.number).join(', ')}`)
      const { cert, environment } = await this.certificate(tx, co.id)
      const transport = new AuditTransport()
      let r
      try {
        r = await voidRange(transport, cert, environment, { cnpj: co.document, uf: co.uf, series: input.series, from: input.from, to: input.to, reason: input.reason })
      } catch (error: any) {
        await this.event(tx, { companyId: co.id, type: 'inutilizacao', environment, transport, success: false, userId, text: input.reason, series: input.series, from: input.from, to: input.to, error: error.message })
        return { ok: false, code: null, message: `Falha na comunicação com a SEFAZ: ${error.message}` }
      }
      await this.event(tx, { companyId: co.id, type: 'inutilizacao', environment, transport, result: r, success: r.ok, userId, text: input.reason, series: input.series, from: input.from, to: input.to })
      return r.ok ? { ok: true, code: r.cStat, message: r.xMotivo, protocol: r.nProt } : { ok: false, code: r.cStat, message: [r.xMotivo, hintFor(r.cStat)].filter(Boolean).join(' — ') }
    })
  }

  async voided(companyId?: string) {
    return this.db.query(
      `SELECT e.id, e.series, e.number_from AS "from", e.number_to AS "to", e.text, e.status_code AS "statusCode", e.message, e.protocol, e.success, e.environment,
              e.created_at AS "createdAt", u.name AS "userName", co.code AS "companyCode"
       FROM nfe_events e JOIN companies co ON co.id = e.company_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.type = 'inutilizacao' AND ($1::uuid IS NULL OR e.company_id = $1) ORDER BY e.created_at DESC LIMIT 50`,
      [companyId ?? null],
    )
  }

  // Status do serviço de autorização da UF da empresa, no ambiente do certificado.
  async status(companyId: string | undefined, userId: string) {
    const co = companyId
      ? await one(this.db, `SELECT id, uf FROM companies WHERE id = $1`, [companyId])
      : await one(this.db, `SELECT id, uf FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    if (!co) throw new NotFoundException('Empresa não encontrada')
    const { cert, environment } = await this.certificate(this.db, co.id)
    const transport = new AuditTransport(15_000)
    const base = { uf: co.uf, environment, autorizador: autorizadorOf(co.uf) }
    try {
      const r = await serviceStatus(transport, cert, co.uf, environment)
      await this.event(this.db, { companyId: co.id, type: 'status', environment, transport, result: { cStat: r.cStat, xMotivo: r.xMotivo }, success: r.cStat === '107', userId })
      return { ...base, online: r.cStat === '107', code: r.cStat, message: r.xMotivo, averageSeconds: r.tMed ? Number(r.tMed) : null, checkedAt: r.dhRecbto }
    } catch (error: any) {
      await this.event(this.db, { companyId: co.id, type: 'status', environment, transport, success: false, userId, error: error.message })
      return { ...base, online: false, code: null, message: `Sem resposta da SEFAZ: ${error.message}`, averageSeconds: null, checkedAt: null }
    }
  }

  async file(id: string) {
    const inv = await one(this.db, `SELECT access_key, xml, xml_proc, number, series FROM sales_invoices WHERE id = $1`, [id])
    if (!inv) throw new NotFoundException('Nota não encontrada')
    if (!inv.xml) throw new BadRequestException('Gere o XML da NF-e antes')
    return { xml: inv.xml_proc ?? `<?xml version="1.0" encoding="UTF-8"?>${inv.xml}`, name: `${inv.access_key}${inv.xml_proc ? '-procNFe' : '-nfe'}.xml`, authorized: !!inv.xml_proc }
  }

  async danfe(id: string) {
    const f = await this.file(id)
    const pdf = await new GerarDanfeUseCase().execute(f.xml)
    return { pdf: Buffer.from(pdf as any), name: f.name.replace(/\.xml$/, '.pdf') }
  }

  async defaultCompany() {
    const co = await one(this.db, `SELECT id FROM companies WHERE active ORDER BY is_head DESC, code LIMIT 1`)
    if (!co) throw new NotFoundException('Cadastre a empresa antes')
    return co.id as string
  }

  private async cnpjOf(db: Db, companyId: string) {
    return onlyDigits((await one(db, `SELECT document FROM companies WHERE id = $1`, [companyId]))!.document)
  }

}
