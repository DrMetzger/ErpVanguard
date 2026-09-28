import { isValidDocument } from '../purchasing/documents'

// Máscaras de digitação dos campos personalizados. 9 = dígito, A = letra, * = qualquer caractere.
export const MASK_PRESETS: Record<string, { label: string; mask: string }> = {
  cpf: { label: 'CPF', mask: '999.999.999-99' },
  cnpj: { label: 'CNPJ', mask: '99.999.999/9999-99' },
  cpf_cnpj: { label: 'CPF ou CNPJ', mask: '' },
  cep: { label: 'CEP', mask: '99999-999' },
  telefone: { label: 'Telefone', mask: '' },
  placa: { label: 'Placa (Mercosul ou antiga)', mask: '' },
}

const toRegex = (mask: string) => new RegExp(`^${mask.split('').map((c) => (c === '9' ? '\\d' : c === 'A' ? '[A-Za-z]' : c === '*' ? '.' : c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'))).join('')}$`)

// Máscara personalizada: só 9, A, * e separadores comuns.
export const validCustomMask = (mask: string) => /^[9A*.\-/() :]{1,40}$/.test(mask) && /[9A*]/.test(mask)

// Confere o valor digitado contra a máscara (preset ou personalizada). Devolve a mensagem de erro ou null.
export function checkMask(mask: string, value: string): string | null {
  const digits = value.replace(/\D/g, '')
  switch (mask) {
    case 'cpf': return digits.length === 11 && isValidDocument(digits) && toRegex(MASK_PRESETS.cpf!.mask).test(value) ? null : 'CPF inválido'
    case 'cnpj': return digits.length === 14 && isValidDocument(digits) && toRegex(MASK_PRESETS.cnpj!.mask).test(value) ? null : 'CNPJ inválido'
    case 'cpf_cnpj': return (toRegex(MASK_PRESETS.cpf!.mask).test(value) || toRegex(MASK_PRESETS.cnpj!.mask).test(value)) && isValidDocument(digits) ? null : 'CPF/CNPJ inválido'
    case 'cep': return toRegex(MASK_PRESETS.cep!.mask).test(value) ? null : 'CEP no formato 99999-999'
    case 'telefone': return /^\(\d{2}\) \d{4,5}-\d{4}$/.test(value) ? null : 'Telefone no formato (99) 99999-9999'
    case 'placa': return /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(value.toUpperCase()) ? null : 'Placa no formato AAA-9999 ou AAA9A99'
    default: return toRegex(mask).test(value) ? null : `Use o formato ${mask}`
  }
}
