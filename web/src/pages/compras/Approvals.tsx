import { Text } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../../lib/hooks'
import type { Order } from '../../lib/types'
import { OrderTable } from './Orders'

export default function Approvals() {
  const { data, loading } = useApi<Order[]>('/purchase-orders/pending-approval')
  const navigate = useNavigate()
  return (
    <>
      <Text c="dimmed" mb="md">Pedidos que estão no seu nível de aprovação.</Text>
      <OrderTable orders={data} loading={loading} onOpen={(o) => navigate(`/compras/pedidos/${o.id}`)} empty="Nada aguardando sua aprovação. 👍" />
    </>
  )
}
