// Máscaras prontas (o servidor confere o mesmo formato).
export const MASKS = [
  { value: 'cpf', label: 'CPF · 999.999.999-99' }, { value: 'cnpj', label: 'CNPJ · 99.999.999/9999-99' }, { value: 'cpf_cnpj', label: 'CPF ou CNPJ' },
  { value: 'cep', label: 'CEP · 99999-999' }, { value: 'telefone', label: 'Telefone · (99) 99999-9999' }, { value: 'placa', label: 'Placa · AAA-9999 ou AAA9A99' },
]

// Formata enquanto digita. 9 = dígito, A = letra, * = qualquer.
export function applyMask(mask: string | null, raw: string): string {
  if (!mask) return raw
  const digits = raw.replace(/\D/g, '')
  const pattern = ({
    cpf: '999.999.999-99', cnpj: '99.999.999/9999-99', cep: '99999-999',
    cpf_cnpj: digits.length > 11 ? '99.999.999/9999-99' : '999.999.999-99',
    telefone: digits.length > 10 ? '(99) 99999-9999' : '(99) 9999-9999',
  } as Record<string, string>)[mask]
  if (mask === 'placa') {
    const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
    return s.length > 3 && /^\d+$/.test(s.slice(3)) ? `${s.slice(0, 3)}-${s.slice(3)}` : s
  }
  const m = pattern ?? mask
  let out = ''
  let i = 0
  const src = pattern ? digits : raw
  for (const c of m) {
    if (i >= src.length) break
    if (c === '9' || c === 'A' || c === '*') {
      // pula caracteres que não servem para a posição
      while (i < src.length && !(c === '9' ? /\d/ : c === 'A' ? /[A-Za-z]/ : /./).test(src[i]!)) i++
      if (i < src.length) out += c === 'A' ? src[i]!.toUpperCase() : src[i]!
      i++
    } else {
      out += c
      if (src[i] === c) i++
    }
  }
  return out
}

