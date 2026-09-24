import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

export const money = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const price = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 }))
export const qty = (v) => (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
export const date = (v) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('pt-BR') : '—')
export const cnpj = (v) =>
  !v ? '' : v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

// Formato brasileiro: "1.234,56", "1.200" (mil e duzentos) ou "0,35". Também aceita "1234.56".
export function parseNumber(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '')
  if (!text) return undefined
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'))
  if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''))
  return Number(text)
}
export const toInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','))

export const can = (user, permission) => user?.role === 'admin' || user?.permissions?.includes(permission)

const STATUS = {
  aberta: ['Aberta', 'info'], em_cotacao: ['Em cotação', 'warn'], atendida: ['Atendida', 'ok'], cancelada: ['Cancelada', 'muted'],
  pendente: ['Pendente', 'info'], cotacao: ['Em cotação', 'warn'], pedido: ['Pedido gerado', 'ok'], cancelado: ['Cancelado', 'muted'],
  finalizada: ['Finalizada', 'ok'], aguardando_aprovacao: ['Aguardando aprovação', 'warn'], aprovado: ['Aprovado', 'ok'],
  reprovado: ['Reprovado', 'danger'], recebido_parcial: ['Recebido parcial', 'info'], recebido: ['Recebido', 'ok'], lancada: ['Lançada', 'ok'],
}
export function Status({ value }) {
  const [label, tone] = STATUS[value] ?? [value, 'muted']
  return <span className={`badge badge-${tone}`}>{label}</span>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`card modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// Carrega dados da API e permite recarregar.
export function useApi(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!path) return
    try {
      setData(await api(path))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [path])
  useEffect(() => {
    load()
  }, [load])
  return { data, error, reload: load, setData }
}

// Executa uma ação e guarda erro/ocupado para o botão.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = useCallback(async (fn) => {
    setBusy(true)
    setError('')
    try {
      return await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, run }
}

// Campo de busca de produto com lista suspensa.
export function ProductPicker({ value, onChange, placeholder = 'Buscar produto…' }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(async () => {
      try {
        setResults(await api(`/products?q=${encodeURIComponent(term)}`))
      } catch {
        setResults([])
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [term, open])

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div className="picker" ref={box}>
      <input
        value={open ? term : value ? `${value.sku} · ${value.name}` : ''}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setTerm('') }}
        onChange={(e) => setTerm(e.target.value)}
      />
      {value && !open && <button type="button" className="picker-clear" onClick={() => onChange(null)} aria-label="Limpar">×</button>}
      {open && (
        <ul className="picker-list">
          {results.slice(0, 30).map((p) => (
            <li key={p.id} onMouseDown={() => { onChange(p); setOpen(false) }}>
              <strong>{p.sku}</strong> {p.name} <small className="muted">{p.unit}</small>
            </li>
          ))}
          {!results.length && <li className="muted">Nenhum produto encontrado</li>}
        </ul>
      )}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(([key, label]) => (
        <button key={key} type="button" className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  )
}
