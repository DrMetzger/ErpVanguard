import { Card, Group, List, Stack, Table, Text, ThemeIcon } from '@mantine/core'
import { Dropzone } from '@mantine/dropzone'
import { IconCircleCheck, IconCircleX, IconFileCode, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { date, money } from '../../lib/format'
import { useApi } from '../../lib/hooks'
import type { Invoice, InvoiceSummary } from '../../lib/types'

export default function Invoices() {
  const { data, loading, reload } = useApi<InvoiceSummary[]>('/invoices')
  const [log, setLog] = useState<{ name: string; ok: boolean; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  // Importa cada XML; se for um só, já abre a conferência.
  const importFiles = async (files: File[]) => {
    setBusy(true)
    const results: { name: string; ok: boolean; message: string; id?: string }[] = []
    for (const file of files) {
      try {
        const nf = await api<Invoice>('/invoices/import', { method: 'POST', body: { xml: await file.text() } })
        results.push({ name: file.name, ok: true, id: nf.id, message: `NF ${nf.number} · ${nf.supplierName}` })
      } catch (err) {
        results.push({ name: file.name, ok: false, message: (err as Error).message })
      }
      setLog([...results])
    }
    setBusy(false)
    reload()
    if (results.length === 1 && results[0]!.ok) navigate(`/compras/notas/${results[0]!.id}`)
  }

  return (
    <>
      <Dropzone onDrop={importFiles} loading={busy} accept={['text/xml', 'application/xml', '.xml']} radius="lg" mb="md" data-testid="xml-dropzone">
        <Group justify="center" gap="xl" mih={130} style={{ pointerEvents: 'none' }}>
          <Dropzone.Accept><IconUpload size={48} stroke={1.4} color="var(--mantine-primary-color-filled)" /></Dropzone.Accept>
          <Dropzone.Reject><IconCircleX size={48} stroke={1.4} color="var(--mantine-color-red-6)" /></Dropzone.Reject>
          <Dropzone.Idle><IconFileCode size={48} stroke={1.4} opacity={0.6} /></Dropzone.Idle>
          <div>
            <Text size="lg" fw={600}>Arraste os XMLs da NF-e aqui</Text>
            <Text size="sm" c="dimmed">ou clique para escolher. Pode mandar vários de uma vez.</Text>
          </div>
        </Group>
      </Dropzone>

      {log.length > 0 && (
        <List spacing={4} size="sm" mb="md" className="import-log">
          {log.map((l, i) => (
            <List.Item key={i} icon={<ThemeIcon size={20} radius="xl" color={l.ok ? 'teal' : 'red'} variant="light">{l.ok ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}</ThemeIcon>}>
              <Text span size="sm" c={l.ok ? undefined : 'red'} className={l.ok ? 'ok' : 'error'}>{l.name}: {l.message}</Text>
            </List.Item>
          ))}
        </List>
      )}

      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={720}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Nota</Table.Th><Table.Th>Fornecedor</Table.Th><Table.Th>Emissão</Table.Th><Table.Th>Pedido</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data?.map((n) => (
                  <Table.Tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/compras/notas/${n.id}`)}>
                    <Table.Td fw={700}>{n.number}{n.series && `/${n.series}`}</Table.Td>
                    <Table.Td>{n.supplierName}</Table.Td>
                    <Table.Td>{date(n.issueDate)}</Table.Td>
                    <Table.Td>{n.orderCode ?? '—'}</Table.Td>
                    <Table.Td ta="right">{money(n.total)}</Table.Td>
                    <Table.Td><Status value={n.status} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Stack><Empty>Nenhuma nota importada ainda.</Empty></Stack>}
      </Card>
    </>
  )
}
