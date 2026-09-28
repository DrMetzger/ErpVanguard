import { Alert, Anchor, Badge, Button, Card, Drawer, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { IconDownload, IconPrinter } from '@tabler/icons-react'
import { useState } from 'react'
import { Empty, Loading, ReportHeader, Status } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'

interface Values { revenue: number; expense: number; result: number; count: number }
interface Row extends Values { id: string; code: string; name: string; type: 'A' | 'S'; parentId: string | null; active: boolean; level: number }
interface Report { from: string; to: string; basis: string; rows: Row[]; none: Values; total: Values }
interface Detail { id: string; kind: 'R' | 'P'; docType: string; description: string; document: string | null; date: string; dueDate: string; amount: number; status: string; partner: string | null; category: string | null; costCenter: string | null }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const BASIS = { competencia: 'Competência (emissão dos títulos)', caixa: 'Caixa (baixas pela data do pagamento)' }

// Receitas, despesas e resultado por centro de custo, com os lançamentos de cada um.
export default function CostCenterReport() {
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`)
  const [to, setTo] = useState(today())
  const [basis, setBasis] = useState<keyof typeof BASIS>('competencia')
  const [open, setOpen] = useState<{ id: string; label: string } | null>(null)
  const valid = !!from && !!to && from <= to
  const { data, loading, error } = useApi<Report>(valid ? `/finance/cost-center-report?from=${from}&to=${to}&basis=${basis}` : null)
  const rows = data ? [...data.rows.map((r) => ({ ...r, label: `${r.code} · ${r.name}` })), { id: 'sem', label: 'Sem centro de custo', level: 0, type: 'A' as const, ...data.none }] : []

  const exportCsv = () => data && downloadCsv(`centros-de-custo-${from}-a-${to}.csv`, [
    ['Relatório por centro de custo', `${date(from)} a ${date(to)}`, BASIS[basis]],
    ['Centro de custo', 'Tipo', 'Receitas', 'Despesas', 'Resultado', 'Lançamentos'],
    ...rows.map((r) => [`${'  '.repeat(r.level)}${r.label}`, r.type === 'S' ? 'Sintético' : 'Analítico', r.revenue, r.expense, r.result, r.count]),
    ['Total', '', data.total.revenue, data.total.expense, data.total.result, data.total.count],
  ])

  return (
    <>
      <ReportHeader title={`Resultado por centro de custo · ${date(from)} a ${date(to)}`} />
      <Group mb="md" gap="sm" align="flex-end" className="no-print">
        <TextInput type="date" label="De" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={160} />
        <TextInput type="date" label="até" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={160} />
        <div>
          <Text size="sm" fw={500} mb={4}>Regime</Text>
          <SegmentedControl value={basis} onChange={(v) => setBasis(v as keyof typeof BASIS)} data={[{ value: 'competencia', label: 'Competência' }, { value: 'caixa', label: 'Caixa' }]} />
        </div>
        <Group ml="auto" gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv} disabled={!data}>Exportar CSV</Button>
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()} disabled={!data}>Imprimir</Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="md">{BASIS[basis]}. Receitas = contas a receber; despesas = contas a pagar (créditos de devolução abatem o lado deles). Clique num centro para ver os lançamentos.</Text>
      {!valid && <Text c="red" size="sm" mb="md">Período inválido.</Text>}
      {error && <Text c="red" mb="md">{error}</Text>}
      {loading && !data ? <Loading /> : data && (
        <Card p={0} style={{ opacity: loading ? 0.6 : 1 }}>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>Centro de custo</Table.Th><Table.Th ta="right">Receitas</Table.Th><Table.Th ta="right">Despesas</Table.Th><Table.Th ta="right">Resultado</Table.Th><Table.Th ta="right">Lançamentos</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id} fw={r.type === 'S' ? 700 : undefined}>
                    <Table.Td style={{ paddingLeft: 12 + r.level * 20 }}>
                      <Group gap={6} wrap="nowrap">
                        <Anchor component="button" size="sm" fw={r.type === 'S' ? 700 : undefined} onClick={() => setOpen({ id: r.id, label: r.label })} c={r.id === 'sem' ? 'dimmed' : undefined}>{r.label}</Anchor>
                        {r.type === 'S' && <Badge size="xs" variant="light" color="gray" radius="sm">sintético</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">{money(r.revenue)}</Table.Td>
                    <Table.Td ta="right">{money(r.expense)}</Table.Td>
                    <Table.Td ta="right" fw={600} c={r.result < 0 ? 'red' : undefined}>{money(r.result)}</Table.Td>
                    <Table.Td ta="right"><Text size="sm" c="dimmed">{r.count}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr fw={800}><Table.Td>Total</Table.Td><Table.Td ta="right">{money(data.total.revenue)}</Table.Td><Table.Td ta="right">{money(data.total.expense)}</Table.Td><Table.Td ta="right" c={data.total.result < 0 ? 'red' : undefined}>{money(data.total.result)}</Table.Td><Table.Td ta="right">{data.total.count}</Table.Td></Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {open && <Details center={open} from={from} to={to} basis={basis} onClose={() => setOpen(null)} />}
    </>
  )
}

function Details({ center, from, to, basis, onClose }: { center: { id: string; label: string }; from: string; to: string; basis: string; onClose: () => void }) {
  const { data, loading } = useApi<Detail[]>(`/finance/cost-center-report/details?from=${from}&to=${to}&basis=${basis}&costCenterId=${center.id}`)
  const total = data?.reduce((s, d) => s + d.amount, 0) ?? 0
  const exportCsv = () => data && downloadCsv(`lancamentos-${center.label.split(' · ')[0]}-${from}-a-${to}.csv`, [
    ['Data', 'Tipo', 'Descrição', 'Documento', 'Cliente/fornecedor', 'Categoria', 'Centro de custo', 'Valor', 'Situação'],
    ...data.map((d) => [d.date, d.kind === 'R' ? 'Receber' : 'Pagar', d.description, d.document, d.partner, d.category, d.costCenter, d.amount, d.status]),
  ])
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={`${center.label} · ${date(from)} a ${date(to)}`}>
      {loading && !data ? <Loading /> : data && (
        <>
          <Group justify="space-between" mb="sm">
            <Text size="sm" c="dimmed">{data.length} lançamento(s) · resultado <Text span fw={700} c={total < 0 ? 'red' : 'var(--mantine-color-text)'}>{money(total)}</Text></Text>
            <Button size="compact-sm" variant="default" leftSection={<IconDownload size={14} />} onClick={exportCsv} disabled={!data.length}>CSV</Button>
          </Group>
          {data.length >= 2000 && <Alert color="orange" variant="light" mb="sm">Mostrando os primeiros 2.000 lançamentos.</Alert>}
          {data.length === 0 ? <Empty>Nenhum lançamento no período.</Empty> : (
            <Table.ScrollContainer minWidth={640}>
              <Table striped>
                <Table.Thead><Table.Tr><Table.Th>Data</Table.Th><Table.Th>Descrição</Table.Th><Table.Th>Categoria</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data.map((d, i) => (
                    <Table.Tr key={`${d.id}-${i}`}>
                      <Table.Td>{date(d.date)}</Table.Td>
                      <Table.Td><Text size="sm">{d.description}</Text><Text size="xs" c="dimmed">{[d.partner, d.document, center.id !== 'sem' && d.costCenter].filter(Boolean).join(' · ')}</Text></Table.Td>
                      <Table.Td><Text size="sm">{d.category ?? '—'}</Text></Table.Td>
                      <Table.Td ta="right" fw={600} c={d.amount < 0 ? 'red' : 'teal'}>{money(d.amount)}</Table.Td>
                      <Table.Td><Status value={d.status} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}
    </Drawer>
  )
}
