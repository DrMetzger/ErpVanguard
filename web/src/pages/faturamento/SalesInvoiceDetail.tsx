import { Alert, Anchor, Button, Card, Group, Modal, SimpleGrid, Stack, Table, Text, Textarea } from '@mantine/core'
import { IconArrowLeft, IconPrinter, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loading, PageHeader, ReportHeader, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { can, cnpj, date, money, price, qty } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import { dateTime } from './SalesInvoices'
import { ItemTaxBadge, REGIMES, TaxTotalsBlock } from './TaxSummary'
import { NfePanel, SefazBadge } from './NfePanel'
import type { SalesInvoice } from './types'

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>{children}</div>
)

// Espelho da nota de saída e a NF-e na SEFAZ (XML, transmissão, DANFE e eventos).
export default function SalesInvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useUser()
  const { data: nf, error, setData } = useApi<SalesInvoice>(`/sales-invoices/${id}`)
  const reload = async () => setData(await api<SalesInvoice>(`/sales-invoices/${id}`))
  const [canceling, setCanceling] = useState(false)
  const [reason, setReason] = useState('')
  const { busy, run } = useAction()

  if (error) return <Text c="red">{error}</Text>
  if (!nf) return <Loading />
  const cancel = () => run(async () => { setData(await api<SalesInvoice>(`/sales-invoices/${nf.id}/cancel`, { method: 'POST', body: { reason } })); setCanceling(false) }, 'Nota cancelada')
  const address = [nf.customerStreet && `${nf.customerStreet}${nf.customerNumber ? `, ${nf.customerNumber}` : ''}`, nf.customerDistrict, nf.customerCity && `${nf.customerCity}/${nf.customerUf ?? ''}`].filter(Boolean).join(' · ')

  return (
    <>
      <ReportHeader title={`Espelho da NF ${nf.number}/${nf.series}`} />
      <PageHeader
        back={<Anchor component={Link} to="/faturamento/notas" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> Notas emitidas</Group></Anchor>}
        title={<Group gap="sm">NF {nf.number}/{nf.series} <Status value={nf.status} /></Group>}
        description={`${nf.model === '65' ? 'NFC-e' : 'NF-e'} série ${nf.series} · emitida em ${dateTime(nf.issuedAt)} · ${nf.operationLabel}${nf.orderCode ? ` · pedido ${nf.orderCode}` : ''} · ${nf.companyLabel}${nf.taxRegime ? ` · ${REGIMES[nf.taxRegime] ?? nf.taxRegime}` : ''}`}
        actions={<>
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Imprimir espelho</Button>
          {nf.status === 'emitida' && !['autorizada', 'erro'].includes(nf.sefazStatus) && can(user, 'faturamento') && <Button variant="subtle" color="red" leftSection={<IconX size={16} />} onClick={() => setCanceling(true)}>Cancelar nota</Button>}
        </>}
      />
      {nf.status === 'cancelada' && <Alert color="gray" mb="md" title="Nota cancelada">{nf.cancelReason}</Alert>}

      <NfePanel nf={nf} reload={reload} />

      <Card mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Fact label="Destinatário"><Text fw={600}>{nf.customerName}</Text><Text size="xs" c="dimmed" ff="monospace">{cnpj(nf.customerDocument)}{nf.customerIe && ` · IE ${nf.customerIe}`}</Text></Fact>
          <Fact label="Endereço"><Text size="sm">{address || '—'}</Text></Fact>
          <Fact label="SEFAZ"><Group gap={4} mt={4}><SefazBadge status={nf.sefazStatus} /></Group></Fact>
          <Fact label="Total da nota"><Text fw={800} fz="xl">{money(nf.total)}</Text></Fact>
        </SimpleGrid>
      </Card>

      <Card p={0} mb="md">
        <Table.ScrollContainer minWidth={820}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>#</Table.Th><Table.Th>Produto</Table.Th><Table.Th>NCM</Table.Th><Table.Th>CFOP</Table.Th><Table.Th>TES</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th ta="right">Preço unit.</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Impostos</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {nf.items.map((i) => (
                <Table.Tr key={i.itemNumber}>
                  <Table.Td>{i.itemNumber}</Table.Td>
                  <Table.Td><Text size="sm" fw={600}>{i.sku} <Text span fw={400}>· {i.description}</Text></Text></Table.Td>
                  <Table.Td ff="monospace">{i.ncm ?? '—'}</Table.Td>
                  <Table.Td>{i.cfop}</Table.Td>
                  <Table.Td>{i.tesCode}</Table.Td>
                  <Table.Td ta="right">{qty(i.quantity)} {i.unit}</Table.Td>
                  <Table.Td ta="right">{price(i.unitPrice)}</Table.Td>
                  <Table.Td ta="right" fw={600}>{money(i.total)}</Table.Td>
                  <Table.Td><ItemTaxBadge taxes={i.taxes} /></Table.Td>
                </Table.Tr>
              ))}
                          </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {nf.taxes && <Card mb="md" maw={520} ml="auto"><Text fw={700} mb="xs">Totais e impostos</Text><TaxTotalsBlock totals={nf.taxes} regime={nf.taxRegime} csts={nf.items.map((i) => i.taxes?.icms.cst).filter((c): c is string => !!c)} /></Card>}

      <Card>
        <Text fw={700} mb="sm">{nf.titles[0]?.docType === 'NDF' ? 'Débito do fornecedor (NDF, no contas a pagar)' : 'Parcelas (contas a receber)'}</Text>
        {nf.titles.length === 0 ? <Text size="sm" c="dimmed">Esta operação não gera financeiro.</Text> : (
          <Table highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Parcela</Table.Th><Table.Th>Vencimento</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th ta="right">Recebido</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {nf.titles.map((t) => (
                <Table.Tr key={t.id} style={{ cursor: 'pointer' }} title="Abrir no Financeiro" onClick={() => navigate(`/financeiro/${t.kind === 'P' ? 'pagar' : 'receber'}?titulo=${t.id}`)}>
                  <Table.Td><Anchor component="span" size="sm">{t.installment}/{t.installments}</Anchor></Table.Td><Table.Td>{date(t.dueDate)}</Table.Td>
                  <Table.Td ta="right">{money(t.amount)}</Table.Td><Table.Td ta="right">{money(t.paidAmount)}</Table.Td><Table.Td><Status value={t.status} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Modal opened={canceling} onClose={() => setCanceling(false)} title={`Cancelar NF ${nf.number}/${nf.series}`}>
        <Stack>
          <Text size="sm">O estoque volta, as parcelas são canceladas e o pedido volta para "a faturar". Se houver recebimento baixado, estorne no Financeiro antes.</Text>
          <Textarea label="Justificativa" description="Mínimo de 15 caracteres (exigência da SEFAZ)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCanceling(false)}>Voltar</Button>
            <Button color="red" onClick={cancel} loading={busy} disabled={reason.trim().length < 15}>Cancelar nota</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
