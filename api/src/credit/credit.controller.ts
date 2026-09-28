import { BadRequestException, Controller, ForbiddenException, Get, Logger, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { can } from '../common/access'
import { digits, one } from '../common/db'
import { municipioPorCodigo, municipioPorNome } from '../common/br'
import { isValidCnpj } from '../purchasing/documents'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'

// Consulta pública e gratuita do CNPJ na Receita Federal. Se um serviço falhar ou bloquear (403/429), tenta o próximo.
const title = (s?: string | null) => (s ? String(s).toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase()) : null)
const phoneDigits = (s?: string | null) => { const d = digits(s ?? ''); return d.length >= 10 && d.length <= 11 ? d : null }
const cnaeFmt = (code: unknown) => { const d = digits(String(code ?? '')).padStart(7, '0'); return d === '0000000' ? '' : `${d.slice(0, 4)}-${d[4]}/${d.slice(5)}` }
const isoDate = (s?: string | null) => { if (!s) return null; const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).slice(0, 10) }

interface Cnpj {
  document: string; name: string | null; tradeName: string | null; email: string | null; phone: string | null; phone2: string | null
  zip: string | null; street: string | null; number: string | null; complement: string | null; district: string | null
  city: string | null; cityCode: string | null; uf: string | null; ie: string | null; situation: string | null; cnae: string | null
  simples: boolean | null; mei: boolean | null; openedAt: string | null; receita: Record<string, unknown>
}

function finish(c: Omit<Cnpj, 'cnae' | 'receita'>, extra: { cnaePrincipal: { code: string; description: string } | null; secundarios: { code: string; description: string }[]; natureza: string | null; porte: string | null; capital: number | null; socios: { nome: string; qualificacao: string | null }[]; situacaoData: string | null; fonte: string }): Cnpj {
  const m = (c.cityCode && municipioPorCodigo(c.cityCode)) || (c.uf && c.city ? municipioPorNome(c.uf, c.city) : undefined)
  const cnae = extra.cnaePrincipal ? `${extra.cnaePrincipal.code} · ${extra.cnaePrincipal.description}` : null
  return {
    ...c, city: m?.name ?? c.city, cityCode: m?.code ?? null, cnae,
    receita: {
      situacao: c.situation, dataSituacao: extra.situacaoData, abertura: c.openedAt, naturezaJuridica: extra.natureza, porte: extra.porte, capitalSocial: extra.capital,
      cnaePrincipal: extra.cnaePrincipal, cnaesSecundarios: extra.secundarios, simples: c.simples, mei: c.mei, socios: extra.socios,
      fonte: extra.fonte, consultadoEm: new Date().toISOString(),
    },
  }
}

// BrasilAPI e Minha Receita usam o mesmo formato (dados abertos da Receita).
export function mapCnpj(d: any, fonte = 'BrasilAPI'): Cnpj {
  return finish({
    document: digits(d.cnpj), name: d.razao_social ?? null, tradeName: d.nome_fantasia || null, email: (d.email || '').toLowerCase() || null,
    phone: phoneDigits(d.ddd_telefone_1), phone2: phoneDigits(d.ddd_telefone_2), zip: digits(d.cep ?? '') || null,
    street: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ') || null, number: d.numero || null, complement: d.complemento || null,
    district: d.bairro || null, city: title(d.municipio), cityCode: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge) : null, uf: d.uf || null, ie: null,
    situation: d.descricao_situacao_cadastral ?? null, simples: d.opcao_pelo_simples ?? null, mei: d.opcao_pelo_mei ?? null, openedAt: d.data_inicio_atividade ?? null,
  }, {
    cnaePrincipal: d.cnae_fiscal ? { code: cnaeFmt(d.cnae_fiscal), description: d.cnae_fiscal_descricao ?? '' } : null,
    secundarios: (d.cnaes_secundarios ?? []).filter((x: any) => x.codigo).map((x: any) => ({ code: cnaeFmt(x.codigo), description: x.descricao ?? '' })),
    natureza: d.natureza_juridica ?? null, porte: d.porte ?? null, capital: d.capital_social != null ? Number(d.capital_social) : null,
    socios: (d.qsa ?? []).map((x: any) => ({ nome: x.nome_socio, qualificacao: x.qualificacao_socio ?? null })), situacaoData: d.data_situacao_cadastral ?? null, fonte,
  })
}

// CNPJ.ws (pública): traz também as inscrições estaduais.
function mapCnpjWs(d: any): Cnpj {
  const e = d.estabelecimento ?? {}
  const uf = e.estado?.sigla ?? null
  const ie = (e.inscricoes_estaduais ?? []).find((i: any) => i.ativo && i.estado?.sigla === uf)?.inscricao_estadual ?? null
  const act = (a: any) => ({ code: cnaeFmt(a.subclasse ?? a.id), description: a.descricao ?? '' })
  return finish({
    document: digits(e.cnpj), name: d.razao_social ?? null, tradeName: e.nome_fantasia || null, email: (e.email || '').toLowerCase() || null,
    phone: phoneDigits(`${e.ddd1 ?? ''}${e.telefone1 ?? ''}`), phone2: phoneDigits(`${e.ddd2 ?? ''}${e.telefone2 ?? ''}`), zip: digits(e.cep ?? '') || null,
    street: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ') || null, number: e.numero || null, complement: e.complemento || null, district: e.bairro || null,
    city: e.cidade?.nome ?? null, cityCode: e.cidade?.ibge_id ? String(e.cidade.ibge_id) : null, uf, ie: ie ? digits(ie) : null,
    situation: e.situacao_cadastral ? String(e.situacao_cadastral).toUpperCase() : null, simples: d.simples ? d.simples.simples === 'Sim' : null, mei: d.simples ? d.simples.mei === 'Sim' : null,
    openedAt: e.data_inicio_atividade ?? null,
  }, {
    cnaePrincipal: e.atividade_principal ? act(e.atividade_principal) : null, secundarios: (e.atividades_secundarias ?? []).map(act),
    natureza: d.natureza_juridica?.descricao ?? null, porte: d.porte?.descricao ?? null, capital: d.capital_social != null ? Number(d.capital_social) : null,
    socios: (d.socios ?? []).map((x: any) => ({ nome: x.nome, qualificacao: x.qualificacao_socio?.descricao ?? null })), situacaoData: e.data_situacao_cadastral ?? null, fonte: 'CNPJ.ws',
  })
}

// ReceitaWS (pública, 3 consultas por minuto).
function mapReceitaWs(d: any): Cnpj {
  if (d.status === 'ERROR') throw Object.assign(new Error(d.message ?? 'erro'), { notFound: /inv[aá]lido|n[aã]o encontrado/i.test(d.message ?? '') })
  const [p1, p2] = String(d.telefone ?? '').split('/').map((s) => phoneDigits(s))
  const act = (a: any) => ({ code: String(a.code ?? '').replace(/\./g, ''), description: a.text ?? '' })
  return finish({
    document: digits(d.cnpj), name: d.nome ?? null, tradeName: d.fantasia || null, email: (d.email || '').toLowerCase() || null, phone: p1 ?? null, phone2: p2 ?? null,
    zip: digits(d.cep ?? '') || null, street: d.logradouro || null, number: d.numero || null, complement: d.complemento || null, district: d.bairro || null,
    city: title(d.municipio), cityCode: null, uf: d.uf || null, ie: null, situation: d.situacao ?? null,
    simples: d.simples ? !!d.simples.optante : null, mei: d.simei ? !!d.simei.optante : null, openedAt: isoDate(d.abertura),
  }, {
    cnaePrincipal: d.atividade_principal?.[0] ? act(d.atividade_principal[0]) : null, secundarios: (d.atividades_secundarias ?? []).filter((a: any) => a.code && a.code !== '00.00-0-00').map(act),
    natureza: d.natureza_juridica ?? null, porte: d.porte ?? null, capital: d.capital_social ? Number(d.capital_social) : null,
    socios: (d.qsa ?? []).map((x: any) => ({ nome: x.nome, qualificacao: x.qual ?? null })), situacaoData: isoDate(d.data_situacao), fonte: 'ReceitaWS',
  })
}

const PROVIDERS = (): { name: string; url: (c: string) => string; map: (d: any) => Cnpj }[] =>
  process.env.CNPJ_API_URL
    ? [{ name: 'teste', url: (c) => `${process.env.CNPJ_API_URL}/${c}`, map: (d) => mapCnpj(d) }]
    : [
        { name: 'BrasilAPI', url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, map: (d) => mapCnpj(d) },
        { name: 'CNPJ.ws', url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, map: mapCnpjWs },
        { name: 'Minha Receita', url: (c) => `https://minhareceita.org/${c}`, map: (d) => mapCnpj(d, 'Minha Receita') },
        { name: 'ReceitaWS', url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`, map: mapReceitaWs },
      ]

const cache = new Map<string, { at: number; data: Cnpj }>()

@Controller()
export class CreditController {
  private readonly log = new Logger('Credito')
  constructor(private readonly db: DataSource, private readonly settings: SettingsService) {}

  // Dados do CNPJ para preencher cadastros (cliente, fornecedor, empresa).
  @Get('cnpj/:document')
  async cnpj(@Param('document') document: string) {
    const cnpj = digits(document)
    if (cnpj.length === 11) throw new BadRequestException('A Receita não tem consulta pública de CPF; o CPF é conferido pelos dígitos. Preencha os dados à mão.')
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido: confira os números')
    const hit = cache.get(cnpj)
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data
    let notFound = 0
    const providers = PROVIDERS()
    for (const p of providers) {
      try {
        const res = await fetch(p.url(cnpj), { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json', 'User-Agent': 'ERP-Vanguard/1.0' } })
        if (res.status === 404 || res.status === 400) { notFound++; continue }
        if (!res.ok) { this.log.warn(`CNPJ ${p.name}: HTTP ${res.status}`); continue }
        const data = p.map(await res.json())
        if (!data.name) { notFound++; continue }
        if (!data.ie && p.name !== 'CNPJ.ws') await this.fillIe(cnpj, data)
        cache.set(cnpj, { at: Date.now(), data })
        return data
      } catch (error: any) {
        if (error.notFound) { notFound++; continue }
        this.log.warn(`CNPJ ${p.name}: ${error.message}`)
      }
    }
    if (notFound && notFound >= Math.min(2, providers.length)) throw new NotFoundException('CNPJ não encontrado na Receita Federal')
    throw new ServiceUnavailableException('Os serviços de consulta da Receita não responderam agora. Tente de novo em um minuto ou preencha à mão.')
  }

  // Só o CNPJ.ws traz a inscrição estadual (dados do Sintegra); quando outro serviço respondeu, busca a IE lá.
  private async fillIe(cnpj: string, data: Cnpj) {
    const base = process.env.CNPJ_IE_URL ?? (process.env.CNPJ_API_URL ? null : 'https://publica.cnpj.ws/cnpj')
    if (!base) return
    try {
      const res = await fetch(`${base}/${cnpj}`, { signal: AbortSignal.timeout(6_000), headers: { Accept: 'application/json', 'User-Agent': 'ERP-Vanguard/1.0' } })
      if (!res.ok) return
      const ws = mapCnpjWs(await res.json())
      data.ie = ws.ie
      data.phone ??= ws.phone
      data.phone2 ??= ws.phone2
      data.email ??= ws.email
    } catch (error: any) {
      this.log.warn(`IE pelo CNPJ.ws: ${error.message}`)
    }
  }

  // Consulta de crédito na Serasa (API paga). Sem contrato, fica em espera com orientação.
  @Post('customers/:id/serasa')
  async serasa(@CurrentUser() me: User, @Param('id', ParseUUIDPipe) id: string) {
    if (!['vendedor', 'faturamento', 'financeiro', 'cadastro'].some((p) => can(me, p as any))) throw new ForbiddenException('Seu usuário não pode consultar crédito')
    const customer = await one(this.db, `SELECT id, document, name FROM customers WHERE id = $1`, [id])
    if (!customer) throw new NotFoundException('Cliente não encontrado')
    const cfg = await this.settings.serasa()
    if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
      throw new ServiceUnavailableException('Consulta Serasa em espera: a API da Serasa Experian é paga (contrato). Um administrador ativa em Configurações › Serasa com as chaves do contrato.')
    }
    // Chaves configuradas: a chamada depende do produto contratado (ex.: Relato, Credit Rating) e do endpoint informado no contrato.
    throw new ServiceUnavailableException(`Chaves da Serasa salvas (${cfg.environment}). Falta ligar o produto contratado: envie ao suporte o nome do produto e o manual da API para ativarmos a consulta.`)
  }
}
