import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api.js'
import { useAuth } from '../../auth.jsx'
import { cnpj, date, money, price, qty, Status, useAction, useApi } from '../../ui.jsx'

export default function OrderDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const { data: o, error, setData } = useApi(`/purchase-orders/${id}`)
  const [comment, setComment] = useState('')
  const action = useAction()

  if (error) return <p className="error">{error}</p>
  if (!o) return <p className="muted">Carregando…</p>

  const decide = (kind) => action.run(async () => { setData(await api(`/purchase-orders/${id}/${kind}`, { method: 'POST', body: { comment: comment || undefined } })); setComment('') })
  const cancel = () => confirm(`Cancelar o pedido ${o.code}? Os itens voltam para cotação.`) && action.run(async () => setData(await api(`/purchase-orders/${id}/cancel`, { method: 'POST', body: {} })))
  const canCancel = ['aguardando_aprovacao', 'aprovado', 'reprovado'].includes(o.status) && (o.buyerId === user.id || user.role === 'admin')
  const itemsTotal = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." relative="path" className="back">← Pedidos</Link>
          <h2 className="title">{o.code} <Status value={o.status} /></h2>
          <p className="muted small">Emitido em {date(o.createdAt)} por {o.buyerName}{o.quotationCode && ` · origem ${o.quotationCode}`}</p>
        </div>
        <div className="row-gap">
          <button className="btn btn-ghost" onClick={() => window.print()}>Imprimir</button>
          {canCancel && <button className="btn btn-ghost danger-text" onClick={cancel} disabled={action.busy}>Cancelar pedido</button>}
        </div>
      </div>

      <div className="facts card pad">
        <div><small>Fornecedor</small>{o.supplierName}<small className="muted">{cnpj(o.supplierCnpj)}</small></div>
        <div><small>Grupo de compras</small>{o.purchaseGroupName}</div>
        <div><small>Condição de pagamento</small>{o.paymentTerms || '—'}</div>
        <div><small>Prazo de entrega</small>{o.deliveryDays !== null ? `${o.deliveryDays} dias` : '—'}</div>
        <div><small>Total</small><strong className="big">{money(o.total)}</strong></div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Item</th><th className="num">Qtd.</th><th className="num">Preço unit.</th><th className="num">Total</th><th className="num">Recebido</th></tr></thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id}>
                <td data-label="Item">{i.sku && <strong>{i.sku} · </strong>}{i.description}{i.requestCode && <small className="muted block">{i.requestCode}</small>}</td>
                <td data-label="Qtd." className="num">{qty(i.quantity)} {i.unit}</td>
                <td data-label="Preço unit." className="num">{price(i.unitPrice)}</td>
                <td data-label="Total" className="num">{money(i.quantity * i.unitPrice)}</td>
                <td data-label="Recebido" className="num">{qty(i.receivedQuantity)}</td>
              </tr>
            ))}
            <tr className="sub"><td colSpan={3}>Itens</td><td className="num">{money(itemsTotal)}</td><td /></tr>
            <tr className="sub"><td colSpan={3}>Frete</td><td className="num">{money(o.freight)}</td><td /></tr>
          </tbody>
        </table>
      </div>

      <section className="section">
        <h3>Aprovação</h3>
        {!o.requiredLevels.length && <p className="muted">Grupo sem alçada: pedido aprovado automaticamente.</p>}
        <ol className="levels">
          {o.levels.map((l) => {
            const decision = [...o.approvals].reverse().find((a) => a.level === l.level)
            return (
              <li key={l.level} className={o.pendingLevel === l.level ? 'current' : ''}>
                <span className="level-num">{l.level}</span>
                <div>
                  <strong>{l.limitAmount === null ? 'Sem limite' : `Até ${money(l.limitAmount)}`}</strong> · <span className="muted">{l.approvers.join(', ')}</span>
                  {decision && <small className="block">{decision.decision === 'aprovado' ? '✔ Aprovado' : '✖ Reprovado'} por {decision.userName} em {date(decision.createdAt)}{decision.comment && ` — "${decision.comment}"`}</small>}
                  {!decision && o.pendingLevel === l.level && <small className="block warn-text">Aguardando este nível</small>}
                </div>
              </li>
            )
          })}
        </ol>
        {o.canApprove && (
          <div className="card pad stack narrow">
            <label>Comentário (obrigatório para reprovar)<textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <div className="row-gap">
              <button className="btn btn-primary" onClick={() => decide('approve')} disabled={action.busy}>Aprovar nível {o.pendingLevel}</button>
              <button className="btn btn-ghost danger-text" onClick={() => decide('reject')} disabled={action.busy}>Reprovar</button>
            </div>
          </div>
        )}
        {o.status === 'aguardando_aprovacao' && !o.canApprove && o.buyerId === user.id && <p className="muted small">Você gerou este pedido, então não pode aprová-lo.</p>}
        {action.error && <p className="error">{action.error}</p>}
      </section>
    </>
  )
}
