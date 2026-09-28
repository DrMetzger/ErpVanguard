import forge from 'node-forge'
import { resolve } from 'node:path'
import {
  AUTORIZADOR_URLS, CancelaNFeUseCase, CartaCorrecaoUseCase, ConsultProtocolUseCase, DefaultXmlSigner, InutilizaNFeUseCase, NodeHttpSefazTransport,
  SefazRejectError, UF_AUTORIZADOR, XsdSchemaValidator, getSefazUrl,
  type CertificateData, type SefazRequest, type SefazResponse, type SefazTransport,
} from '@brasil-fiscal/nfe'
import { buildAutorizacaoEnvelope, extractSoapBody, parseAutorizacaoResponse, SOAP_ACTIONS } from '@brasil-fiscal/nfe/dist/infra/sefaz/soap'
import { NFE_NS, UF_CODE, brasiliaDateTime } from './nfe-xml'

// Encanamento da SEFAZ com a @brasil-fiscal/nfe (MIT): assinatura, XSD (xmllint), transporte mTLS, URLs e eventos.
// O XML da nota é nosso (nfe-xml.ts). Toda requisição e resposta fica guardada para auditoria (nfe_events).

export type Environment = 'homologacao' | 'producao'
const libEnv = (env: Environment) => (env === 'producao' ? 'production' : 'homologation') as 'production' | 'homologation'

// Abre o .pfx com o node-forge (aceita os A1 antigos em RC2/3DES que o OpenSSL 3 recusa) e regrava em 3DES
// para o TLS do Node. Não depende do binário openssl na imagem.
export function certificateFromPfx(pfxBase64: string, password: string): CertificateData {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(pfxBase64)), false, password)
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined
  if (!key) throw new Error('O certificado não tem a chave privada')
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[]
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n))
  if (!cert) throw new Error('Não achei no arquivo o certificado da chave privada')
  if (cert.validity.notAfter.getTime() < Date.now()) throw new Error(`Certificado vencido em ${cert.validity.notAfter.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  const chain = [cert, ...certs.filter((c) => c !== cert)]
  const pfx = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, chain, password, { algorithm: '3des' })).getBytes(), 'binary')
  return { pfx, password, notAfter: cert.validity.notAfter, privateKey: forge.pki.privateKeyToPem(key), certPem: forge.pki.certificateToPem(cert) }
}

export interface SefazCall { service: string; url: string; request: string; response: string | null; error: string | null }

// Transporte que registra tudo e, só fora de produção (testes), aceita a URL trocada por SEFAZ_URL_OVERRIDE.
export class AuditTransport implements SefazTransport {
  calls: SefazCall[] = []
  private inner: SefazTransport
  constructor(timeoutMs = Number(process.env.SEFAZ_TIMEOUT_MS) || 30_000) {
    this.inner = new NodeHttpSefazTransport({ timeout: timeoutMs, rejectUnauthorized: false })
  }

  static override() {
    const url = process.env.SEFAZ_URL_OVERRIDE
    return url && process.env.NODE_ENV !== 'production' ? url : null
  }

  async send(req: SefazRequest): Promise<SefazResponse> {
    const url = AuditTransport.override() ?? req.url
    const call: SefazCall = { service: req.soapAction.split('/').pop() ?? '', url, request: req.xml, response: null, error: null }
    this.calls.push(call)
    try {
      const res = await this.inner.send({ ...req, url })
      call.response = res.xml
      return res
    } catch (error: any) {
      call.error = String(error?.message ?? error)
      throw error
    }
  }

  last() {
    return this.calls[this.calls.length - 1]
  }
}

const signer = new DefaultXmlSigner()
export const signXml = (xml: string, cert: CertificateData) => signer.sign(xml, cert)

// Esquemas oficiais que vêm no pacote (node_modules/@brasil-fiscal/nfe/schemas), com os grupos da reforma (IBS/CBS).
const schemasDir = resolve(require.resolve('@brasil-fiscal/nfe/package.json'), '..', 'schemas')
const validator = new XsdSchemaValidator(schemasDir)

// Valida o <NFe> assinado dentro de um enviNFe (o XSD raiz é o nfe_v4.00.xsd).
export function validateXsd(signedNFe: string): { valid: boolean; errors: string[] } {
  try {
    const result = validator.validate(signedNFe.replace(/<\?xml[^?]*\?>\s*/, ''))
    return { valid: result.valid, errors: result.errors.map((e) => `${e.field}: ${e.message}`) }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { valid: false, errors: ['Validador XSD indisponível: o servidor precisa do xmllint (pacote libxml2-utils)'] }
    const stderr = String(error?.stderr ?? error?.message ?? error)
    return { valid: false, errors: stderr.split('\n').map((l) => l.replace(/^-:\d+:\s*/, '').trim()).filter((l) => l && !/fails to validate/.test(l)).slice(0, 30) }
  }
}

export function sefazUrl(uf: string, env: Environment, service: 'NFeAutorizacao' | 'NFeRetAutorizacao' | 'NFeConsultaProtocolo' | 'NFeStatusServico' | 'RecepcaoEvento' | 'NFeInutilizacao') {
  return getSefazUrl(uf, env, service)
}

export const autorizadorOf = (uf: string) => (UF_AUTORIZADOR as Record<string, string>)[uf] ?? null
export const hasUrls = (uf: string) => !!(AUTORIZADOR_URLS as Record<string, unknown>)[autorizadorOf(uf) ?? '']

const tagOf = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null
export const protNFeOf = (xml: string) => xml.match(/<protNFe[^>]*>[\s\S]*?<\/protNFe>/)?.[0] ?? null

export function nfeProc(signedNFe: string, protNFe: string) {
  // O protNFe vem com o namespace herdado da resposta; no nfeProc ele fica sob o mesmo namespace da NF-e.
  const prot = protNFe.replace(/^<protNFe[^>]*>/, '<protNFe versao="4.00">')
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NFE_NS}">${signedNFe.replace(/<\?xml[^?]*\?>\s*/g, '')}${prot}</nfeProc>`
}

export interface AuthResult { cStat: string; xMotivo: string; nProt?: string; dhRecbto?: string; protNFe?: string | null; nRec?: string | null }

const soap = (wsdl: string, inner: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
  + `<soap:Body><nfeDadosMsg xmlns="${NFE_NS}/wsdl/${wsdl}">${inner}</nfeDadosMsg></soap:Body></soap:Envelope>`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Autorização síncrona (indSinc=1). Se a SEFAZ responder "lote recebido/em processamento" (103/105), consulta o recibo.
export async function authorize(transport: AuditTransport, cert: CertificateData, uf: string, env: Environment, signedNFe: string, idLote: string): Promise<AuthResult> {
  const res = await transport.send({ url: sefazUrl(uf, env, 'NFeAutorizacao'), soapAction: SOAP_ACTIONS.NFeAutorizacao4, xml: buildAutorizacaoEnvelope(signedNFe, idLote), pfx: cert.pfx, password: cert.password })
  const body = extractSoapBody(res.xml)
  const parsed = parseAutorizacaoResponse(body)
  if (parsed.cStat === '103' || parsed.cStat === '105') {
    const nRec = tagOf(body, 'nRec')
    if (!nRec) return { cStat: parsed.cStat, xMotivo: parsed.xMotivo, nRec: null }
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(Number(process.env.SEFAZ_RECIBO_WAIT_MS ?? 2000) * (attempt + 1))
      const r = await consultReceipt(transport, cert, uf, env, nRec)
      if (r.cStat !== '105') return r
    }
    return { cStat: '105', xMotivo: 'Lote em processamento na SEFAZ', nRec }
  }
  return { cStat: parsed.cStat, xMotivo: parsed.xMotivo, nProt: parsed.nProt, dhRecbto: parsed.dhRecbto, protNFe: protNFeOf(body) }
}

export async function consultReceipt(transport: AuditTransport, cert: CertificateData, uf: string, env: Environment, nRec: string): Promise<AuthResult> {
  const inner = `<consReciNFe versao="4.00" xmlns="${NFE_NS}"><tpAmb>${env === 'producao' ? 1 : 2}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`
  const res = await transport.send({ url: sefazUrl(uf, env, 'NFeRetAutorizacao'), soapAction: `${NFE_NS}/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote`, xml: soap('NFeRetAutorizacao4', inner), pfx: cert.pfx, password: cert.password })
  const body = extractSoapBody(res.xml)
  const prot = protNFeOf(body)
  const source = prot ?? body
  return { cStat: tagOf(source, 'cStat') ?? tagOf(body, 'cStat') ?? '', xMotivo: tagOf(source, 'xMotivo') ?? '', nProt: tagOf(source, 'nProt') ?? undefined, dhRecbto: tagOf(source, 'dhRecbto') ?? undefined, protNFe: prot, nRec }
}

// Consulta a situação da NF-e pela chave (antes de reenviar, para nunca emitir duas vezes).
export async function consultKey(transport: AuditTransport, cert: CertificateData, env: Environment, key: string): Promise<AuthResult> {
  const useCase = new ConsultProtocolUseCase({ certificate: { load: async () => cert }, transport, environment: libEnv(env) } as any)
  try {
    const r = await useCase.execute(key)
    const body = transport.last()?.response ?? ''
    return { cStat: r.codigoStatus, xMotivo: r.motivo, nProt: r.protocolo, dhRecbto: r.dataAutorizacao?.toISOString(), protNFe: protNFeOf(body) }
  } catch (error) {
    if (error instanceof SefazRejectError) {
      const body = transport.last()?.response ?? ''
      return { cStat: (error as any).code ?? (error as any).cStat ?? tagOf(body, 'cStat') ?? '', xMotivo: tagOf(body, 'xMotivo') ?? error.message, protNFe: protNFeOf(body) }
    }
    throw error
  }
}

export async function serviceStatus(transport: AuditTransport, cert: CertificateData, uf: string, env: Environment) {
  const inner = `<consStatServ versao="4.00" xmlns="${NFE_NS}"><tpAmb>${env === 'producao' ? 1 : 2}</tpAmb><cUF>${UF_CODE[uf]}</cUF><xServ>STATUS</xServ></consStatServ>`
  const res = await transport.send({ url: sefazUrl(uf, env, 'NFeStatusServico'), soapAction: `${NFE_NS}/wsdl/NFeStatusServico4/nfeStatusServicoNF`, xml: soap('NFeStatusServico4', inner), pfx: cert.pfx, password: cert.password })
  const body = extractSoapBody(res.xml)
  return { cStat: tagOf(body, 'cStat') ?? '', xMotivo: tagOf(body, 'xMotivo') ?? '', tMed: tagOf(body, 'tMed'), dhRecbto: tagOf(body, 'dhRecbto') }
}

export interface EventResult { ok: boolean; cStat: string; xMotivo: string; nProt?: string; dhRegEvento?: string }

const rejectResult = (error: unknown, transport: AuditTransport): EventResult => {
  const body = transport.last()?.response ?? ''
  const src = body.match(/<(?:retEvento|infInut)[^>]*>[\s\S]*?<\/(?:retEvento|infInut)>/)?.[0] ?? body
  return { ok: false, cStat: tagOf(src, 'cStat') ?? '', xMotivo: tagOf(src, 'xMotivo') ?? (error as Error).message }
}

// Texto livre de evento: a biblioteca não escapa; tiramos o que quebraria o XML.
const eventText = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim().replace(/&/g, 'e').replace(/[<>]/g, '')

export async function cancelEvent(transport: AuditTransport, cert: CertificateData, env: Environment, input: { key: string; cnpj: string; protocol: string; reason: string }): Promise<EventResult> {
  const useCase = new CancelaNFeUseCase({ certificate: { load: async () => cert }, transport, xmlSigner: signer, environment: libEnv(env) } as any)
  try {
    const r = await useCase.execute({ chaveAcesso: input.key, cnpj: input.cnpj, protocolo: input.protocol, justificativa: eventText(input.reason) })
    return { ok: true, cStat: r.cStat, xMotivo: r.xMotivo, nProt: r.nProt, dhRegEvento: r.dhRegEvento }
  } catch (error) {
    if (!(error instanceof SefazRejectError)) throw error
    const r = rejectResult(error, transport)
    // 155 = cancelamento homologado fora de prazo: vale como cancelada
    return r.cStat === '155' ? { ...r, ok: true, nProt: tagOf(transport.last()?.response ?? '', 'nProt') ?? undefined } : r
  }
}

export async function correctionEvent(transport: AuditTransport, cert: CertificateData, env: Environment, input: { key: string; cnpj: string; text: string; sequence: number }): Promise<EventResult> {
  const useCase = new CartaCorrecaoUseCase({ certificate: { load: async () => cert }, transport, xmlSigner: signer, environment: libEnv(env) } as any)
  try {
    const r = await useCase.execute({ chaveAcesso: input.key, cnpj: input.cnpj, correcao: eventText(input.text), sequencia: input.sequence })
    return { ok: true, cStat: r.cStat, xMotivo: r.xMotivo, nProt: r.nProt, dhRegEvento: r.dhRegEvento }
  } catch (error) {
    if (!(error instanceof SefazRejectError)) throw error
    return rejectResult(error, transport)
  }
}

export async function voidRange(transport: AuditTransport, cert: CertificateData, env: Environment, input: { cnpj: string; uf: string; series: number; from: number; to: number; reason: string }): Promise<EventResult> {
  const useCase = new InutilizaNFeUseCase({ certificate: { load: async () => cert }, transport, xmlSigner: signer, environment: libEnv(env) } as any)
  try {
    const r = await useCase.execute({ cnpj: input.cnpj, uf: input.uf, ano: Number(brasiliaDateTime(new Date()).slice(0, 4)), serie: input.series, numeroInicial: input.from, numeroFinal: input.to, justificativa: eventText(input.reason) } as any)
    return { ok: true, cStat: r.cStat, xMotivo: r.xMotivo, nProt: r.nProt, dhRegEvento: r.dhRecbto }
  } catch (error) {
    if (!(error instanceof SefazRejectError)) throw error
    return rejectResult(error, transport)
  }
}

// Dicas para as rejeições mais comuns.
const HINTS: Record<string, string> = {
  '204': 'A SEFAZ já tem esta nota (duplicidade): use "Transmitir" de novo para consultar pela chave e buscar o protocolo.',
  '206': 'Número já inutilizado na SEFAZ: avance a numeração da série.',
  '207': 'CNPJ do emitente inválido: confira o cadastro da empresa.',
  '209': 'IE do emitente inválida: confira a inscrição estadual da empresa.',
  '210': 'IE do destinatário inválida: confira o cadastro do cliente ou marque como não contribuinte.',
  '213': 'CNPJ-Base do emitente difere do CNPJ-Base do certificado digital.',
  '215': 'Falha no schema XML: confira os dados (use "Gerar e validar XML").',
  '225': 'Falha no schema XML da NF-e.',
  '228': 'Data de emissão muito atrasada: gere o XML de novo.',
  '233': 'IE do destinatário não cadastrada na SEFAZ.',
  '242': 'Certificado ou cadeia não confiável para a SEFAZ.',
  '280': 'Certificado digital inválido para a SEFAZ.',
  '297': 'Assinatura difere do calculado: gere o XML de novo.',
  '301': 'Uso denegado: irregularidade fiscal do emitente.',
  '302': 'Uso denegado: irregularidade fiscal do destinatário.',
  '321': 'Nota de devolução precisa do documento referenciado.',
  '327': 'CFOP de entrada em nota de saída: confira a TES.',
  '386': 'CFOP incompatível com o destino da operação (interna × interestadual): confira a TES/matriz fiscal.',
  '482': 'Código de município do destinatário ou emitente inválido: confira o código IBGE.',
  '484': 'Chave de acesso com dígito verificador errado.',
  '531': 'Total da BC do ICMS difere da soma dos itens.',
  '532': 'Total do ICMS difere da soma dos itens.',
  '539': 'Duplicidade com chave diferente: já existe NF-e autorizada com este número e série. Consulte a chave indicada na mensagem ou avance a numeração.',
  '564': 'Total do produto difere da soma dos itens.',
  '610': 'Total da NF difere do somatório dos valores.',
  '611': 'GTIN (código de barras) inválido: confira o cadastro do produto.',
  '629': 'Valor do produto difere de quantidade × valor unitário.',
  '656': 'Consumo indevido: a SEFAZ bloqueou por excesso de consultas; aguarde alguns minutos.',
  '694': 'Venda interestadual a não contribuinte sem o grupo de DIFAL (ICMSUFDest).',
  '696': 'Operação com não contribuinte deve indicar consumidor final.',
  '778': 'NCM inexistente: confira o NCM do produto.',
}
export const hintFor = (cStat: string) => HINTS[cStat] ?? null
