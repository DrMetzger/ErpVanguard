import { useNavigate } from 'react-router-dom'
import { useApi } from '../../ui.jsx'
import { OrderTable } from './Orders.jsx'

export default function Approvals() {
  const { data, error } = useApi('/purchase-orders/pending-approval')
  const navigate = useNavigate()
  return (
    <>
      <p className="muted">Pedidos que estão no seu nível de aprovação.</p>
      {error && <p className="error">{error}</p>}
      <OrderTable orders={data} onOpen={(o) => navigate(`../pedidos/${o.id}`)} />
      {data?.length === 0 && <p className="empty">Nada aguardando sua aprovação. 👍</p>}
    </>
  )
}
