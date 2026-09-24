import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api.js'
import Icon from '../../components/Icon.jsx'
import { date, Modal, qty, Status, useAction, useApi } from '../../ui.jsx'

export default function Quotations() {
  const { data, error } = useApi('/quotations')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      <div className="toolbar">
        <span />
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Nova cotação</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Número</th><th>Grupo</th><th>Comprador</th><th className="num">Itens</th><th className="num">Fornecedores</th><th>Prazo</th><th>Situação</th></tr></thead>
          <tbody>
            {data?.map((q) => (
              <tr key={q.id} className="clickable" onClick={() => navigate(q.id)}>
                <td data-label="Número"><strong>{q.code}</strong></td>
                <td data-label="Grupo">{q.purchaseGroupName}</td>
                <td data-label="Comprador">{q.buyerName}</td>
                <td data-label="Itens" className="num">{q.itemCount}</td>
                <td data-label="Fornecedores" className="num">{q.supplierCount}</td>
                <td data-label="Prazo">{date(q.deadline)}</td>
                <td data-label="Situação"><Status value={q.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="empty">Nenhuma cotação. Clique em "Nova cotação" para cotar os itens das solicitações.</p>}
      </div>
      {creating && <QuotationForm onClose={() => setCreating(false)} onCreated={(q) => navigate(q.id)} />}
    </>
  )
}

function QuotationForm({ onClose, onCreated }) {
  const pending = useApi('/purchase-requests/pending-items')
  const suppliers = useApi('/suppliers')
  const [itemIds, setItemIds] = useState([])
  const [supplierIds, setSupplierIds] = useState([])
  const [deadline, setDeadline] = useState('')
  const { busy, error, setError, run } = useAction()

  const selected = pending.data?.filter((i) => itemIds.includes(i.id)) ?? []
  const groupId = selected[0]?.purchaseGroupId
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = (e) => {
    e.preventDefault()
    if (!itemIds.length) return setError('Selecione os itens a cotar')
    if (!supplierIds.length) return setError('Selecione pelo menos um fornecedor')
    run(async () => onCreated(await api('/quotations', { method: 'POST', body: { requestItemIds: itemIds, supplierIds, deadline: deadline || undefined } })))
  }

  return (
    <Modal title="Nova cotação" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <h3>1. Itens das solicitações</h3>
        <div className="table-wrap pick-table">
          <table>
            <thead><tr><th /><th>Item</th><th className="num">Qtd.</th><th>Solicitação</th><th>Grupo</th></tr></thead>
            <tbody>
              {pending.data?.map((i) => {
                const blocked = groupId && i.purchaseGroupId !== groupId
                return (
                  <tr key={i.id} className={blocked ? 'inactive' : 'clickable'} onClick={() => !blocked && toggle(itemIds, setItemIds, i.id)}>
                    <td><input type="checkbox" readOnly checked={itemIds.includes(i.id)} disabled={blocked} /></td>
                    <td data-label="Item">{i.sku && <strong>{i.sku} · </strong>}{i.description}</td>
                    <td data-label="Qtd." className="num">{qty(i.quantity)} {i.unit}</td>
                    <td data-label="Solicitação">{i.requestCode} · {i.requesterName}</td>
                    <td data-label="Grupo">{i.purchaseGroupName}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {pending.data?.length === 0 && <p className="empty">Nenhum item pendente de cotação.</p>}
        </div>
        <h3>2. Fornecedores que vão cotar</h3>
        <div className="checks-grid">
          {suppliers.data?.filter((s) => s.active).map((s) => (
            <label key={s.id} className="check"><input type="checkbox" checked={supplierIds.includes(s.id)} onChange={() => toggle(supplierIds, setSupplierIds, s.id)} />{s.name}</label>
          ))}
          {suppliers.data?.length === 0 && <p className="muted small">Cadastre fornecedores na aba Fornecedores.</p>}
        </div>
        <label className="narrow">Prazo para resposta<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Criando…' : `Criar cotação (${itemIds.length} itens × ${supplierIds.length} fornecedores)`}</button>
        </div>
      </form>
    </Modal>
  )
}
