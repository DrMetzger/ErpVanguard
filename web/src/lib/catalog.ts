import { useEffect, useState } from 'react'
import { api } from './api'
import type { ResourceMeta } from './types'

// A descrição dos cadastros vem da API uma vez e fica em memória.
let cache: Promise<ResourceMeta[]> | null = null
export const loadMeta = () => (cache ??= api<ResourceMeta[]>('/catalog/meta').catch((e) => { cache = null; throw e }))

export function useResource(name: string) {
  const [meta, setMeta] = useState<ResourceMeta | null>(null)
  useEffect(() => {
    loadMeta().then((all) => setMeta(all.find((r) => r.name === name) ?? null)).catch(() => setMeta(null))
  }, [name])
  return meta
}

// Opções dos campos de seleção, por cadastro referenciado.
const optionsCache = new Map<string, Promise<{ value: string; label: string }[]>>()
export function useOptions(ref: string | undefined, refreshKey = 0) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  useEffect(() => {
    if (!ref) return
    const key = `${ref}:${refreshKey}`
    if (!optionsCache.has(key)) optionsCache.set(key, api<{ value: string; label: string }[]>(`/catalog/${ref}/options`))
    optionsCache.get(key)!.then(setOptions).catch(() => setOptions([]))
  }, [ref, refreshKey])
  return options
}
export const clearOptions = () => optionsCache.clear()
