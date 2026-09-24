// Similaridade simples entre descrições (sem IA), usada como sugestão e para
// escolher os candidatos enviados ao Gemini.
const STOP = new Set(['de', 'da', 'do', 'com', 'para', 'e', 'em', 'a', 'o'])

export function tokens(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9,.]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/[.,]+$/, ''))
    .filter((t) => t.length > 1 && !STOP.has(t))
}

// Cada token conta como igual quando um é prefixo do outro (PARAF ~ parafuso).
export function similarity(a: string, b: string) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const hits = ta.filter((x) => tb.some((y) => (x.length >= 3 && y.length >= 3 ? y.startsWith(x) || x.startsWith(y) : x === y))).length
  return hits / Math.max(ta.length, tb.length)
}
