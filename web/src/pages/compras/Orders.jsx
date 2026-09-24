import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { date, money, Status, useApi } from '../../ui.jsx'

export default function Orders() {
  const [status, setStatus] = useState('')
  const { data, error } = useApi(`/purchase-orders${status ? `?status=${status}` : ''}`)
  const navigate = useNavigate()
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="filter">
          <option value="">Todos</option><option value="aguardando_aprovacao">Aguardando aprovação</option><option value="aprovado">Aprovados</option>
          <option value="recebido_parcial">Recebidos parcialmente</option><option value="recebido">Recebidos</option>
          <option value="reprovado">Reprovados</option><option value="cancelado">Cancelados</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <OrderTable orders={data} onOpen={(o) => navigate(o.id)} />
      {data?.length === 0 && <p className="empty">Nenhum pedido. Eles são gerados ao finalizar uma cotação.</p>}
    </>
  )
}

export function OrderTable({ orders, onOpen }) {
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Pedido</th><th>Fornecedor</th><th>Comprador</th><th>Emissão</th><th className="num">Total</th><th>Situação</th></tr></thead>
        <tbody>
          {orders?.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => onOpen(o)}>
              <td data-label="Pedido"><strong>{o.code}</strong></td>
              <td data-label="Fornecedor">{o.supplierName}</td>
              <td data-label="Comprador">{o.buyerName}</td>
              <td data-label="Emissão">{date(o.createdAt)}</td>
              <td data-label="Total" className="num">{money(o.total)}</td>
              <td data-label="Situação"><Status value={o.status} />{o.pendingLevel && <small className="muted"> nível {o.pendingLevel}</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
