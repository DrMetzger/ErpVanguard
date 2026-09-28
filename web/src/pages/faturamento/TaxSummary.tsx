import { Alert, Divider, Group, HoverCard, Stack, Table, Text } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { money } from '../../lib/format'
import type { ItemTaxes, TaxTotals } from './types'

const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

export const REGIMES: Record<string, string> = { simples: 'Simples Nacional', simples_excesso: 'Simples Nacional (excesso de sublimite)', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' }
const SIMPLES = ['simples', 'simples_excesso', 'mei']

// Totais do documento: o que compõe a nota e os impostos só informativos.
// Com o regime, explica quando não há destaque (Simples: ICMS, PIS e COFINS vão no DAS).
export function TaxTotalsBlock({ totals, regime, csts }: { totals: TaxTotals; regime?: string | null; csts?: string[] }) {
  const row = (label: string, value: number, strong = false) => (
    <Group justify="space-between" key={label}><Text c={strong ? undefined : 'dimmed'} fw={strong ? 700 : undefined} size="sm">{label}</Text><Text size="sm" fw={strong ? 700 : undefined}>{money(value)}</Text></Group>
  )
  const info = [
    ['ICMS (destacado)', totals.icms], ['FCP', totals.fcp], ['DIFAL (UF destino)', totals.difal], ['FCP UF destino', totals.fcpDest],
    ['PIS', totals.pis], ['COFINS', totals.cofins], ['Crédito do Simples', totals.snCredit],
  ].filter(([, v]) => (v as number) > 0) as [string, number][]
  return (
    <Stack gap={4}>
      {row('Produtos', totals.products)}
      {totals.discount > 0 && row('Desconto', -totals.discount)}
      {totals.freight > 0 && row('Frete', totals.freight)}
      {totals.ipi > 0 && row('IPI', totals.ipi)}
      {totals.st > 0 && row('ICMS-ST', totals.st)}
      <Divider my={4} />
      <Group justify="space-between"><Text fw={700}>Total da nota</Text><Text fw={800} fz={24}>{money(totals.total)}</Text></Group>
      {info.length > 0 && (
        <>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} mt="xs">Impostos da operação (já dentro do preço)</Text>
          {info.map(([l, v]) => row(l, v))}
        </>
      )}
      {regime && SIMPLES.includes(regime) && totals.icms === 0 && totals.ipi === 0 && totals.st === 0 && (
        <Alert variant="light" color="blue" p="xs" mt="xs" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">
            <b>{REGIMES[regime]}{csts?.length ? ` — CSOSN ${[...new Set(csts)].join(', ')}` : ''}:</b> sem destaque de ICMS, IPI, PIS e COFINS na nota.
            Esses tributos são recolhidos no DAS{totals.snCredit > 0 ? '; o crédito do Simples sai nas informações complementares' : ''}.
          </Text>
        </Alert>
      )}
      {regime && !SIMPLES.includes(regime) && info.length === 0 && totals.ipi === 0 && totals.st === 0 && totals.products > 0 && (
        <Alert variant="light" color="orange" p="xs" mt="xs" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">{REGIMES[regime] ?? regime}: nenhum imposto calculado. Confira a TES e a matriz de impostos (Cadastros › Fiscal).</Text>
        </Alert>
      )}
      {totals.approxTax !== undefined && (
        <Group justify="space-between" mt={4} wrap="nowrap" gap="xs">
          <Text size="xs" c="dimmed" title="Lei 12.741/2012, percentuais da tabela IBPT (por NCM ou o padrão MV_IBPTPCT)">Valor aprox. dos tributos (Lei 12.741)</Text>
          <Text size="xs" fw={600}>{totals.approxTax > 0 ? `${money(totals.approxTax)} (${pct(Math.round((totals.approxTax / Math.max(0.01, totals.products - totals.discount)) * 10000) / 100)})` : 'configure MV_IBPTPCT ou o % no NCM'}</Text>
        </Group>
      )}
    </Stack>
  )
}

// Detalhe dos impostos de um item (passar o mouse).
export function ItemTaxBadge({ taxes }: { taxes: ItemTaxes | null | undefined }) {
  if (!taxes) return <Text size="xs" c="dimmed">—</Text>
  // CST de 3 dígitos é CSOSN (Simples Nacional)
  const cstLabel = taxes.icms.cst.length === 3 ? 'CSOSN' : 'CST'
  const lines: [string, string][] = [
    [`ICMS · ${cstLabel} ${taxes.icms.cst}`, taxes.icms.value ? `${money(taxes.icms.base)} × ${pct(taxes.icms.rate)} = ${money(taxes.icms.value)}` : 'sem destaque'],
  ]
  if (taxes.icms.reduction) lines.push(['Redução da base', pct(taxes.icms.reduction)])
  if (taxes.icms.snCredit) lines.push(['Crédito do Simples', money(taxes.icms.snCredit)])
  if (taxes.st) lines.push(['ICMS-ST', `base ${money(taxes.st.base)} (MVA ${pct(taxes.st.mva)}) × ${pct(taxes.st.rate)} − ICMS próprio = ${money(taxes.st.value)}`])
  if (taxes.ipi) lines.push([`IPI · ${taxes.ipi.cst}`, `${money(taxes.ipi.base)} × ${pct(taxes.ipi.rate)} = ${money(taxes.ipi.value)}`])
  if (taxes.fcp) lines.push(['FCP', `${pct(taxes.fcp.rate)} = ${money(taxes.fcp.value)}`])
  if (taxes.difal) lines.push(['DIFAL', `${money(taxes.difal.base)} × (${pct(taxes.difal.destRate)} − ${pct(taxes.difal.interRate)}) = ${money(taxes.difal.value)}${taxes.difal.fcpValue ? ` + FCP ${money(taxes.difal.fcpValue)}` : ''}`])
  lines.push([`PIS · ${taxes.pis.cst}`, taxes.pis.value ? `${pct(taxes.pis.rate)} = ${money(taxes.pis.value)}` : 'sem destaque'])
  lines.push([`COFINS · ${taxes.cofins.cst}`, taxes.cofins.value ? `${pct(taxes.cofins.rate)} = ${money(taxes.cofins.value)}` : 'sem destaque'])
  if (taxes.approx) lines.push(['Tributos aprox.', `${pct(taxes.approx.rate)} = ${money(taxes.approx.value)}`])
  const extra = (taxes.ipi?.value ?? 0) + (taxes.st?.value ?? 0)
  return (
    <HoverCard width={440} shadow="lg" withinPortal position="left">
      <HoverCard.Target>
        <Group gap={4} wrap="nowrap" style={{ cursor: 'help' }}>
          <Text size="xs">{cstLabel} {taxes.icms.cst}{extra > 0 && ` · +${money(extra)}`}</Text>
          <IconInfoCircle size={14} />
        </Group>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Table>
          <Table.Tbody>{lines.map(([k, v]) => <Table.Tr key={k}><Table.Td fw={600} style={{ whiteSpace: 'nowrap' }}>{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
        {taxes.rules.length > 0 && <Text size="xs" c="dimmed" mt="xs">Regras: {taxes.rules.join(' · ')}</Text>}
      </HoverCard.Dropdown>
    </HoverCard>
  )
}
