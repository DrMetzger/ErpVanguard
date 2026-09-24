import { Badge, Card, Group, SegmentedControl, SimpleGrid, Table, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconAlertTriangle, IconArrowDownRight, IconBox, IconCash, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { Empty, Loading } from '../components/ui'
import { date, money, price, qty } from '../lib/format'
import { useApi } from '../lib/hooks'
import type { Product } from '../lib/types'

interface Movement { id: string; quantity: number; unitCost: number | null; kind: string; reference: string | null; createdAt: string; sku: string; productName: string; unit: string; userName: string | null }
const KIND: Record<string, string> = { entrada_nf: 'Entrada por nota' }

export default function Stock() {
  const [view, setView] = useState('saldos')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const [onlyLow, setOnlyLow] = useState(false)
  const products = useApi<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const movements = useApi<Movement[]>(view === 'movimentacoes' ? '/stock/movements' : null)

  const list = (products.data ?? []).filter((p) => p.active && (!onlyLow || p.stock <= p.minStock))
  const all = (products.data ?? []).filter((p) => p.active)
  const stats = [
    { label: 'Itens em estoque', value: all.filter((p) => p.stock > 0).length, icon: IconBox, color: 'brand' },
    { label: 'Abaixo do mínimo', value: all.filter((p) => p.stock <= p.minStock).length, icon: IconAlertTriangle, color: 'yellow' },
    { label: 'Valor do estoque (custo)', value: money(all.reduce((s, p) => s + p.stock * p.costPrice, 0)), icon: IconCash, color: 'teal' },
  ]

  return (
    <>
      <Title order={2} mb="md">Estoque</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="lg">
        {stats.map((s) => (
          <Card key={s.label} p="md">
            <Group justify="space-between"><div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{s.label}</Text><Text fw={800} fz={24}>{products.data ? s.value : '—'}</Text></div>
              <ThemeIcon variant="light" color={s.color} size={40} radius="md"><s.icon size={22} /></ThemeIcon></Group>
          </Card>
        ))}
      </SimpleGrid>
      <Group justify="space-between" mb="md">
        <SegmentedControl value={view} onChange={setView} data={[{ value: 'saldos', label: 'Saldos' }, { value: 'movimentacoes', label: 'Movimentações' }]} />
        {view === 'saldos' && (
          <Group>
            <SegmentedControl size="xs" value={onlyLow ? 'baixo' : 'todos'} onChange={(v) => setOnlyLow(v === 'baixo')} data={[{ value: 'todos', label: 'Todos' }, { value: 'baixo', label: 'Abaixo do mínimo' }]} />
            <TextInput placeholder="Buscar produto" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={260} />
          </Group>
        )}
      </Group>

      {view === 'saldos' ? (
        <Card p={0}>
          {!products.data ? <Loading /> : (
            <Table.ScrollContainer minWidth={720}>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Código</Table.Th><Table.Th>Produto</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th ta="right">Mínimo</Table.Th><Table.Th ta="right">Custo médio</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {list.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td fw={600}>{p.sku}</Table.Td>
                      <Table.Td>{p.name}</Table.Td>
                      <Table.Td ta="right">{p.stock <= p.minStock ? <Badge color="yellow" variant="light">{qty(p.stock)} {p.unit}</Badge> : `${qty(p.stock)} ${p.unit}`}</Table.Td>
                      <Table.Td ta="right">{qty(p.minStock)}</Table.Td>
                      <Table.Td ta="right">{price(p.costPrice)}</Table.Td>
                      <Table.Td ta="right">{money(p.stock * p.costPrice)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {products.data && !list.length && <Empty>Nenhum produto {onlyLow ? 'abaixo do mínimo 👍' : 'encontrado'}.</Empty>}
        </Card>
      ) : (
        <Card p={0}>
          {!movements.data ? <Loading /> : (
            <Table.ScrollContainer minWidth={760}>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Data</Table.Th><Table.Th>Produto</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Documento</Table.Th><Table.Th ta="right">Quantidade</Table.Th><Table.Th ta="right">Custo unit.</Table.Th><Table.Th>Usuário</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {movements.data.map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>{date(m.createdAt)}</Table.Td>
                      <Table.Td><Text size="sm" fw={600}>{m.sku}</Text><Text size="xs" c="dimmed">{m.productName}</Text></Table.Td>
                      <Table.Td><Group gap={4}><IconArrowDownRight size={14} color="var(--mantine-color-teal-6)" />{KIND[m.kind] ?? m.kind}</Group></Table.Td>
                      <Table.Td>{m.reference ?? '—'}</Table.Td>
                      <Table.Td ta="right" c={m.quantity < 0 ? 'red' : 'teal'}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)} {m.unit}</Table.Td>
                      <Table.Td ta="right">{price(m.unitCost)}</Table.Td>
                      <Table.Td>{m.userName ?? '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {movements.data?.length === 0 && <Empty>Nenhuma movimentação ainda. Elas aparecem ao lançar notas de entrada.</Empty>}
        </Card>
      )}
    </>
  )
}
