import { useEffect, useState } from 'react'
import { api } from './api'

// Centros de custo analíticos ativos (os que recebem lançamentos).
export function useCostCenters() {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  useEffect(() => {
    api<{ value: string; label: string }[]>('/finance/cost-centers/options').then(setOptions).catch(() => setOptions([]))
  }, [])
  return options
}
