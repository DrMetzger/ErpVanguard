import { useState } from 'react'
import { api } from '../../api.js'
import { useAuth } from '../../auth.jsx'
import Icon from '../../components/Icon.jsx'
import { can, date, Modal, parseNumber, ProductPicker, qty, Status, useAction, useApi } from '../../ui.jsx'

export default function Requests() {
  const { user } = useAuth()
  const [status, setStatus] = useState('')
  const { data, error, reload } = useApi(`/purchase-requests${status ? `?status=${status}` : ''}`)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState(null)

  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="filter">
          <option value="">Todas</option><option value="aberta">Abertas</option><option value="em_cotacao">Em cotação</option>
          <option value="atendida">Atendidas</option><option value="cancelada">Canceladas</option>
        </select>
        {can(user, 'solicitante') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Nova solicitação</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Número</th><th>Solicitante</th><th>Grupo</th><th>Itens</th><th>Necessidade</th><th>Situação</th></tr></thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setViewing(r)}>
                <td data-label="Número"><strong>{r.code}</strong></td>
                <td data-label="Solicitante">{r.requesterName}</td>
                <td data-label="Grupo">{r.purchaseGroupName}</td>
                <td data-label="Itens">{r.items.length}</td>
                <td data-label="Necessidade">{date(r.neededBy)}</td>
                <td data-label="Situação"><Status value={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="empty">Nenhuma solicitação.</p>}
      </div>
      {creating && <RequestForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {viewing && <RequestView request={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reload() }} />}
    </>
  )
}

function RequestView({ request, onClose, onChanged }) {
  const { user } = useAuth()
  const { busy, error, run } = useAction()
  const cancel = () => {
    if (confirm(`Cancelar a solicitação ${request.code}?`)) run(async () => { await api(`/purchase-requests/${request.id}/cancel`, { method: 'POST' }); onChanged() })
  }
  return (
    <Modal title={`Solicitação ${request.code}`} onClose={onClose} wide>
      <div className="facts">
        <div><small>Solicitante</small>{request.requesterName}</div>
        <div><small>Grupo de compras</small>{request.purchaseGroupName}</div>
        <div><small>Aberta em</small>{date(request.createdAt)}</div>
        <div><small>Necessidade</small>{date(request.neededBy)}</div>
        <div><small>Situação</small><Status value={request.status} /></div>
      </div>
      {request.notes && <p className="note">{request.notes}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th className="num">Quantidade</th><th>Situação</th></tr></thead>
          <tbody>
            {request.items.map((i) => (
              <tr key={i.id}>
                <td data-label="Item">{i.sku && <strong>{i.sku} · </strong>}{i.description}</td>
                <td data-label="Quantidade" className="num">{qty(i.quantity)} {i.unit}</td>
                <td data-label="Situação"><Status value={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        {request.status === 'aberta' && (request.requesterId === user.id || user.role === 'admin') && (
          <button className="btn btn-ghost danger-text" onClick={cancel} disabled={busy}>Cancelar solicitação</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  )
}

const emptyItem = () => ({ product: null, description: '', unit: 'UN', quantity: '' })

function RequestForm({ onClose, onSaved }) {
  const groups = useApi('/purchase-groups')
  const [groupId, setGroupId] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const { busy, error, setError, run } = useAction()
  const update = (i, patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const active = groups.data?.filter((g) => g.active) ?? []

  const submit = (e) => {
    e.preventDefault()
    const body = {
      purchaseGroupId: groupId || active[0]?.id,
      neededBy: neededBy || undefined,
      notes: notes || undefined,
      items: items.map((it) => ({
        productId: it.product?.id, description: it.product ? undefined : it.description.trim() || undefined,
        unit: it.product ? undefined : it.unit || 'UN', quantity: parseNumber(it.quantity),
      })),
    }
    if (!body.purchaseGroupId) return setError('Nenhum grupo de compras cadastrado. Peça ao administrador.')
    if (body.items.some((it) => !it.quantity || Number.isNaN(it.quantity))) return setError('Informe a quantidade de todos os itens')
    if (body.items.some((it) => !it.productId && !it.description)) return setError('Escolha um produto ou descreva cada item')
    run(async () => { await api('/purchase-requests', { method: 'POST', body }); onSaved() })
  }

  return (
    <Modal title="Nova solicitação de compra" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="span-2">Grupo de compras
            <select value={groupId || active[0]?.id || ''} onChange={(e) => setGroupId(e.target.value)} required>
              {active.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label>Preciso até<input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>
        </div>
        <div className="items-editor">
          {items.map((it, i) => (
            <div key={i} className="item-row">
              <div className="grow">
                <ProductPicker value={it.product} onChange={(product) => update(i, { product })} placeholder="Produto do cadastro…" />
                {!it.product && <input className="mt" placeholder="…ou descreva o item (sem cadastro)" value={it.description} onChange={(e) => update(i, { description: e.target.value })} />}
              </div>
              {!it.product && <input className="unit" placeholder="Un." value={it.unit} onChange={(e) => update(i, { unit: e.target.value })} maxLength={6} />}
              <input className="qty" placeholder="Qtd." inputMode="decimal" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
              <button type="button" className="icon-btn danger" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remover item"><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => setItems([...items, emptyItem()])}><Icon name="plus" size={16} /> Adicionar item</button>
        </div>
        <label>Observações<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Onde vai ser usado, marca preferida, urgência…" /></label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar solicitação'}</button>
        </div>
      </form>
    </Modal>
  )
}
