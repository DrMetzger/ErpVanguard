import { Badge, Card, Group, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { money } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { SalesInvoiceRow } from './types'

export const dateTime = (v: string) => new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

export default function SalesInvoices() {
  const navigate = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const params = new URLSearchParams({ ...(from && { from }), ...(to && { to }), ...(q && { q }) })
  const { data, loading } = useApi<SalesInvoiceRow[]>(`/sales-invoices?${params}`)
  const total = data?.filter((i) => i.status === 'emitida').reduce((s, i) => s + i.total, 0) ?? 0

  return (
    <>
      <Group mb="md" gap="sm" align="flex-end">
        <TextInput type="date" label="De" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={160} />
        <TextInput type="date" label="Até" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={160} />
        <TextInput label="Buscar" placeholder="Cliente ou número" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={240} />
        {data && <Text ml="auto" size="sm" c="dimmed">{data.length} nota(s) · emitidas somam <Text span fw={700} c="var(--mantine-color-text)">{money(total)}</Text></Text>}
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={820}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr><Table.Th>Nota</Table.Th><Table.Th>Emissão</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Pedido</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th><Table.Th>SEFAZ</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((i) => (
                  <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/faturamento/notas/${i.id}`)}>
                    <Table.Td fw={700}>{i.number}/{i.series}<Text span c="dimmed" size="xs"> · {i.companyCode}</Text></Table.Td>
                    <Table.Td>{dateTime(i.issuedAt)}</Table.Td>
                    <Table.Td>{i.customerName}{i.customerUf && <Text span c="dimmed" size="xs"> · {i.customerUf}</Text>}</Table.Td>
                    <Table.Td>{i.orderCode ?? '—'}</Table.Td>
                    <Table.Td ta="right" fw={600}>{money(i.total)}</Table.Td>
                    <Table.Td><Status value={i.status} /></Table.Td>
                    <Table.Td><Badge variant="outline" color="gray" radius="sm">Não transmitida</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>Nenhuma nota no período. Elas nascem ao faturar um pedido aprovado.</Empty>}
      </Card>
    </>
  )
}
