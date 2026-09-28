import { Logger } from '@nestjs/common'

export interface AiItem {
  itemNumber: number
  description: string
  supplierCode: string
  ean: string | null
  ncm: string | null
  unit: string
}
export interface AiCandidate {
  id: string
  sku: string
  name: string
  ncm: string | null
  unit: string
}
export interface AiMatch {
  itemNumber: number
  productId: string | null
  confidence: number
  reason: string
}

const logger = new Logger('Gemini')
const RETRIES = 2
const RETRYABLE = new Set([429, 500, 503])
// Exposto para os testes não esperarem de verdade.
export let retryDelayMs = 2000
export const setRetryDelay = (ms: number) => { retryDelayMs = ms }

export interface GeminiOptions { apiKey: string | null; model: string; fallbackModels: string[] }

// Pede ao Gemini para ligar cada item da nota a um produto do cadastro.
// Só devolve produtos que existem na lista enviada; o resto vira null.
export async function matchWithGemini(items: AiItem[], candidates: AiCandidate[], opts: GeminiOptions, deadlineMs?: number): Promise<{ matches: AiMatch[]; model: string | null }> {
  if (!opts.apiKey || !items.length || !candidates.length) return { matches: [], model: null }

  const prompt = `Você é um assistente de compras de um ERP brasileiro.
Associe cada item de uma nota fiscal de entrada (NF-e) ao produto correspondente do cadastro da empresa.
Considere abreviações comuns em notas (PARAF = parafuso, SEXT = sextavado, ZB = zincado branco, CX = caixa, etc.),
medidas, marca, NCM e unidade. Se não houver produto equivalente com segurança, use null.
Responda somente com JSON no formato: [{"itemNumber": number, "productId": string|null, "confidence": number de 0 a 1, "reason": "explicação curta em português"}]

ITENS DA NOTA:
${JSON.stringify(items)}

PRODUTOS DO CADASTRO:
${JSON.stringify(candidates)}`

  const { parsed, model: used } = await generateJson(prompt, opts, deadlineMs)
  const valid = new Set(candidates.map((c) => c.id))
  const numbersSent = new Set(items.map((i) => i.itemNumber))
  // O modelo às vezes embrulha a lista num objeto ({"items": [...]}).
  const list = Array.isArray(parsed) ? parsed : (Object.values(parsed ?? {}).find(Array.isArray) as any[] | undefined) ?? []
  const matches = list
    .filter((m: any) => numbersSent.has(Number(m?.itemNumber)))
    .map((m: any) => ({
      itemNumber: Number(m.itemNumber),
      productId: typeof m.productId === 'string' && valid.has(m.productId) ? m.productId : null,
      confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
      reason: String(m.reason ?? '').slice(0, 300),
    }))
  return { matches, model: used }
}

// Chamada genérica ao Gemini pedindo JSON: modelo principal, reservas e novas tentativas.
// deadlineMs: tempo total para todas as tentativas (o teste da tela usa pouco para não parecer travado).
export async function generateJson(prompt: string, opts: GeminiOptions, deadlineMs = 120_000): Promise<{ parsed: any; model: string | null }> {
  const deadline = Date.now() + deadlineMs
  const left = () => deadline - Date.now()
  const request = (model: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey! },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(45_000, left()))),
    })

  // Cada modelo tenta algumas vezes em 429/5xx; se continuar lotado (ou não
  // existir mais), passa para o próximo da lista de reserva.
  const models = [...new Set([opts.model, ...opts.fallbackModels])]
  let res: Response | null = null
  let used: string | null = null
  let timedOut = false
  outer: for (const model of models) {
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      if (left() <= 1_000) { timedOut = true; break outer }
      try {
        res = await request(model)
      } catch (error: any) {
        // Sem resposta (demorou ou caiu a conexão): passa para o próximo modelo.
        logger.warn(`${model} não respondeu: ${error.name === 'TimeoutError' ? 'tempo esgotado' : error.message}`)
        res = null
        break
      }
      if (res.ok) {
        used = model
        if (model !== opts.model) logger.warn(`Usando modelo reserva ${model}`)
        break outer
      }
      if (res.status === 404) break // modelo descontinuado: próximo
      if (!RETRYABLE.has(res.status)) break outer // erro definitivo (chave, requisição)
      if (attempt < RETRIES) {
        logger.warn(`${model} respondeu ${res.status}, tentando de novo (${attempt + 1}/${RETRIES})`)
        await new Promise((r) => setTimeout(r, Math.min(retryDelayMs * attempt, Math.max(0, left() - 1_000))))
      }
    }
    logger.warn(`${model} indisponível (${res?.status ?? 'sem resposta'}), tentando o próximo modelo`)
  }
  if (timedOut || !res) {
    throw new Error(`O Gemini não respondeu em ${Math.round(deadlineMs / 1000)} segundos (modelos tentados: ${models.join(', ')}). Tente de novo em instantes ou troque o modelo principal.`)
  }
  if (!res.ok) {
    const status = res?.status ?? 0
    logger.error(`Gemini respondeu ${status}: ${res ? (await res.text()).slice(0, 300) : ''}`)
    throw new Error(RETRYABLE.has(status) || status === 404 ? 'O Gemini está sobrecarregado agora. Tente de novo em alguns instantes.' : `O Gemini respondeu com erro ${status}`)
  }
  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '[]'

  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    logger.error(`Resposta do Gemini não é JSON: ${text.slice(0, 300)}`)
    throw new Error('Resposta inválida do Gemini')
  }
  return { parsed, model: used }
}
