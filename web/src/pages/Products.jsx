import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Icon from '../components/Icon.jsx'
import { parseNumber } from '../ui.jsx'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })

const empty = { sku: '', name: '', barcode: '', ncm: '', unit: 'UN', costPrice: '', salePrice: '', stock: '', minStock: '' }
const numberFields = { costPrice: 'Preço de custo', salePrice: 'Preço de venda', stock: 'Estoque atual', minStock: 'Estoque mínimo' }


export default function Products() {
  const [items, setItems] = useState(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async (q) => {
    try {
      setItems(await api(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(query), 250)
    return () => clearTimeout(timer)
  }, [query, load])

  const remove = async (product) => {
    if (!confirm(`Excluir o produto "${product.name}"?`)) return
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' })
      load(query)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estoque</h1>
          <p className="muted">Cadastro de produtos e saldos.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(empty)}>
          <Icon name="plus" size={18} /> Novo produto
        </button>
      </div>

      <div className="search">
        <Icon name="search" size={18} />
        <input placeholder="Buscar por nome ou código" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Un.</th>
              <th className="num">Custo</th>
              <th className="num">Venda</th>
              <th className="num">Estoque</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'inactive'}>
                <td data-label="Código">{p.sku}</td>
                <td data-label="Produto">{p.name}</td>
                <td data-label="Un.">{p.unit}</td>
                <td data-label="Custo" className="num">{money.format(p.costPrice)}</td>
                <td data-label="Venda" className="num">{money.format(p.salePrice)}</td>
                <td data-label="Estoque" className="num">
                  <span className={p.stock <= p.minStock ? 'badge badge-warn' : ''}>{qty.format(p.stock)}</span>
                </td>
                <td className="actions">
                  <button className="icon-btn" onClick={() => setEditing(p)} aria-label="Editar"><Icon name="edit" size={16} /></button>
                  <button className="icon-btn danger" onClick={() => remove(p)} aria-label="Excluir"><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && (
          <p className="empty">{query ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda. Clique em "Novo produto".'}</p>
        )}
      </div>

      {editing && (
        <ProductForm
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load(query)
          }}
        />
      )}
    </>
  )
}

function ProductForm({ product, onClose, onSaved }) {
  const isNew = !product.id
  const [form, setForm] = useState(() => {
    const initial = { ...empty }
    for (const key of Object.keys(empty)) initial[key] = product[key] ?? ''
    for (const key in numberFields) if (!isNew) initial[key] = String(product[key]).replace('.', ',')
    return initial
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const body = {}
    for (const [key, value] of Object.entries(form)) {
      if (key in numberFields) {
        const n = parseNumber(value)
        if (Number.isNaN(n)) return setError(`Valor inválido em "${numberFields[key]}"`)
        body[key] = n ?? 0
      } else if (value.trim()) {
        body[key] = value.trim()
      } else if (!isNew) {
        body[key] = null // limpa o campo opcional na edição
      }
    }
    setBusy(true)
    setError('')
    try {
      await api(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PATCH', body })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'Novo produto' : 'Editar produto'}</h2>
        <div className="form-grid">
          <label>Código (SKU)<input name="sku" required value={form.sku} onChange={set} autoFocus /></label>
          <label className="span-2">Descrição<input name="name" required value={form.name} onChange={set} /></label>
          <label>Código de barras<input name="barcode" value={form.barcode} onChange={set} inputMode="numeric" /></label>
          <label>NCM<input name="ncm" value={form.ncm} onChange={set} inputMode="numeric" maxLength={8} placeholder="8 dígitos" /></label>
          <label>Unidade<input name="unit" required value={form.unit} onChange={set} maxLength={6} /></label>
          <label>Preço de custo<input name="costPrice" value={form.costPrice} onChange={set} inputMode="decimal" placeholder="0,00" /></label>
          <label>Preço de venda<input name="salePrice" value={form.salePrice} onChange={set} inputMode="decimal" placeholder="0,00" /></label>
          <label>Estoque atual<input name="stock" value={form.stock} onChange={set} inputMode="decimal" placeholder="0" /></label>
          <label>Estoque mínimo<input name="minStock" value={form.minStock} onChange={set} inputMode="decimal" placeholder="0" /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </div>
  )
}
