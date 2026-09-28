import { Accordion, Alert, Button, Card, Group, List, SegmentedControl, Select, Table, Text, TextInput } from '@mantine/core'
import { IconDownload, IconInfoCircle, IconPrinter } from '@tabler/icons-react'
import { useState } from 'react'
import { Loading, ReportHeader } from '../../components/ui'
import { useOptions } from '../../lib/catalog'
import { downloadCsv } from '../../lib/csv'
import { money } from '../../lib/format'
import { useApi } from '../../lib/hooks'

interface DreLine { code: string; label: string; total: boolean; values: number[]; amount: number; pct: number | null; compare: number | null }
interface DreData { from: string; to: string; months: string[]; unclassified: { count: number; amount: number }; compare: { from: string; to: string } | null; lines: DreLine[] }

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
const variation = (now: number, before: number | null) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null)
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)

// DRE gerencial por competência, mês a mês, com comparação e filtro por centro de custo.
export default function Dre() {
  const [from, setFrom] = useState(`${thisMonth().slice(0, 4)}-01`)
  const [to, setTo] = useState(thisMonth())
  const [costCenterId, setCostCenterId] = useState<string | null>(null)
  const [compare, setCompare] = useState('nenhum')
  const centers = useOptions('cost-centers')
  const valid = /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to
  const params = new URLSearchParams({ from, to, compare, ...(costCenterId && { costCenterId }) })
  const { data, loading, error } = useApi<DreData>(valid ? `/finance/dre?${params}` : null)
  const center = centers.find((c) => c.value === costCenterId)?.label
  const periodLabel = data ? `${monthLabel(data.from)} a ${monthLabel(data.to)}` : ''
  const showCompare = !!data?.compare

  const exportCsv = () => data && downloadCsv(`dre-${data.from}-a-${data.to}.csv`, [
    ['DRE', periodLabel, center ? `Centro de custo ${center}` : 'Todos os centros de custo'],
    ['Linha', ...data.months.map(monthLabel), 'Total', '% receita líquida', ...(showCompare ? [`${monthLabel(data.compare!.from)} a ${monthLabel(data.compare!.to)}`, 'Variação %'] : [])],
    ...data.lines.map((l) => [l.label, ...l.values, l.amount, l.pct ?? '', ...(showCompare ? [l.compare ?? 0, variation(l.amount, l.compare) ?? ''] : [])]),
  ])

  return (
    <>
      <ReportHeader title={`DRE · ${periodLabel}${center ? ` · ${center}` : ''}`} />
      <Group mb="md" gap="sm" align="flex-end" className="no-print">
        <TextInput type="month" label="De" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={160} />
        <TextInput type="month" label="até" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={160} />
        <Select label="Centro de custo" placeholder="Todos" data={centers} value={costCenterId} onChange={setCostCenterId} clearable searchable w={240} description="Sintético soma os filhos" />
        <div>
          <Text size="sm" fw={500} mb={4}>Comparar com</Text>
          <SegmentedControl value={compare} onChange={setCompare} data={[{ value: 'nenhum', label: 'Nada' }, { value: 'anterior', label: 'Período anterior' }, { value: 'ano', label: 'Ano anterior' }]} />
        </div>
        <Group ml="auto" gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv} disabled={!data}>Exportar CSV</Button>
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()} disabled={!data}>Imprimir</Button>
        </Group>
      </Group>
      {!valid && <Text c="red" size="sm" mb="md">Informe um período válido (mês inicial até o final).</Text>}
      {error && <Text c="red" mb="md">{error}</Text>}
      {data && data.unclassified.count > 0 && (
        <Alert color="orange" variant="light" mb="md" className="no-print">
          {data.unclassified.count} título(s) lançado(s) à mão no período ({money(data.unclassified.amount)}) sem natureza com linha da DRE: não entram. Classifique a categoria no título ou a linha da DRE no Plano de contas.
        </Alert>
      )}
      {loading && !data ? <Loading /> : data && (
        <Card p={0} style={{ opacity: loading ? 0.6 : 1 }}>
          <Table.ScrollContainer minWidth={520 + data.months.length * 110}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th miw={260}>{center ? `Centro ${center}` : 'Todos os centros de custo'}</Table.Th>
                  {data.months.length > 1 && data.months.map((m) => <Table.Th key={m} ta="right">{monthLabel(m)}</Table.Th>)}
                  <Table.Th ta="right">Total</Table.Th>
                  <Table.Th ta="right">% RL</Table.Th>
                  {showCompare && <><Table.Th ta="right">{monthLabel(data.compare!.from)} a {monthLabel(data.compare!.to)}</Table.Th><Table.Th ta="right">Var.</Table.Th></>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.lines.map((l) => {
                  const v = variation(l.amount, l.compare)
                  return (
                    <Table.Tr key={l.code} fw={l.total ? 700 : undefined} bg={l.total ? 'var(--mantine-color-default-hover)' : undefined}>
                      <Table.Td pl={l.total ? undefined : 'lg'}>{l.label}</Table.Td>
                      {data.months.length > 1 && l.values.map((x, i) => <Table.Td key={i} ta="right" c={x < 0 ? 'red' : undefined}>{money(x)}</Table.Td>)}
                      <Table.Td ta="right" c={l.amount < 0 ? 'red' : undefined}>{money(l.amount)}</Table.Td>
                      <Table.Td ta="right"><Text size="sm" c="dimmed">{pct(l.pct)}</Text></Table.Td>
                      {showCompare && <><Table.Td ta="right" c={(l.compare ?? 0) < 0 ? 'red' : undefined}>{money(l.compare)}</Table.Td><Table.Td ta="right"><Text size="sm" c={v === null ? 'dimmed' : v >= 0 ? 'teal' : 'red'}>{v === null ? '—' : `${v > 0 ? '+' : ''}${pct(v)}`}</Text></Table.Td></>}
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      <Accordion variant="contained" mt="md" className="no-print">
        <Accordion.Item value="premissas">
          <Accordion.Control icon={<IconInfoCircle size={18} />}>Como a DRE é montada (premissas)</Accordion.Control>
          <Accordion.Panel>
            <List size="sm" spacing={4}>
              <List.Item>Regime de competência: notas pela data de emissão, títulos pela data de emissão do título; juros e descontos das baixas pela data do pagamento.</List.Item>
              <List.Item><b>Receita bruta</b>: notas de saída emitidas cujo tipo de operação não é devolução e cuja TES gera financeiro (valor dos produtos − desconto + frete; IPI e ST não são receita). Soma os títulos lançados à mão com natureza "Receita bruta" (ex.: serviços).</List.Item>
              <List.Item><b>Deduções</b>: ICMS, FCP, DIFAL, PIS e COFINS calculados nas notas + devoluções de venda (notas de entrada com operação de devolução, pelo total).</List.Item>
              <List.Item><b>CMV/CPV</b>: quantidade vendida × custo médio do produto na hora do faturamento; mais títulos com natureza "CMV/CPV" (ex.: custos de produção). A mercadoria devolvida não estorna o CMV.</List.Item>
              <List.Item><b>Despesas e outras linhas</b>: títulos lançados à mão, pela linha da DRE da categoria (Plano de contas). Títulos gerados por notas não entram de novo (a nota já entrou acima). Compra de mercadoria fica "Fora da DRE": vai para o estoque e vira CMV quando vendida. Guias de impostos sobre vendas também ficam fora, para não contar duas vezes.</List.Item>
              <List.Item><b>Despesas financeiras</b>: tarifas, juros pagos e descontos concedidos, menos juros recebidos e descontos obtidos nas baixas.</List.Item>
              <List.Item>Filtro por centro de custo usa o centro gravado na nota, na nota de entrada ou no título; um centro sintético soma todos os filhos. Títulos cancelados e notas canceladas não entram.</List.Item>
              <List.Item>DRE gerencial: não substitui a contábil do seu contador.</List.Item>
            </List>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </>
  )
}
