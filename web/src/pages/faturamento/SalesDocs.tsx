import { Button, Card, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { SalesDocRow } from './types'

export type DocKind = 'quote' | 'order'
export const KIND = {
  quote: { api: '/sales-quotes', path: '/faturamento/orcamentos', title: 'orçamento', filters: [{ value: 'todos', label: 'Todos' }, { value: 'aberto', label: 'Em aberto' }, { value: 'ganho', label: 'Ganhos' }, { value: 'perdido', label: 'Perdidos' }], link: 'PV' },
  order: { api: '/sales-orders', path: '/faturamento/pedidos', title: 'pedido', filters: [{ value: 'todos', label: 'Todos' }, { value: 'aberto', label: 'A faturar' }, { value: 'faturado', label: 'Faturados' }, { value: 'cancelado', label: 'Cancelados' }], link: 'NF' },
} as const

// Lista de orçamentos ou de pedidos de venda.
export default function SalesDocs({ kind }: { kind: DocKind }) {
  const k = KIND[kind]
  const navigate = useNavigate()
  const [status, setStatus] = useState('todos')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, loading } = useApi<SalesDocRow[]>(`${k.api}?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

  return (
    <>
      <Group justify="space-between" mb="md" gap="sm">
        <Group gap="sm">
          <SegmentedControl data={[...k.filters]} value={status} onChange={setStatus} size="sm" />
          <TextInput placeholder="Cliente, CNPJ ou número" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={260} aria-label={`Buscar ${k.title}s`} />
        </Group>
        <Button leftSection={<IconPlus size={18} />} onClick={() => navigate(`${k.path}/novo`)}>{kind === 'quote' ? 'Novo orçamento' : 'Novo pedido'}</Button>
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={900}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr><Table.Th>Número</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Vendedor</Table.Th><Table.Th>Condição</Table.Th><Table.Th>{kind === 'quote' ? 'Validade' : 'Data'}</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((o) => (
                  <Table.Tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`${k.path}/${o.id}`)}>
                    <Table.Td fw={700}>{o.code}</Table.Td>
                    <Table.Td>{o.customerName}{o.customerUf && <Text span c="dimmed" size="xs"> · {o.customerUf}</Text>}</Table.Td>
                    <Table.Td>{o.sellerName}</Table.Td>
                    <Table.Td>{o.paymentTerm}</Table.Td>
                    <Table.Td>{kind === 'quote' ? <Text size="sm" c={o.status === 'aberto' && o.validUntil && o.validUntil < today ? 'red' : undefined}>{date(o.validUntil)}</Text> : date(o.createdAt)}</Table.Td>
                    <Table.Td ta="right" fw={600}>{money(o.total)}</Table.Td>
                    <Table.Td><Group gap={6} wrap="nowrap"><Status value={o.status === 'aberto' ? (kind === 'quote' ? 'em_negociacao' : 'a_faturar') : o.status} />{o.linkNumber && <Text size="xs" c="dimmed">{k.link} {o.linkNumber}</Text>}</Group></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>{q || status !== 'todos' ? 'Nada encontrado.' : kind === 'quote' ? 'Nenhum orçamento ainda. Clique em "Novo orçamento".' : 'Nenhum pedido. Eles nascem de um orçamento ganho ou direto em "Novo pedido".'}</Empty>}
      </Card>
    </>
  )
}
