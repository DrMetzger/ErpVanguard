import { notifications } from '@mantine/notifications'
import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { QueuedOffline } from './offline'

// Carrega dados da API e permite recarregar.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!path)
  const reload = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      setData(await api<T>(path))
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [path])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

// Executa uma ação da tela: controla "ocupado" e mostra erro/sucesso em toast.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <R,>(fn: () => Promise<R>, success?: string): Promise<R | undefined> => {
    setBusy(true)
    try {
      const result = await fn()
      if (success) notifications.show({ color: 'teal', message: success })
      return result
    } catch (err) {
      if (err instanceof QueuedOffline) notifications.show({ color: 'yellow', title: 'Guardado no aparelho', message: err.message, autoClose: 6000 })
      else notifications.show({ color: 'red', title: 'Não deu certo', message: (err as Error).message })
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
