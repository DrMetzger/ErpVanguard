import { BadRequestException, Controller, Get, Logger, NotFoundException, Param, Query, ServiceUnavailableException } from '@nestjs/common'
import { ieValida, municipioPorCodigo, municipioPorNome, municipiosDaUf } from '../common/br'
import { digits } from '../common/db'
import { UFS } from './resources'

interface Cep { zip: string; street: string | null; complement: string | null; district: string | null; city: string | null; cityCode: string | null; uf: string | null }

// ViaCEP, BrasilAPI e OpenCEP: se um falhar, tenta o próximo.
const PROVIDERS = (): { name: string; url: (c: string) => string; map: (d: any) => Omit<Cep, 'zip'> | null }[] => {
  const via = (d: any) => (d.erro ? null : { street: d.logradouro || null, complement: d.complemento || null, district: d.bairro || null, city: d.localidade || null, cityCode: d.ibge || null, uf: d.uf || null })
  if (process.env.CEP_API_URL) return [{ name: 'teste', url: (c) => `${process.env.CEP_API_URL}/${c}`, map: via }]
  return [
    { name: 'ViaCEP', url: (c) => `https://viacep.com.br/ws/${c}/json/`, map: via },
    { name: 'BrasilAPI', url: (c) => `https://brasilapi.com.br/api/cep/v1/${c}`, map: (d) => ({ street: d.street || null, complement: null, district: d.neighborhood || null, city: d.city || null, cityCode: null, uf: d.state || null }) },
    { name: 'OpenCEP', url: (c) => `https://opencep.com/v1/${c}`, map: via },
  ]
}
const cache = new Map<string, Cep>()

@Controller()
export class BrController {
  private readonly log = new Logger('CEP')

  // Endereço pelo CEP, com o código IBGE do município (vai no XML).
  @Get('cep/:cep')
  async cep(@Param('cep') raw: string) {
    const zip = digits(raw)
    if (zip.length !== 8) throw new BadRequestException('CEP com 8 dígitos')
    if (cache.has(zip)) return cache.get(zip)
    let notFound = 0
    const providers = PROVIDERS()
    for (const p of providers) {
      try {
        const res = await fetch(p.url(zip), { signal: AbortSignal.timeout(6_000), headers: { Accept: 'application/json' } })
        if (res.status === 404 || res.status === 400) { notFound++; continue }
        if (!res.ok) { this.log.warn(`${p.name}: HTTP ${res.status}`); continue }
        const d = p.map(await res.json())
        if (!d) { notFound++; continue }
        const m = (d.cityCode && municipioPorCodigo(d.cityCode)) || (d.uf && d.city ? municipioPorNome(d.uf, d.city) : undefined)
        const out: Cep = { zip, ...d, city: m?.name ?? d.city, cityCode: m?.code ?? null }
        cache.set(zip, out)
        return out
      } catch (error: any) {
        this.log.warn(`${p.name}: ${error.message}`)
      }
    }
    if (notFound) throw new NotFoundException('CEP não encontrado')
    throw new ServiceUnavailableException('A busca de CEP não respondeu agora; preencha o endereço à mão')
  }

  // Municípios de uma UF (lista do IBGE) para o campo cidade.
  @Get('municipalities')
  municipalities(@Query('uf') uf = '') {
    if (!UFS.includes(uf.toUpperCase())) throw new BadRequestException('UF inválida')
    return municipiosDaUf(uf).map(({ code, name }) => ({ code, name }))
  }

  // Confere a inscrição estadual pela regra da UF (usado na tela ao sair do campo).
  @Get('validate/ie')
  ie(@Query('uf') uf = '', @Query('ie') ie = '') {
    if (!UFS.includes(uf.toUpperCase())) throw new BadRequestException('UF inválida')
    return { valid: !ie.trim() || ieValida(ie.trim(), uf) }
  }
}
