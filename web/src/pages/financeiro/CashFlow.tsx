import { AreaChart } from '@mantine/charts'
import { Card, Group, SegmentedControl, Select, SimpleGrid, Table, Text } from '@mantine/core'
import { useState } from 'react'
import { Loading } from '../../components/ui'
import { useOptions } from '../../lib/catalog'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'

interface Flow {
  from: string; to: string; opening: number; closing: number
  days: { date: string; inRealized: number; outRealized: number; inProjected: number; outProjected: number; balance: number }[]
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const plus = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const compact = (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

// Fluxo de caixa: saldo previsto dia a dia (baixas feitas + títulos em aberto; atrasados entram hoje).
export default function CashFlow() {
  const [days, setDays] = useState('30')
  const [account, setAccount] = useState<string | null>(null)
  const accounts = useOptions('bank-accounts')
  const from = today()
  const { data, loading } = useApi<Flow>(`/finance/cash-flow?from=${from}&to=${plus(from, Number(days))}${account ? `&bankAccountId=${account}` : ''}`)
  const moves = data?.days.filter((d) => d.inRealized || d.outRealized || d.inProjected || d.outProjected) ?? []
  const ins = moves.reduce((s, d) => s + d.inRealized + d.inProjected, 0)
  const outs = moves.reduce((s, d) => s + d.outRealized + d.outProjected, 0)
  const lowest = data?.days.reduce((m, d) => (d.balance < m.balance ? d : m), data.days[0]!)

  return (
    <>
      <Group mb="md" gap="sm">
        <SegmentedControl data={[{ value: '30', label: '30 dias' }, { value: '60', label: '60 dias' }, { value: '90', label: '90 dias' }, { value: '180', label: '6 meses' }]} value={days} onChange={setDays} />
        <Select placeholder="Todas as contas" data={accounts} value={account} onChange={setAccount} clearable w={260} aria-label="Conta bancária" />
      </Group>
      {loading && !data ? <Loading /> : data && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
            {[['Saldo hoje', data.opening], ['Entradas previstas', ins], ['Saídas previstas', outs], [`Saldo em ${date(data.to)}`, data.closing]].map(([label, value]) => (
              <Card key={label as string}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
                <Text fw={800} fz={24} mt={4} c={(value as number) < 0 ? 'red' : undefined}>{money(value as number)}</Text>
              </Card>
            ))}
          </SimpleGrid>
          <Card mb="md" className="chart-card">
            <Group justify="space-between" mb="sm">
              <Text fw={700}>Saldo previsto</Text>
              {lowest && <Text size="sm" c={lowest.balance < 0 ? 'red' : 'dimmed'}>Menor saldo: {money(lowest.balance)} em {date(lowest.date)}</Text>}
            </Group>
            <AreaChart
              h={260}
              data={data.days.map((d) => ({ ...d, day: short(d.date) }))}
              dataKey="day"
              series={[{ name: 'balance', label: 'Saldo', color: 'var(--series-1)' }]}
              curveType="linear"
              strokeWidth={2}
              withDots={false}
              gridAxis="y"
              strokeDasharray="0"
              withGradient
              fillOpacity={0.25}
              valueFormatter={money}
              yAxisProps={{ tickFormatter: compact, width: 60 }}
              referenceLines={[{ y: 0, color: 'var(--mantine-color-dimmed)' }]}
            />
          </Card>
          <Card p={0}>
            <Table.ScrollContainer minWidth={640}>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Dia</Table.Th><Table.Th ta="right">Entradas</Table.Th><Table.Th ta="right">Saídas</Table.Th><Table.Th ta="right">Saldo do dia</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {moves.map((d) => (
                    <Table.Tr key={d.date}>
                      <Table.Td>{date(d.date)}</Table.Td>
                      <Table.Td ta="right">{money(d.inRealized + d.inProjected)}</Table.Td>
                      <Table.Td ta="right">{money(d.outRealized + d.outProjected)}</Table.Td>
                      <Table.Td ta="right" fw={600} c={d.balance < 0 ? 'red' : undefined}>{money(d.balance)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {moves.length === 0 && <Text c="dimmed" ta="center" p="lg">Sem entradas ou saídas no período.</Text>}
          </Card>
        </div>
      )}
    </>
  )
}
