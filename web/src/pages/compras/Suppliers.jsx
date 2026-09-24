import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import Icon from '../../components/Icon.jsx'
import { cnpj, Modal, useAction, useApi } from '../../ui.jsx'

export default function Suppliers() {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const { data, error, reload } = useApi(`/suppliers${term ? `?q=${encodeURIComponent(term)}` : ''}`)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <>
      <div className="toolbar">
        <div className="search"><Icon name="search" size={18} /><input placeholder="Buscar por nome ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Novo fornecedor</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Cidade</th><th>Contato</th><th /></tr></thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'inactive'}>
                <td data-label="Fornecedor">{s.name}{s.tradeName && s.tradeName !== s.name && <small className="muted"> · {s.tradeName}</small>}</td>
                <td data-label="CNPJ/CPF">{cnpj(s.cnpj)}</td>
                <td data-label="Cidade">{[s.city, s.uf].filter(Boolean).join(' / ') || '—'}</td>
                <td data-label="Contato">{s.email || s.phone || '—'}</td>
                <td className="actions"><button className="icon-btn" onClick={() => setEditing(s)} aria-label="Editar"><Icon name="edit" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="empty">Nenhum fornecedor. Eles também são cadastrados sozinhos ao importar um XML.</p>}
      </div>
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

export function SupplierForm({ supplier, onClose, onSaved }) {
  const isNew = !supplier.id
  const [form, setForm] = useState({
    cnpj: supplier.cnpj ? cnpj(supplier.cnpj) : '', name: supplier.name ?? '', tradeName: supplier.tradeName ?? '',
    email: supplier.email ?? '', phone: supplier.phone ?? '', city: supplier.city ?? '', uf: supplier.uf ?? '', active: supplier.active ?? true,
  })
  const { busy, error, run } = useAction()
  const set = (e) => setForm({ ...form, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const body = { ...form }
      for (const k of ['tradeName', 'email', 'phone', 'city', 'uf']) if (!body[k].trim()) body[k] = isNew ? undefined : ''
      if (!body.email) delete body.email
      const saved = await api(isNew ? '/suppliers' : `/suppliers/${supplier.id}`, { method: isNew ? 'POST' : 'PATCH', body })
      onSaved(saved)
    })
  }

  return (
    <Modal title={isNew ? 'Novo fornecedor' : 'Editar fornecedor'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label>CNPJ/CPF<input name="cnpj" required value={form.cnpj} onChange={set} inputMode="numeric" autoFocus /></label>
          <label className="span-2">Razão social<input name="name" required value={form.name} onChange={set} /></label>
          <label className="span-2">Nome fantasia<input name="tradeName" value={form.tradeName} onChange={set} /></label>
          <label>Telefone<input name="phone" value={form.phone} onChange={set} /></label>
          <label className="span-2">E-mail<input name="email" type="email" value={form.email} onChange={set} /></label>
          <label>UF<input name="uf" maxLength={2} value={form.uf} onChange={set} /></label>
          <label className="span-2">Cidade<input name="city" value={form.city} onChange={set} /></label>
        </div>
        {!isNew && <label className="check"><input type="checkbox" name="active" checked={form.active} onChange={set} /> Fornecedor ativo</label>}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}
