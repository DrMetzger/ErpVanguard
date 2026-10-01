// Cliente da WhatsApp Cloud API (Meta). Fora de produção, WHATSAPP_API_URL troca o endereço (testes com servidor falso).
const BASE = () => (process.env.WHATSAPP_API_URL && process.env.NODE_ENV !== 'production' ? process.env.WHATSAPP_API_URL : 'https://graph.facebook.com').replace(/\/$/, '')
export const DEFAULT_API_VERSION = 'v23.0'

export interface WaConfig { phoneNumberId: string; accessToken: string; apiVersion?: string }
export class WhatsAppError extends Error {
  constructor(message: string, public code?: number, public details?: unknown) { super(message) }
}

// Mensagens comuns da Meta em português.
const KNOWN: Record<number, string> = {
  190: 'token de acesso inválido ou expirado (gere um token permanente no Business Manager)',
  131030: 'o número de destino não está na lista de teste do app (no modo de desenvolvimento só números cadastrados recebem)',
  131047: 'o cliente não falou com você nas últimas 24 horas: use um modelo de mensagem aprovado',
  131026: 'o número não tem WhatsApp ou não pode receber a mensagem',
  132001: 'o modelo de mensagem não existe ou não está aprovado neste idioma',
  132000: 'a quantidade de variáveis do modelo não confere',
  100: 'parâmetro inválido',
}

async function graph<T>(cfg: WaConfig, path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const url = `${BASE()}/${cfg.apiVersion || DEFAULT_API_VERSION}/${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method ?? (init.json || init.form ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${cfg.accessToken}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
      body: init.json ? JSON.stringify(init.json) : init.form,
      signal: AbortSignal.timeout(25_000),
    })
  } catch (e) {
    throw new WhatsAppError(`Não foi possível falar com a Meta (${(e as Error).name === 'TimeoutError' ? 'tempo esgotado' : (e as Error).message})`)
  }
  const data: any = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    const err = data?.error ?? {}
    const code = Number(err.code) || res.status
    const sub = Number(err.error_subcode) || 0
    const known = KNOWN[sub] ?? KNOWN[code]
    const detail = err.error_data?.details ?? err.message ?? `HTTP ${res.status}`
    throw new WhatsAppError(known ? `${known} (${detail})` : `A Meta recusou: ${detail}`, code, data)
  }
  return data as T
}

// Número no formato internacional, só dígitos (Brasil: acrescenta 55 quando vier só DDD + número).
export function waNumber(raw: string | null | undefined) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) d = '55' + d
  return d.length >= 12 && d.length <= 15 ? d : null
}

// Variável de modelo não aceita quebra de linha, tabulação nem mais de 4 espaços seguidos.
export const templateText = (s: string, max = 900) => s.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, max)

export const phoneInfo = (cfg: WaConfig) =>
  graph<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(cfg, `${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`)

type SendResult = { messages: { id: string }[] }
const send = (cfg: WaConfig, to: string, payload: Record<string, unknown>) =>
  graph<SendResult>(cfg, `${cfg.phoneNumberId}/messages`, { json: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload } }).then((r) => r.messages?.[0]?.id ?? null)

export const sendText = (cfg: WaConfig, to: string, body: string) => send(cfg, to, { type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } })

export const sendDocument = (cfg: WaConfig, to: string, mediaId: string, filename: string, caption?: string) =>
  send(cfg, to, { type: 'document', document: { id: mediaId, filename, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } })

// Modelo aprovado: cabeçalho com documento (opcional) e as variáveis do corpo ({{1}}, {{2}}…).
export function sendTemplate(cfg: WaConfig, to: string, name: string, language: string, body: string[], document?: { id: string; filename: string }) {
  const components: unknown[] = []
  if (document) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: document.id, filename: document.filename } }] })
  if (body.length) components.push({ type: 'body', parameters: body.map((text) => ({ type: 'text', text: templateText(text) })) })
  return send(cfg, to, { type: 'template', template: { name, language: { code: language || 'pt_BR' }, ...(components.length ? { components } : {}) } })
}

export async function uploadMedia(cfg: WaConfig, file: Buffer, mime: string, filename: string) {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mime)
  form.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename)
  const r = await graph<{ id: string }>(cfg, `${cfg.phoneNumberId}/media`, { form })
  return r.id
}
