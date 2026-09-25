import { BarChart } from '@mantine/charts'
import { Badge, Button, Card, Group, Progress, SegmentedControl, Select, SimpleGrid, Table, Text, Title } from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { Loading } from '../../components/ui'
import { useUser } from '../../lib/auth'
import { useOptions } from '../../lib/catalog'
import { can, money, qty } from '../../lib/format'
import { useApi } from '../../lib/hooks'

interface Overview {
  period: { from: string; to: string }
  kpis: {
    revenue: number; invoices: number; averageTicket: number; customers: number; grossMargin: number; grossMarginPct: number; purchases: number; purchaseInvoices: number
    receivable: number; receivableOverdue: number; payable: number; payableOverdue: number; stockValue: number; productsBelowMin: number; activeProducts: number
  }
  monthly: { month: string; revenue: number; cost: number; margin: number; purchases: number; received: number; paid: number }[]
  topProducts: { id: string; sku: string; name: string; quantity: number; revenue: number; margin: number; marginPct: number; curve: 'A' | 'B' | 'C' }[]
  abc: { curve: string; count: number; revenue: number; share: number }[]
  topCustomers: { label: string; revenue: number; invoices: number }[]
  byUf: { label: string; revenue: number; invoices: number }[]
  bySeller: { label: string; revenue: number; invoices: number }[]
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const compact = (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

function range(preset: string) {
  const t = today()
  const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))]
  const first = (yy: number, mm: number) => { const d = new Date(Date.UTC(yy, mm - 1, 1)); return d.toISOString().slice(0, 10) }
  if (preset === 'mes') return { from: first(y, m), to: t }
  if (preset === '3m') return { from: first(y, m - 2), to: t }
  if (preset === 'ano') return { from: `${y}-01-01`, to: t }
  return { from: first(y, m - 11), to: t }
}

function csv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => (typeof c === 'number' ? String(c).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`)).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: ReactNode; tone?: 'red' }) {
  return (
    <Card>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text fw={800} fz={26} mt={4} c={tone}>{value}</Text>
      {hint && <Text size="xs" c="dimmed" mt={2}>{hint}</Text>}
    </Card>
  )
}

// Cartão de gráfico com alternância para tabela (a tabela é a versão acessível do gráfico).
function ChartCard({ title, children, table }: { title: string; children: ReactNode; table: ReactNode }) {
  const [view, setView] = useState('grafico')
  return (
    <Card className="chart-card">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>{title}</Text>
        <SegmentedControl size="xs" value={view} onChange={setView} data={[{ value: 'grafico', label: 'Gráfico' }, { value: 'tabela', label: 'Tabela' }]} aria-label={`Ver ${title} como`} />
      </Group>
      {view === 'grafico' ? children : <Table.ScrollContainer minWidth={420}>{table}</Table.ScrollContainer>}
    </Card>
  )
}

function Ranking({ title, rows, empty }: { title: string; rows: { label: string; revenue: number; invoices: number }[]; empty: string }) {
  return (
    <ChartCard
      title={title}
      table={<Table><Table.Thead><Table.Tr><Table.Th>Nome</Table.Th><Table.Th ta="right">Notas</Table.Th><Table.Th ta="right">Faturamento</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map((r) => <Table.Tr key={r.label}><Table.Td>{r.label}</Table.Td><Table.Td ta="right">{r.invoices}</Table.Td><Table.Td ta="right">{money(r.revenue)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
    >
      {rows.length === 0 ? <Text c="dimmed" size="sm" py="xl" ta="center">{empty}</Text> : (
        <BarChart
          h={Math.max(160, rows.length * 34 + 30)}
          data={rows}
          dataKey="label"
          orientation="vertical"
          series={[{ name: 'revenue', label: 'Faturamento', color: 'var(--series-1)' }]}
          valueFormatter={money}
          gridAxis="x"
          strokeDasharray="0"
          barProps={{ radius: [0, 4, 4, 0] }}
          maxBarWidth={18}
          xAxisProps={{ tickFormatter: compact }}
          yAxisProps={{ width: 150 }}
        />
      )}
    </ChartCard>
  )
}

export default function Bi() {
  const user = useUser()
  const [preset, setPreset] = useState('12m')
  const [company, setCompany] = useState<string | null>(null)
  const companies = useOptions('companies')
  const { from, to } = range(preset)
  const { data, loading, error } = useApi<Overview>(can(user, 'bi') ? `/bi/overview?from=${from}&to=${to}${company ? `&companyId=${company}` : ''}` : null)

  if (!can(user, 'bi')) {
    return <><Title order={2}>BI Avançado</Title><Text c="dimmed" mt="sm">Seu usuário ainda não tem o perfil BI. Peça a um administrador.</Text></>
  }
  const monthly = data?.monthly.map((m) => ({ ...m, label: monthLabel(m.month) })) ?? []
  const exportAll = () => data && csv(`bi-${from}-a-${to}.csv`, [
    ['Mês', 'Faturamento', 'Custo', 'Margem bruta', 'Compras', 'Recebido', 'Pago'],
    ...data.monthly.map((m) => [monthLabel(m.month), m.revenue, m.cost, m.margin, m.purchases, m.received, m.paid]),
    [], ['Produto', 'Descrição', 'Quantidade', 'Faturamento', 'Margem', 'Margem %', 'Curva'],
    ...data.topProducts.map((p) => [p.sku, p.name, p.quantity, p.revenue, p.margin, p.marginPct, p.curve]),
    [], ['Cliente', 'Notas', 'Faturamento'], ...data.topCustomers.map((c) => [c.label, c.invoices, c.revenue]),
  ])

  return (
    <>
      <Group justify="space-between" mb="md" gap="sm">
        <Title order={2}>BI Avançado</Title>
        <Group gap="sm">
          <SegmentedControl value={preset} onChange={setPreset} data={[{ value: 'mes', label: 'Este mês' }, { value: '3m', label: '3 meses' }, { value: 'ano', label: 'Este ano' }, { value: '12m', label: '12 meses' }]} />
          <Select placeholder="Todas as empresas" data={companies} value={company} onChange={setCompany} clearable w={220} aria-label="Empresa" />
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportAll} disabled={!data}>Exportar (Excel)</Button>
        </Group>
      </Group>
      {error && <Text c="red">{error}</Text>}
      {loading && !data ? <Loading /> : data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="md">
            <Kpi label="Faturamento" value={money(data.kpis.revenue)} hint={`${data.kpis.invoices} nota(s) · ${data.kpis.customers} cliente(s)`} />
            <Kpi label="Margem bruta" value={pct(data.kpis.grossMarginPct)} hint={`${money(data.kpis.grossMargin)} sobre o custo médio`} />
            <Kpi label="Ticket médio" value={money(data.kpis.averageTicket)} />
            <Kpi label="Compras lançadas" value={money(data.kpis.purchases)} hint={`${data.kpis.purchaseInvoices} nota(s) de entrada`} />
            <Kpi label="A receber" value={money(data.kpis.receivable)} hint={data.kpis.receivableOverdue ? <Text span c="red" size="xs">{money(data.kpis.receivableOverdue)} vencido</Text> : 'nada vencido'} />
            <Kpi label="A pagar" value={money(data.kpis.payable)} hint={data.kpis.payableOverdue ? <Text span c="red" size="xs">{money(data.kpis.payableOverdue)} vencido</Text> : 'nada vencido'} />
            <Kpi label="Estoque (custo)" value={money(data.kpis.stockValue)} hint={`${data.kpis.activeProducts} produtos ativos`} />
            <Kpi label="Abaixo do mínimo" value={String(data.kpis.productsBelowMin)} hint="produtos para repor" tone={data.kpis.productsBelowMin ? 'red' : undefined} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }} mb="md">
            <ChartCard
              title="Faturamento e margem bruta por mês"
              table={<Table><Table.Thead><Table.Tr><Table.Th>Mês</Table.Th><Table.Th ta="right">Faturamento</Table.Th><Table.Th ta="right">Custo</Table.Th><Table.Th ta="right">Margem</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{monthly.map((m) => <Table.Tr key={m.month}><Table.Td>{m.label}</Table.Td><Table.Td ta="right">{money(m.revenue)}</Table.Td><Table.Td ta="right">{money(m.cost)}</Table.Td><Table.Td ta="right">{money(m.margin)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
            >
              <BarChart h={280} data={monthly} dataKey="label" withLegend legendProps={{ verticalAlign: 'top', height: 36 }}
                series={[{ name: 'revenue', label: 'Faturamento', color: 'var(--series-1)' }, { name: 'margin', label: 'Margem bruta', color: 'var(--series-2)' }]}
                valueFormatter={money} gridAxis="y" strokeDasharray="0" barProps={{ radius: [4, 4, 0, 0] }} maxBarWidth={22} yAxisProps={{ tickFormatter: compact, width: 56 }} />
            </ChartCard>
            <ChartCard
              title="Dinheiro que entrou e saiu por mês"
              table={<Table><Table.Thead><Table.Tr><Table.Th>Mês</Table.Th><Table.Th ta="right">Recebido</Table.Th><Table.Th ta="right">Pago</Table.Th><Table.Th ta="right">Compras</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{monthly.map((m) => <Table.Tr key={m.month}><Table.Td>{m.label}</Table.Td><Table.Td ta="right">{money(m.received)}</Table.Td><Table.Td ta="right">{money(m.paid)}</Table.Td><Table.Td ta="right">{money(m.purchases)}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
            >
              <BarChart h={280} data={monthly} dataKey="label" withLegend legendProps={{ verticalAlign: 'top', height: 36 }}
                series={[{ name: 'received', label: 'Recebido', color: 'var(--series-1)' }, { name: 'paid', label: 'Pago', color: 'var(--series-2)' }]}
                valueFormatter={money} gridAxis="y" strokeDasharray="0" barProps={{ radius: [4, 4, 0, 0] }} maxBarWidth={22} yAxisProps={{ tickFormatter: compact, width: 56 }} />
            </ChartCard>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 3 }} mb="md">
            <Card className="bi-wide">
              <Text fw={700} mb="sm">Produtos que mais faturaram</Text>
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead><Table.Tr><Table.Th>Produto</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th ta="right">Faturamento</Table.Th><Table.Th ta="right">Margem</Table.Th><Table.Th>Curva</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {data.topProducts.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td><Text size="sm" fw={600}>{p.sku} <Text span fw={400}>· {p.name}</Text></Text></Table.Td>
                        <Table.Td ta="right">{qty(p.quantity)}</Table.Td>
                        <Table.Td ta="right">{money(p.revenue)}</Table.Td>
                        <Table.Td ta="right">{money(p.margin)} <Text span size="xs" c="dimmed">({pct(p.marginPct)})</Text></Table.Td>
                        <Table.Td><Badge variant="light" radius="sm" color="gray">{p.curve}</Badge></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {data.topProducts.length === 0 && <Text c="dimmed" size="sm" ta="center" py="lg">Nenhuma venda no período.</Text>}
            </Card>
            <Card>
              <Text fw={700}>Curva ABC</Text>
              <Text size="xs" c="dimmed" mb="md">A = produtos que fazem 80% do faturamento</Text>
              {data.abc.map((a) => (
                <div key={a.curve} style={{ marginBottom: 14 }}>
                  <Group justify="space-between" mb={4}><Text size="sm" fw={700}>Curva {a.curve} · {a.count} produto(s)</Text><Text size="sm">{pct(a.share)}</Text></Group>
                  <Progress value={a.share} color="var(--series-1)" size="md" radius="xl" aria-label={`Curva ${a.curve}: ${pct(a.share)} do faturamento`} />
                  <Text size="xs" c="dimmed" mt={2}>{money(a.revenue)}</Text>
                </div>
              ))}
            </Card>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 3 }}>
            <Ranking title="Melhores clientes" rows={data.topCustomers} empty="Nenhuma venda no período." />
            <Ranking title="Vendas por estado" rows={data.byUf} empty="Nenhuma venda no período." />
            <Ranking title="Vendas por vendedor" rows={data.bySeller} empty="Nenhuma venda no período." />
          </SimpleGrid>
        </div>
      )}
    </>
  )
}
