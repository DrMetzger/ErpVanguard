import { BadGatewayException, BadRequestException, Controller, ForbiddenException, Get, Logger, NotFoundException, Param, ParseUUIDPipe, Post, ServiceUnavailableException } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { CurrentUser } from '../auth/current-user.decorator'
import { can } from '../common/access'
import { digits, one } from '../common/db'
import { isValidCnpj } from '../purchasing/documents'
import { SettingsService } from '../settings/settings.service'
import type { User } from '../users/user.entity'

// BrasilAPI: consulta pública e gratuita dos dados do CNPJ na Receita Federal.
const CNPJ_API = () => process.env.CNPJ_API_URL ?? 'https://brasilapi.com.br/api/cnpj/v1'

export function mapCnpj(d: any) {
  const phone = (d.ddd_telefone_1 ?? '').replace(/\D/g, '')
  return {
    document: digits(d.cnpj), name: d.razao_social ?? null, tradeName: d.nome_fantasia || null, email: (d.email || '').toLowerCase() || null,
    phone: phone || null, zip: digits(d.cep) || null, street: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ') || null,
    number: d.numero || null, district: d.bairro || null, city: d.municipio ? String(d.municipio).replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/\B\w/g, (c: string) => c.toLowerCase()) : null,
    uf: d.uf || null, situation: d.descricao_situacao_cadastral ?? null, cnae: d.cnae_fiscal_descricao ?? null,
    simples: d.opcao_pelo_simples ?? null, mei: d.opcao_pelo_mei ?? null, openedAt: d.data_inicio_atividade ?? null,
  }
}

@Controller()
export class CreditController {
  private readonly log = new Logger('Credito')
  constructor(private readonly db: DataSource, private readonly settings: SettingsService) {}

  // Dados do CNPJ para preencher cadastros (cliente, fornecedor, empresa).
  @Get('cnpj/:document')
  async cnpj(@Param('document') document: string) {
    const cnpj = digits(document)
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido')
    let res: Response
    try {
      res = await fetch(`${CNPJ_API()}/${cnpj}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } })
    } catch (error: any) {
      this.log.warn(`Consulta de CNPJ falhou: ${error.message}`)
      throw new ServiceUnavailableException('A consulta de CNPJ na Receita não respondeu. Tente de novo em instantes.')
    }
    if (res.status === 404) throw new NotFoundException('CNPJ não encontrado na Receita Federal')
    if (res.status === 429) throw new ServiceUnavailableException('Muitas consultas seguidas; aguarde um minuto')
    if (!res.ok) throw new BadGatewayException(`A consulta de CNPJ respondeu com erro ${res.status}`)
    return mapCnpj(await res.json())
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
