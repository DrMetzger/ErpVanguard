import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Select, Stack, Switch, Table, Text, Textarea, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconBan, IconEdit, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { useOptions } from '../lib/catalog'
import { useAction, useApi } from '../lib/hooks'

interface Row { id: string; companyId: string; companyLabel: string; series: number; model: '55' | '65'; nextNumber: number; active: boolean; lastUsed: number | null; updatedBy: string | null; inEspecie: boolean }
interface Voided { id: string; series: number; from: number; to: number; text: string; statusCode: string | null; message: string | null; protocol: string | null; success: boolean; environment: string; createdAt: string; userName: string | null; companyCode: string }
interface Data { especie: string; saleSeries: number; series: { series: number; model: string }[]; rows: Row[] }

const MODEL = { '55': 'NF-e (55)', '65': 'NFC-e (65)' } as Record<string, string>

// Numeração das notas por empresa e série (espécie pelo MV_ESPECIE). Avançar é livre; voltar só para número não usado.
export default function InvoiceNumbering() {
  const { data, reload } = useApi<Data>('/invoice-numbering')
  const companies = useOptions('companies')
  const [editing, setEditing] = useState<Row | null>(null)
  const [next, setNext] = useState<number>(1)
  const [confirmBack, setConfirmBack] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ companyId: null as string | null, series: null as string | null, nextNumber: 1 })
  const { busy, run } = useAction()
  // Inutilização de faixa na SEFAZ (números pulados ou que não serão usados)
  const voided = useApi<Voided[]>('/invoice-numbering/inutilizacoes')
  const [voiding, setVoiding] = useState<Row | null>(null)
  const [range, setRange] = useState({ from: 1, to: 1, reason: '' })

  if (!data) return <Card id="numeracao"><Loading /></Card>
  const open = (r: Row) => { setEditing(r); setNext(r.nextNumber); setConfirmBack(false) }
  const backward = !!editing && next < editing.nextNumber
  const usedAlready = !!editing && backward && editing.lastUsed !== null && next <= editing.lastUsed
  const save = (patch: { nextNumber?: number; active?: boolean; confirmBackward?: boolean }, row: Row) => run(async () => {
    const r = await api<{ warnings: string[] }>(`/invoice-numbering/${row.id}`, { method: 'PUT', body: patch })
    r.warnings.forEach((w) => notifications.show({ color: 'orange', message: w, autoClose: 10000 }))
    setEditing(null)
    await reload()
  }, 'Numeração salva')
  const create = () => run(async () => {
    await api('/invoice-numbering', { method: 'POST', body: { companyId: draft.companyId, series: Number(draft.series), nextNumber: draft.nextNumber } })
    setCreating(false)
    await reload()
  }, 'Série incluída')

  const voidRange = () => run(async () => {
    const r = await api<{ ok: boolean; code: string | null; message: string }>('/invoice-numbering/inutilizar', {
      method: 'POST', body: { companyId: voiding!.companyId, serie: voiding!.series, inicio: range.from, fim: range.to, justificativa: range.reason },
    })
    await voided.reload()
    if (!r.ok) throw new Error(`${r.code ? `[${r.code}] ` : ''}${r.message}`)
    setVoiding(null)
  }, 'Faixa inutilizada na SEFAZ')

  return (
    <Card p={0} id="numeracao">
      <Group justify="space-between" p="md" pb={0}>
        <div>
          <Text fw={700}>Numeração de notas</Text>
          <Text size="xs" c="dimmed">
            Próximo número por empresa e série. A espécie de cada série vem do MV_ESPECIE (<Text span ff="monospace" fz="xs">{data.especie}</Text>);
            o faturamento usa a série {data.saleSeries} (MV_SERNFE). Duas notas nunca recebem o mesmo número.
          </Text>
        </div>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => { setDraft({ companyId: null, series: null, nextNumber: 1 }); setCreating(true) }}>Nova série</Button>
      </Group>
      <Table verticalSpacing="sm" mt="xs">
        <Table.Thead><Table.Tr><Table.Th>Empresa</Table.Th><Table.Th>Série</Table.Th><Table.Th>Espécie</Table.Th><Table.Th ta="right">Última emitida</Table.Th><Table.Th ta="right">Próximo número</Table.Th><Table.Th>Ativa</Table.Th><Table.Th w={80} /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {data.rows.length === 0 && <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">Cadastre a empresa em Administração › Empresas.</Text></Table.Td></Table.Tr>}
          {data.rows.map((r) => (
            <Table.Tr key={r.id} opacity={r.active ? 1 : 0.5}>
              <Table.Td>{r.companyLabel}</Table.Td>
              <Table.Td ff="monospace">{r.series}{r.series === data.saleSeries && <Badge ml="xs" size="xs" variant="light">venda</Badge>}</Table.Td>
              <Table.Td>{MODEL[r.model]}{!r.inEspecie && <Tooltip label="Série fora do MV_ESPECIE (ou com outra espécie)"><Badge ml="xs" size="xs" color="orange">MV_ESPECIE</Badge></Tooltip>}</Table.Td>
              <Table.Td ta="right">{r.lastUsed ?? '—'}</Table.Td>
              <Table.Td ta="right" fw={700}>{r.nextNumber}</Table.Td>
              <Table.Td><Switch size="xs" checked={r.active} onChange={(e) => save({ active: e.currentTarget.checked }, r)} aria-label={`Série ${r.series} ativa`} /></Table.Td>
              <Table.Td>
                <Group gap={2} wrap="nowrap">
                  <Tooltip label="Alterar próximo número"><ActionIcon variant="subtle" onClick={() => open(r)} aria-label={`Alterar numeração da série ${r.series}`}><IconEdit size={16} /></ActionIcon></Tooltip>
                  {r.model === '55' && <Tooltip label="Inutilizar faixa na SEFAZ"><ActionIcon variant="subtle" color="orange" onClick={() => { setVoiding(r); setRange({ from: r.nextNumber, to: r.nextNumber, reason: '' }) }} aria-label={`Inutilizar faixa da série ${r.series}`}><IconBan size={16} /></ActionIcon></Tooltip>}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={!!editing} onClose={() => setEditing(null)} title={editing ? `Série ${editing.series} · ${editing.companyLabel}` : ''}>
        {editing && (
          <Stack>
            <Text size="sm">Última nota emitida: <b>{editing.lastUsed ?? 'nenhuma'}</b>. Próximo número atual: <b>{editing.nextNumber}</b>.</Text>
            <NumberInput label="Próximo número" value={next} onChange={(v) => { setNext(Number(v) || 1); setConfirmBack(false) }} min={1} max={999999999} allowDecimal={false} data-autofocus />
            {next > editing.nextNumber + 1 && <Alert color="orange" icon={<IconAlertTriangle size={16} />}>Os números {editing.nextNumber} a {next - 1} vão ficar sem nota e precisam ser inutilizados na SEFAZ.</Alert>}
            {usedAlready && <Alert color="red" icon={<IconAlertTriangle size={16} />}>A nota {editing.lastUsed} já foi emitida nesta série: o próximo número tem de ser maior que {editing.lastUsed}.</Alert>}
            {backward && !usedAlready && (
              <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Voltar a numeração">
                <Text size="sm">Só é permitido porque nenhum número a partir de {next} foi usado. Confira se nenhuma nota com esses números foi transmitida por outro sistema.</Text>
                <Checkbox mt="xs" label="Entendi, quero voltar a numeração" checked={confirmBack} onChange={(e) => setConfirmBack(e.currentTarget.checked)} />
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>Voltar</Button>
              <Button loading={busy} disabled={next === editing.nextNumber || usedAlready || (backward && !confirmBack)} onClick={() => save({ nextNumber: next, confirmBackward: backward || undefined }, editing)}>Salvar</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {!!voided.data?.length && (
        <Stack gap={4} p="md" pt="xs">
          <Text size="sm" fw={600}>Inutilizações</Text>
          <Table fz="xs" verticalSpacing={4}>
            <Table.Thead><Table.Tr><Table.Th>Quando</Table.Th><Table.Th>Empresa</Table.Th><Table.Th>Série</Table.Th><Table.Th>Faixa</Table.Th><Table.Th>Retorno</Table.Th><Table.Th>Protocolo</Table.Th><Table.Th>Usuário</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {voided.data.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td>{new Date(v.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</Table.Td>
                  <Table.Td>{v.companyCode}</Table.Td><Table.Td>{v.series}</Table.Td><Table.Td>{v.from}–{v.to}</Table.Td>
                  <Table.Td><Badge size="xs" color={v.success ? 'teal' : 'red'} variant="light">{v.statusCode ?? 'erro'}</Badge> {v.message}{v.environment === 'homologacao' && <Text span inherit c="yellow.8"> · homologação</Text>}</Table.Td>
                  <Table.Td ff="monospace">{v.protocol ?? '—'}</Table.Td><Table.Td>{v.userName ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}

      <Modal opened={!!voiding} onClose={() => setVoiding(null)} title={voiding ? `Inutilizar faixa · série ${voiding.series} · ${voiding.companyLabel}` : ''}>
        {voiding && (
          <Stack>
            <Text size="sm">Avisa a SEFAZ que estes números não serão usados (ex.: pulados ao avançar a numeração). Não vale para número já transmitido.</Text>
            <Group grow>
              <NumberInput label="Do número" value={range.from} onChange={(v) => setRange({ ...range, from: Number(v) || 1 })} min={1} max={999999999} allowDecimal={false} />
              <NumberInput label="Até o número" value={range.to} onChange={(v) => setRange({ ...range, to: Number(v) || 1 })} min={1} max={999999999} allowDecimal={false} />
            </Group>
            <Textarea label="Justificativa" description="De 15 a 255 caracteres" value={range.reason} onChange={(e) => setRange({ ...range, reason: e.currentTarget.value })} autosize minRows={2} maxLength={255} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setVoiding(null)}>Voltar</Button>
              <Button color="orange" onClick={voidRange} loading={busy} disabled={range.reason.trim().length < 15 || range.to < range.from}>Inutilizar na SEFAZ</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={creating} onClose={() => setCreating(false)} title="Nova série">
        <Stack>
          <Select label="Empresa" data={companies} value={draft.companyId} onChange={(v) => setDraft({ ...draft, companyId: v })} required />
          <Select label="Série (do MV_ESPECIE)" data={data.series.map((s) => ({ value: String(s.series), label: `${s.series} · ${MODEL[s.model]}` }))} value={draft.series} onChange={(v) => setDraft({ ...draft, series: v })} required
            nothingFoundMessage="Inclua a série no parâmetro MV_ESPECIE" />
          <NumberInput label="Próximo número" value={draft.nextNumber} onChange={(v) => setDraft({ ...draft, nextNumber: Number(v) || 1 })} min={1} allowDecimal={false} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreating(false)}>Voltar</Button>
            <Button onClick={create} loading={busy} disabled={!draft.companyId || !draft.series}>Incluir</Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}
