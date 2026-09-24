// Validação de CNPJ/CPF pelos dígitos verificadores.
function checkDigits(base: string, weights: number[]) {
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function isValidCnpj(cnpj: string) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false
  const d1 = checkDigits(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = checkDigits(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return cnpj.endsWith(`${d1}${d2}`)
}

export function isValidCpf(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false
  const d1 = checkDigits(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = checkDigits(cpf.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return cpf.endsWith(`${d1}${d2}`)
}

export const isValidDocument = (doc: string) => (doc.length === 14 ? isValidCnpj(doc) : isValidCpf(doc))
