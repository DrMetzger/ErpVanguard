import { Button, Card, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { SalesOrderRow } from './types'

const FILTERS = [
  { value: 'todos', label: 'Todos' }, { value: 'orcamento', label: 'Orçamentos' }, { value: 'aprovado', label: 'A faturar' },
  { value: 'faturado', label: 'Faturados' }, { value: 'cancelado', label: 'Cancelados' },
]

export default function SalesOrders() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('todos')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, loading } = useApi<SalesOrderRow[]>(`/sales-orders?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`)

  return (
    <>
      <Group justify="space-between" mb="md" gap="sm">
        <Group gap="sm">
          <SegmentedControl data={FILTERS} value={status} onChange={setStatus} size="sm" />
          <TextInput placeholder="Cliente, CNPJ ou número" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={260} aria-label="Buscar pedidos" />
        </Group>
        <Button leftSection={<IconPlus size={18} />} onClick={() => navigate('/faturamento/pedidos/novo')}>Novo orçamento</Button>
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={860}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr><Table.Th>Pedido</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Vendedor</Table.Th><Table.Th>Condição</Table.Th><Table.Th>Data</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((o) => (
                  <Table.Tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/faturamento/pedidos/${o.id}`)}>
                    <Table.Td fw={700}>{o.code}</Table.Td>
                    <Table.Td>{o.customerName}{o.customerUf && <Text span c="dimmed" size="xs"> · {o.customerUf}</Text>}</Table.Td>
                    <Table.Td>{o.sellerName}</Table.Td>
                    <Table.Td>{o.paymentTerm}</Table.Td>
                    <Table.Td>{date(o.createdAt)}</Table.Td>
                    <Table.Td ta="right" fw={600}>{money(o.total)}</Table.Td>
                    <Table.Td><Group gap={6} wrap="nowrap"><Status value={o.status} />{o.invoiceNumber && <Text size="xs" c="dimmed">NF {o.invoiceNumber}</Text>}</Group></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>{q || status !== 'todos' ? 'Nada encontrado.' : 'Nenhum orçamento ainda. Clique em "Novo orçamento".'}</Empty>}
      </Card>
    </>
  )
}
