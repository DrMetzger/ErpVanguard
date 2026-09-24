// Testa a integração com o Gemini simulando a API do Google (sem rede, sem chave real).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.DATABASE_URL ??= 'postgres://x'
process.env.JWT_SECRET ??= 'x'
process.env.GEMINI_API_KEY = 'chave-falsa'
process.env.GEMINI_MODEL = 'modelo-teste'
const { matchWithGemini } = createRequire(import.meta.url)('../dist/purchasing/gemini.js')

const items = [
  { itemNumber: 1, description: 'PARAF SEXT 5MM ZB', supplierCode: 'A1', ean: null, ncm: '73181500', unit: 'UN' },
  { itemNumber: 2, description: 'COISA SEM PAR', supplierCode: 'A2', ean: null, ncm: null, unit: 'UN' },
]
const candidates = [{ id: 'p-1', sku: 'PAR', name: 'Parafuso sextavado 5mm zincado', ncm: '73181500', unit: 'UN' }]

let request
const reply = (text, status = 200) => async (url, init) => {
  request = { url, init }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status })
}

globalThis.fetch = reply(JSON.stringify([
  { itemNumber: 1, productId: 'p-1', confidence: 0.93, reason: 'mesma medida e NCM' },
  { itemNumber: 2, productId: 'produto-inventado', confidence: 0.9, reason: 'chute' },
  { itemNumber: 99, productId: 'p-1', confidence: 1, reason: 'item que não existe' },
]))
const result = await matchWithGemini(items, candidates)
assert.ok(request.url.includes('/models/modelo-teste:generateContent'))
assert.equal(request.init.headers['x-goog-api-key'], 'chave-falsa')
assert.ok(!request.url.includes('chave-falsa'), 'a chave não deve ir na URL')
assert.equal(JSON.parse(request.init.body).generationConfig.responseMimeType, 'application/json')
assert.deepEqual(result.map((r) => [r.itemNumber, r.productId]), [[1, 'p-1'], [2, null]])
console.log('  ✓ usa o modelo configurado, chave no cabeçalho, e descarta produto inventado e item inexistente')

globalThis.fetch = reply('isso não é json')
await assert.rejects(() => matchWithGemini(items, candidates), /inválida/)
globalThis.fetch = async () => new Response('quota', { status: 429 })
await assert.rejects(() => matchWithGemini(items, candidates), /429/)
console.log('  ✓ resposta inválida ou erro do Google viram erro tratado')
