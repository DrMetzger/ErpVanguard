import { Alert, Badge, Button, Card, Group, List, Modal, SimpleGrid, Stack, Table, Text, Textarea, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconBan, IconCircleCheck, IconDownload, IconFileCheck, IconFileTypePdf, IconPencil, IconSend } from '@tabler/icons-react'
import { useState } from 'react'
import { api, apiFile } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { can } from '../../lib/format'
import { useAction } from '../../lib/hooks'
import { dateTime } from './SalesInvoices'
import type { SalesInvoice } from './types'

const SEFAZ: Record<string, [string, string]> = {
  pendente: ['Não transmitida', 'gray'], autorizada: ['Autorizada', 'teal'], rejeitada: ['Rejeitada', 'red'], denegada: ['Uso denegado', 'orange'],
  cancelada: ['Cancelada na SEFAZ', 'dark'], erro: ['Erro de comunicação', 'yellow'],
}
export function SefazBadge({ status }: { status: string }) {
  const [label, color] = SEFAZ[status] ?? [status, 'gray']
  return <Badge variant={status === 'pendente' ? 'outline' : 'light'} color={color} radius="sm" style={{ textTransform: 'none' }}>{label}</Badge>
}
export function EnvironmentBadge({ env }: { env: string | null }) {
  if (!env) return null
  return env === 'producao'
    ? <Badge color="blue" variant="light" radius="sm">Produção</Badge>
    : <Badge color="yellow" variant="filled" radius="sm" c="dark">HOMOLOGAÇÃO · sem valor fiscal</Badge>
}
// Chave de acesso em blocos de 4 dígitos, como no DANFE.
export const formatKey = (k: string | null) => (k ? k.replace(/(\d{4})(?=\d)/g, '$1 ') : '—')

const EVENTS: Record<string, string> = { transmissao: 'Transmissão', consulta: 'Consulta da chave', cancelamento: 'Cancelamento', cce: 'Carta de correção', inutilizacao: 'Inutilização', status: 'Status do serviço' }

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>{children}</div>
)

async function download(path: string, open = false) {
  const { blob, name } = await apiFile(path)
  const url = URL.createObjectURL(blob)
  if (open) window.open(url, '_blank')
  else Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

interface Validation { accessKey: string; valid: boolean; errors: string[]; warnings: string[]; environment: string }
interface Outcome { sefazStatus: string; code: string | null; message: string | null; protocol: string | null }

// NF-e da nota de venda: situação na SEFAZ, XML, transmissão, DANFE, cancelamento, CC-e e histórico.
export function NfePanel({ nf, reload }: { nf: SalesInvoice; reload: () => Promise<void> }) {
  const user = useUser()
  const { busy, run } = useAction()
  const [validation, setValidation] = useState<Validation | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [modal, setModal] = useState<'cancel' | 'cce' | null>(null)
  const [text, setText] = useState('')
  const fat = can(user, 'faturamento')
  const s = nf.sefazStatus
  const canBuild = nf.status === 'emitida' && ['pendente', 'rejeitada'].includes(s)
  const canSend = nf.status === 'emitida' && ['pendente', 'rejeitada', 'erro'].includes(s)
  const prod = (nf.environment ?? nf.certificateEnvironment) === 'producao'

  const generate = () => run(async () => {
    setValidation(await api<Validation>(`/sales-invoices/${nf.id}/nfe/xml`, { method: 'POST' }))
    await reload()
  })
  const transmit = () => run(async () => {
    setConfirming(false); setTyped('')
    const r = await api<Outcome>(`/sales-invoices/${nf.id}/nfe/transmit`, { method: 'POST' })
    await reload()
    if (r.sefazStatus !== 'autorizada') throw new Error(`${r.code ? `[${r.code}] ` : ''}${r.message ?? 'Não autorizada'}`)
  }, 'NF-e autorizada pela SEFAZ')
  const sendEvent = () => run(async () => {
    const r = modal === 'cancel'
      ? await api<{ ok: boolean; code: string | null; message: string }>(`/sales-invoices/${nf.id}/nfe/cancel`, { method: 'POST', body: { justificativa: text } })
      : await api<{ ok: boolean; code: string | null; message: string }>(`/sales-invoices/${nf.id}/nfe/cce`, { method: 'POST', body: { correcao: text } })
    await reload()
    if (!r.ok) throw new Error(`${r.code ? `[${r.code}] ` : ''}${r.message}`)
    setModal(null); setText('')
  }, modal === 'cancel' ? 'NF-e cancelada na SEFAZ' : 'Carta de correção registrada')

  return (
    <Card mb="md" className="no-print">
      <Group justify="space-between" mb="sm">
        <Group gap="xs"><Text fw={700}>NF-e na SEFAZ</Text><SefazBadge status={s} /><EnvironmentBadge env={nf.environment ?? nf.certificateEnvironment ?? null} /></Group>
        {fat && (
          <Group gap="xs">
            {canBuild && <Button size="xs" variant="default" leftSection={<IconFileCheck size={16} />} onClick={generate} loading={busy}>Gerar e validar XML</Button>}
            {canSend && <Button size="xs" leftSection={<IconSend size={16} />} onClick={() => setConfirming(true)} loading={busy}>{s === 'erro' ? 'Consultar e transmitir' : 'Transmitir à SEFAZ'}</Button>}
            {nf.hasXml && <Button size="xs" variant="default" leftSection={<IconDownload size={16} />} onClick={() => run(() => download(`/sales-invoices/${nf.id}/nfe/xml`))}>Baixar XML</Button>}
            {nf.hasXml && <Button size="xs" variant="default" leftSection={<IconFileTypePdf size={16} />} onClick={() => run(() => download(`/sales-invoices/${nf.id}/nfe/danfe`, true))}>DANFE (PDF)</Button>}
            {s === 'autorizada' && <Button size="xs" variant="default" leftSection={<IconPencil size={16} />} onClick={() => { setText(''); setModal('cce') }}>Carta de correção</Button>}
            {s === 'autorizada' && <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={16} />} onClick={() => { setText(''); setModal('cancel') }}>Cancelar na SEFAZ</Button>}
          </Group>
        )}
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb={nf.sefazMessage ? 'sm' : 0}>
        <Fact label="Chave de acesso"><Text size="sm" ff="monospace">{formatKey(nf.accessKey)}</Text></Fact>
        <Fact label="Protocolo"><Text size="sm" ff="monospace">{nf.protocol ?? '—'}</Text></Fact>
        <Fact label="Autorização"><Text size="sm">{nf.authorizedAt ? dateTime(nf.authorizedAt) : '—'}</Text></Fact>
      </SimpleGrid>
      {nf.sefazMessage && ['rejeitada', 'erro', 'denegada'].includes(s) && (
        <Alert color={s === 'erro' ? 'yellow' : 'red'} icon={<IconAlertTriangle size={18} />} title={nf.sefazCode ? `Código ${nf.sefazCode}` : 'Atenção'}>{nf.sefazMessage}</Alert>
      )}
      {s === 'autorizada' && nf.sefazMessage && <Text size="xs" c="dimmed">{nf.sefazCode} · {nf.sefazMessage}</Text>}

      {nf.nfeEvents?.length > 0 && (
        <Table.ScrollContainer minWidth={640} mt="sm">
          <Table fz="xs" verticalSpacing={4}>
            <Table.Thead><Table.Tr><Table.Th>Quando</Table.Th><Table.Th>Evento</Table.Th><Table.Th>Código</Table.Th><Table.Th>Retorno</Table.Th><Table.Th>Protocolo</Table.Th><Table.Th>Usuário</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {nf.nfeEvents.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.createdAt)}</Table.Td>
                  <Table.Td>{EVENTS[e.type] ?? e.type}{e.sequence && e.type === 'cce' ? ` nº ${e.sequence}` : ''}{e.environment === 'homologacao' && <Text span inherit c="yellow.8"> · homolog.</Text>}</Table.Td>
                  <Table.Td>{e.success ? <IconCircleCheck size={14} color="var(--mantine-color-teal-6)" /> : null} {e.statusCode ?? '—'}</Table.Td>
                  <Table.Td>{e.message ?? '—'}{e.text && <Text size="xs" c="dimmed">{e.text}</Text>}</Table.Td>
                  <Table.Td ff="monospace">{e.protocol ?? '—'}</Table.Td>
                  <Table.Td>{e.userName ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={!!validation} onClose={() => setValidation(null)} title="XML da NF-e">
        {validation && (
          <Stack>
            <Text size="sm">Chave <Text span ff="monospace">{formatKey(validation.accessKey)}</Text></Text>
            {validation.valid
              ? <Alert color="teal" icon={<IconCircleCheck size={18} />}>XML assinado e válido no esquema oficial (XSD 4.00). Pronto para transmitir.</Alert>
              : <Alert color="red" title="O XML não passou no esquema (XSD)"><List size="sm">{validation.errors.map((e, i) => <List.Item key={i}>{e}</List.Item>)}</List></Alert>}
            {validation.warnings.map((w, i) => <Alert key={i} color="yellow">{w}</Alert>)}
          </Stack>
        )}
      </Modal>

      <Modal opened={confirming} onClose={() => setConfirming(false)} title={prod ? 'Transmitir em PRODUÇÃO' : 'Transmitir à SEFAZ (homologação)'}>
        <Stack>
          {s === 'erro' && <Text size="sm">A última tentativa falhou. Primeiro a chave é consultada na SEFAZ; a nota só é reenviada (com a mesma chave) se a SEFAZ não a tiver.</Text>}
          {prod ? (
            <>
              <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Nota com valor fiscal">
                Autorizada em produção, a NF-e {nf.number}/{nf.series} de {nf.customerName} passa a valer e só sai por cancelamento (prazo de 24 h) ou carta de correção.
              </Alert>
              <TextInput label={`Para confirmar, digite o número da nota (${nf.number})`} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
            </>
          ) : <Text size="sm">Ambiente de homologação: a nota vai com “SEM VALOR FISCAL” no destinatário e no 1º item.</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>Voltar</Button>
            <Button color={prod ? 'red' : undefined} onClick={transmit} loading={busy} disabled={prod && typed.trim() !== String(nf.number)}>Transmitir</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!modal} onClose={() => setModal(null)} title={modal === 'cancel' ? `Cancelar NF-e ${nf.number}/${nf.series} na SEFAZ` : `Carta de correção da NF-e ${nf.number}/${nf.series}`}>
        <Stack>
          {modal === 'cancel'
            ? <Text size="sm">Homologado o cancelamento, o estoque volta, as parcelas são canceladas e o pedido volta para "a faturar".</Text>
            : <Text size="sm">Não corrige valores, impostos, quantidade, destinatário ou data. Cada nova carta substitui a anterior (até 20).</Text>}
          <Textarea label={modal === 'cancel' ? 'Justificativa' : 'Correção'} description={modal === 'cancel' ? 'De 15 a 255 caracteres' : 'De 15 a 1000 caracteres'}
            value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={3} maxLength={modal === 'cancel' ? 255 : 1000} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModal(null)}>Voltar</Button>
            <Button color={modal === 'cancel' ? 'red' : undefined} onClick={sendEvent} loading={busy} disabled={text.trim().length < 15}>{modal === 'cancel' ? 'Cancelar na SEFAZ' : 'Enviar carta'}</Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}
