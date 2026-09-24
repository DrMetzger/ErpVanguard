import { Card, Group, Select, Table, Text } from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { Order } from '../../lib/types'

const STATUSES = [
  { value: '', label: 'Todos' }, { value: 'aguardando_aprovacao', label: 'Aguardando aprovação' }, { value: 'aprovado', label: 'Aprovados' },
  { value: 'recebido_parcial', label: 'Recebidos parcialmente' }, { value: 'recebido', label: 'Recebidos' },
  { value: 'reprovado', label: 'Reprovados' }, { value: 'cancelado', label: 'Cancelados' },
]

export default function Orders() {
  const [status, setStatus] = useState('')
  const { data, loading } = useApi<Order[]>(`/purchase-orders${status ? `?status=${status}` : ''}`)
  const navigate = useNavigate()
  return (
    <>
      <Group mb="md"><Select data={STATUSES} value={status} onChange={(v) => setStatus(v ?? '')} allowDeselect={false} w={260} aria-label="Filtrar por situação" /></Group>
      <OrderTable orders={data} loading={loading} onOpen={(o) => navigate(o.id)} empty="Nenhum pedido. Eles são gerados ao finalizar uma cotação." />
    </>
  )
}

export function OrderTable({ orders, loading, onOpen, empty }: { orders: Order[] | null; loading: boolean; onOpen: (o: Order) => void; empty: string }) {
  return (
    <Card p={0}>
      {loading && !orders ? <Loading /> : (
        <Table.ScrollContainer minWidth={760}>
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Pedido</Table.Th><Table.Th>Fornecedor</Table.Th><Table.Th>Comprador</Table.Th><Table.Th>Emissão</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {orders?.map((o) => (
                <Table.Tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o)}>
                  <Table.Td fw={700}>{o.code}</Table.Td>
                  <Table.Td>{o.supplierName}</Table.Td>
                  <Table.Td>{o.buyerName}</Table.Td>
                  <Table.Td>{date(o.createdAt)}</Table.Td>
                  <Table.Td ta="right" fw={600}>{money(o.total)}</Table.Td>
                  <Table.Td><Group gap={6} wrap="nowrap"><Status value={o.status} />{o.pendingLevel && <Text size="xs" c="dimmed">nível {o.pendingLevel}</Text>}</Group></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {orders?.length === 0 && <Empty>{empty}</Empty>}
    </Card>
  )
}
