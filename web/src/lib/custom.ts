import { useEffect, useState } from 'react'
import { api } from './api'

export type FieldType = 'text' | 'memo' | 'number' | 'integer' | 'currency' | 'date' | 'bool' | 'select' | 'radio' | 'multiselect'

export { applyMask, MASKS } from './mask'

export interface CustomField {
  id: string; key: string; label: string; type: FieldType; mask: string | null
  options: string[]; required: boolean; showInList: boolean; help: string | null; position: number; active: boolean
}
export interface FormLayout { hidden: string[]; order: string[]; labels: Record<string, string> }
export interface Customization { resource: string; title: string; standard: { key: string; label: string; required?: boolean }[]; fields: CustomField[]; layout: FormLayout }

// Campos personalizados e ajuste do formulário de um cadastro (fica em memória; limpa ao salvar a personalização).
const cache = new Map<string, Promise<Customization>>()
export const clearCustomization = () => cache.clear()
export function useCustomization(resource: string | null) {
  const [data, setData] = useState<Customization | null>(null)
  useEffect(() => {
    if (!resource) return
    if (!cache.has(resource)) cache.set(resource, api<Customization>(`/custom-fields/${resource}`).catch((e) => { cache.delete(resource); throw e }))
    cache.get(resource)!.then(setData).catch(() => setData(null))
  }, [resource])
  return data
}

// Aplica o ajuste (esconder, rótulo, ordem) a uma lista de campos padrão.
export function applyLayout<T extends { key: string; label: string }>(fields: T[], layout: FormLayout | undefined): T[] {
  if (!layout) return fields
  const visible = fields.filter((f) => !layout.hidden.includes(f.key)).map((f) => ({ ...f, label: layout.labels[f.key] || f.label }))
  const pos = (k: string) => { const i = layout.order.indexOf(k); return i < 0 ? 1000 + fields.findIndex((f) => f.key === k) : i }
  return visible.sort((a, b) => pos(a.key) - pos(b.key))
}

// Para telas com formulário próprio (produtos, fornecedores): esconder, rótulo e posição (CSS order).
export function layoutHelpers(layout: FormLayout | undefined) {
  return {
    show: (key: string) => !layout?.hidden.includes(key),
    label: (key: string, fallback: string) => layout?.labels[key] || fallback,
    order: (key: string) => { const i = layout?.order.indexOf(key) ?? -1; return i < 0 ? undefined : i - 1000 },
  }
}
