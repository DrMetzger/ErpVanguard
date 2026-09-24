import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api.js'
import Icon from '../../components/Icon.jsx'
import { cnpj, date, Modal, money, price, ProductPicker, qty, Status, useAction, useApi } from '../../ui.jsx'

const SOURCE = {
  amarracao: ['Já conhecido', 'ok', 'Código do fornecedor usado em nota anterior'],
  ean: ['Código de barras', 'ok', 'EAN da nota igual ao do produto'],
  pedido: ['Pelo pedido', 'info', 'Descrição parecida com o item do pedido'],
  ia: ['IA', 'ai', 'Sugerido pelo Gemini'],
  manual: ['Manual', 'muted', 'Escolhido por você'],
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: nf, error, setData } = useApi(`/invoices/${id}`)
  const [creating, setCreating] = useState(null)
  const action = useAction()

  if (error) return <p className="error">{error}</p>
  if (!nf) return <p className="muted">Carregando…</p>

  const pending = nf.status === 'pendente'
  const unmatched = nf.items.filter((i) => !i.productId).length
  const update = (body) => action.run(async () => setData(await api(`/invoices/${id}`, { method: 'PUT', body: { items: [], ...body } })))
  const setItem = (itemId, patch) => update({ items: [{ id: itemId, ...patch }] })
  const ai = () => action.run(async () => setData(await api(`/invoices/${id}/ai-match`, { method: 'POST' })))
  const post = () => confirm('Lançar a nota? O estoque e o custo médio dos produtos serão atualizados.') && action.run(async () => setData(await api(`/invoices/${id}/post`, { method: 'POST' })))
  const remove = () => confirm('Excluir esta nota importada?') && action.run(async () => { await api(`/invoices/${id}`, { method: 'DELETE' }); navigate('..', { relative: 'path' }) })

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." relative="path" className="back">← Notas</Link>
          <h2 className="title">NF {nf.number}{nf.series && `/${nf.series}`} <Status value={nf.status} /></h2>
          <p className="muted small mono">{nf.accessKey}</p>
        </div>
        {pending && <button className="btn btn-ghost danger-text" onClick={remove} disabled={action.busy}>Excluir</button>}
      </div>

      <div className="facts card pad">
        <div><small>Fornecedor</small>{nf.supplierName}<small className="muted">{cnpj(nf.supplierCnpj)}</small></div>
        <div><small>Emissão</small>{date(nf.issueDate)}</div>
        <div><small>Total da nota</small><strong className="big">{money(nf.total)}</strong></div>
        <div>
          <small>Pedido de compra</small>
          {pending ? (
            <select value={nf.purchaseOrderId ?? ''} onChange={(e) => update({ purchaseOrderId: e.target.value || null })} disabled={action.busy}>
              <option value="">Sem pedido</option>
              {nf.orders.map((o) => <option key={o.id} value={o.id}>{o.code} · {money(o.total)}</option>)}
            </select>
          ) : nf.orderCode ?? '—'}
        </div>
      </div>

      {nf.warnings.length > 0 && pending && (
        <div className="card pad warn-box"><ul className="plain">{nf.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul></div>
      )}

      <div className="card table-wrap">
        <table className="invoice-table">
          <thead><tr><th>#</th><th>Item na nota</th><th className="num">Qtd.</th><th className="num">Unit.</th><th>Produto no sistema</th>{nf.purchaseOrderId && <th>Item do pedido</th>}</tr></thead>
          <tbody>
            {nf.items.map((i) => {
              const src = SOURCE[i.matchSource]
              return (
                <tr key={i.id} className={i.productId ? '' : 'needs'}>
                  <td data-label="#">{i.itemNumber}</td>
                  <td data-label="Item na nota">{i.description}<small className="muted block">cód. {i.supplierCode}{i.ean && ` · EAN ${i.ean}`}{i.ncm && ` · NCM ${i.ncm}`}</small></td>
                  <td data-label="Qtd." className="num">{qty(i.quantity)} {i.unit}</td>
                  <td data-label="Unit." className="num">{price(i.unitPrice)}</td>
                  <td data-label="Produto" className="wide">
                    {pending ? (
                      <div className="stack-sm">
                        <ProductPicker value={i.productId ? { id: i.productId, sku: i.productSku, name: i.productName } : null} onChange={(p) => setItem(i.id, { productId: p?.id ?? null })} placeholder="Escolher produto…" />
                        {!i.productId && <button type="button" className="link-btn" onClick={() => setCreating(i)}>+ cadastrar produto a partir da nota</button>}
                      </div>
                    ) : <span>{i.productSku} · {i.productName}</span>}
                    {src && <small className="block"><span className={`badge badge-${src[1]}`} title={src[2]}>{src[0]}</span> {i.matchNote && <span className="muted">{i.matchNote}</span>}</small>}
                  </td>
                  {nf.purchaseOrderId && (
                    <td data-label="Item do pedido">
                      {pending ? (
                        <select value={i.orderItemId ?? ''} onChange={(e) => setItem(i.id, { orderItemId: e.target.value || null })}>
                          <option value="">—</option>
                          {nf.orderItems.map((oi) => <option key={oi.id} value={oi.id}>{oi.description} (saldo {qty(oi.quantity - oi.receivedQuantity)})</option>)}
                        </select>
                      ) : nf.orderItems.find((oi) => oi.id === i.orderItemId)?.description ?? '—'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {action.error && <p className="error">{action.error}</p>}
      {pending && (
        <div className="row-gap">
          {unmatched > 0 && (
            nf.aiEnabled
              ? <button className="btn btn-ai" onClick={ai} disabled={action.busy}><Icon name="chart" size={16} /> {action.busy ? 'Consultando IA…' : `Amarrar ${unmatched} item(ns) com IA`}</button>
              : <span className="muted small">IA desativada: configure a chave do Gemini para sugestões automáticas.</span>
          )}
          <button className="btn btn-primary push" onClick={post} disabled={action.busy || unmatched > 0}>
            {unmatched ? `Faltam ${unmatched} produto(s)` : 'Lançar nota (entrada no estoque)'}
          </button>
        </div>
      )}
      {!pending && <p className="success">Nota lançada em {date(nf.postedAt)}. Estoque e custo médio atualizados.</p>}

      {creating && <NewProductFromItem item={creating} onClose={() => setCreating(null)} onCreated={(p) => { setCreating(null); setItem(creating.id, { productId: p.id }) }} />}
    </>
  )
}

function NewProductFromItem({ item, onClose, onCreated }) {
  const [form, setForm] = useState({ sku: item.supplierCode.slice(0, 40), name: item.description.slice(0, 200), unit: item.unit.slice(0, 6), ncm: item.ncm ?? '', barcode: item.ean ?? '' })
  const { busy, error, run } = useAction()
  const set = (e) => setForm({ ...form, [e.target.name]: e.target.value })
  const submit = (e) => {
    e.preventDefault()
    const body = { ...form }
    if (!/^\d{8}$/.test(body.ncm)) delete body.ncm
    if (!body.barcode) delete body.barcode
    run(async () => onCreated(await api('/products', { method: 'POST', body })))
  }
  return (
    <Modal title="Cadastrar produto" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Dados trazidos da nota. O estoque e o custo entram quando a nota for lançada.</p>
        <div className="form-grid">
          <label>Código (SKU)<input name="sku" required value={form.sku} onChange={set} autoFocus /></label>
          <label className="span-2">Descrição<input name="name" required value={form.name} onChange={set} /></label>
          <label>Unidade<input name="unit" required value={form.unit} onChange={set} maxLength={6} /></label>
          <label>NCM<input name="ncm" value={form.ncm} onChange={set} maxLength={8} /></label>
          <label>Código de barras<input name="barcode" value={form.barcode} onChange={set} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Cadastrar e usar'}</button>
        </div>
      </form>
    </Modal>
  )
}
