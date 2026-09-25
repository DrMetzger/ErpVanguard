import { ActionIcon, Alert, Anchor, Badge, Button, Card, Drawer, Group, Menu, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconArrowBackUp, IconCash, IconDots, IconEdit, IconPlus, IconSearch, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Money } from '../../components/inputs'
import { Empty, Loading, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useOptions } from '../../lib/catalog'
import { date, money } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { Summary, Title } from './types'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
// Títulos de crédito: abatem o saldo do lado em que estão.
const CREDIT: Record<string, [string, string] | undefined> = {
  NCC: ['Crédito do cliente', 'Devolução de venda: você deve ao cliente. Abate o que ele deve ou é devolvido em dinheiro (a baixa é uma saída).'],
  NDF: ['Débito do fornecedor', 'Devolução de compra: o fornecedor deve a você. Abate o que você deve a ele ou é recebido em dinheiro (a baixa é uma entrada).'],
}
const STATUS = [{ value: 'aberto', label: 'Em aberto' }, { value: 'vencido', label: 'Vencidos' }, { value: 'pago', label: 'Pagos' }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }]

function Tile({ label, value, tone }: { label: string; value: number | undefined; tone?: 'red' }) {
  return (
    <Card>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text fw={800} fz={24} mt={4} c={tone === 'red' && value ? 'red' : undefined}>{value === undefined ? '—' : money(value)}</Text>
    </Card>
  )
}

// Contas a receber (R) ou a pagar (P).
export default function Titles({ kind }: { kind: 'R' | 'P' }) {
  const [status, setStatus] = useState('aberto')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const params = new URLSearchParams({ kind, status, ...(from && { from }), ...(to && { to }), ...(q && { q }) })
  const { data, loading, reload } = useApi<Title[]>(`/finance/titles?${params}`)
  const { data: summary, reload: reloadSummary } = useApi<Summary>('/finance/summary')
  const [paying, setPaying] = useState<Title | null>(null)
  const [viewing, setViewing] = useState<Title | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Title | null>(null)
  const { run } = useAction()
  const refresh = () => { reload(); reloadSummary() }
  const R = kind === 'R'
  const total = data?.reduce((s, t) => s + t.balance, 0) ?? 0

  const cancel = (t: Title) => confirm(`Cancelar "${t.description}"?`) && run(() => api(`/finance/titles/${t.id}/cancel`, { method: 'POST' }).then(refresh), 'Título cancelado')
  const open = (t: Title) => run(async () => setViewing(await api<Title>(`/finance/titles/${t.id}`)))

  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} mb="md">
        <Tile label={R ? 'A receber em aberto' : 'A pagar em aberto'} value={summary?.[R ? 'receivable' : 'payable']} />
        <Tile label="Vencido" value={summary?.[R ? 'receivableOverdue' : 'payableOverdue']} tone="red" />
        <Tile label="Próximos 7 dias" value={summary?.[R ? 'receivableWeek' : 'payableWeek']} />
        <Tile label="Saldo em bancos e caixa" value={summary?.cash} />
      </SimpleGrid>

      <Group mb="md" gap="sm" align="flex-end">
        <SegmentedControl data={STATUS} value={status} onChange={setStatus} />
        <TextInput type="date" label="Vence de" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={150} />
        <TextInput type="date" label="até" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={150} />
        <TextInput label="Buscar" placeholder={R ? 'Cliente, descrição, documento' : 'Fornecedor, descrição, documento'} leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={260} />
        <Button ml="auto" leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>{R ? 'Nova conta a receber' : 'Nova conta a pagar'}</Button>
      </Group>

      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={980}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr><Table.Th>Vencimento</Table.Th><Table.Th>{R ? 'Cliente' : 'Fornecedor'}</Table.Th><Table.Th>Descrição</Table.Th><Table.Th>Parcela</Table.Th><Table.Th>Categoria</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th ta="right">Saldo</Table.Th><Table.Th>Situação</Table.Th><Table.Th w={110} /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>{date(t.dueDate)}{t.daysOverdue > 0 && <Text size="xs" c="red">{t.daysOverdue} dia(s) em atraso</Text>}</Table.Td>
                    <Table.Td>{t.partner ?? <Text span c="dimmed">—</Text>}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap"><Anchor component="button" size="sm" onClick={() => open(t)}>{t.description}</Anchor>{CREDIT[t.docType] && <Tooltip label={CREDIT[t.docType]![1]}><Badge size="sm" color="orange" variant="light" radius="sm">{t.docType}</Badge></Tooltip>}</Group>
                      {t.document && <Text size="xs" c="dimmed">{t.document}</Text>}
                    </Table.Td>
                    <Table.Td>{t.installment}/{t.installments}</Table.Td>
                    <Table.Td><Text size="sm">{t.category ?? '—'}</Text></Table.Td>
                    <Table.Td ta="right">{money(t.amount)}</Table.Td>
                    <Table.Td ta="right" fw={600} c={CREDIT[t.docType] ? 'orange' : undefined}>{CREDIT[t.docType] ? '− ' : ''}{money(t.balance)}</Table.Td>
                    <Table.Td>{t.daysOverdue > 0 ? <Status value="vencido" /> : <Status value={t.status} />}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {['aberto', 'parcial'].includes(t.status) && <Button size="compact-sm" variant="light" leftSection={<IconCash size={14} />} onClick={() => setPaying(t)}>{CREDIT[t.docType] ? 'Baixar' : R ? 'Receber' : 'Pagar'}</Button>}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" aria-label="Mais ações"><IconDots size={16} /></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => open(t)}>Detalhes e baixas</Menu.Item>
                            {['aberto', 'parcial'].includes(t.status) && <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(t)}>Alterar vencimento</Menu.Item>}
                            {t.status === 'aberto' && !t.salesInvoiceId && <Menu.Item color="red" leftSection={<IconX size={14} />} onClick={() => cancel(t)}>Cancelar título</Menu.Item>}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>Nada por aqui.</Empty>}
        {!!data?.length && <Group justify="flex-end" p="sm"><Text size="sm" c="dimmed">{data.length} título(s) · saldo <Text span fw={700} c="var(--mantine-color-text)">{money(total)}</Text></Text></Group>}
      </Card>

      {paying && <PayModal title={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refresh() }} />}
      {creating && <NewTitleModal kind={kind} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh() }} />}
      {editing && <DueDateModal title={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh() }} />}
      <TitleDrawer title={viewing} onClose={() => setViewing(null)} onChange={(t) => { setViewing(t); refresh() }} />
    </>
  )
}

function PayModal({ title, onClose, onDone }: { title: Title; onClose: () => void; onDone: () => void }) {
  const accounts = useOptions('bank-accounts')
  const [form, setForm] = useState({ bankAccountId: null as string | null, paidAt: today(), amount: title.balance, discount: 0, interest: 0, notes: '' })
  const { busy, run } = useAction()
  const R = (title.kind === 'R') !== !!CREDIT[title.docType]
  const settles = Math.round(((form.amount || 0) + (form.discount || 0) - (form.interest || 0)) * 100) / 100
  const submit = () => run(async () => { await api(`/finance/titles/${title.id}/pay`, { method: 'POST', body: { ...form, notes: form.notes || undefined } }); onDone() }, R ? 'Recebimento baixado' : 'Pagamento baixado')
  return (
    <Modal opened onClose={onClose} title={`${R ? 'Receber' : 'Pagar'} · ${title.description}`} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">{title.partner} · parcela {title.installment}/{title.installments} · vence {date(title.dueDate)} · saldo <b>{money(title.balance)}</b></Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label={R ? 'Entrou em' : 'Saiu de'} data={accounts} value={form.bankAccountId} onChange={(v) => setForm({ ...form, bankAccountId: v })} required nothingFoundMessage="Cadastre em Bancos e caixa" />
          <TextInput type="date" label="Data" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.currentTarget.value })} required />
          <Money label={R ? 'Valor recebido' : 'Valor pago'} value={form.amount} onChange={(v) => setForm({ ...form, amount: Number(v) || 0 })} decimalScale={2} required />
          <Money label="Desconto concedido" value={form.discount} onChange={(v) => setForm({ ...form, discount: Number(v) || 0 })} decimalScale={2} />
          <Money label="Juros / multa" value={form.interest} onChange={(v) => setForm({ ...form, interest: Number(v) || 0 })} decimalScale={2} />
          <TextInput label="Observação" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
        </SimpleGrid>
        <Alert variant="light" color={settles > title.balance + 0.005 ? 'red' : settles >= title.balance - 0.005 ? 'teal' : 'blue'}>
          Abate {money(settles)} do título{settles >= title.balance - 0.005 && settles <= title.balance + 0.005 ? ' e quita.' : settles > title.balance ? ' (passa do saldo).' : `; fica faltando ${money(title.balance - settles)}.`}
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={!form.bankAccountId || !form.paidAt || form.amount <= 0}>Confirmar baixa</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function NewTitleModal({ kind, onClose, onDone }: { kind: 'R' | 'P'; onClose: () => void; onDone: () => void }) {
  const R = kind === 'R'
  const partners = useOptions(R ? 'customers' : 'suppliers')
  const categories = useOptions('finance-categories')
  const [form, setForm] = useState({ partnerId: null as string | null, categoryId: null as string | null, description: '', document: '', dueDate: today(), amount: 0, installments: 1, mode: 'dividir', notes: '' })
  const { busy, run } = useAction()
  const submit = () => run(async () => {
    await api('/finance/titles', {
      method: 'POST',
      body: {
        kind, [R ? 'customerId' : 'supplierId']: form.partnerId || undefined, categoryId: form.categoryId || undefined, description: form.description,
        document: form.document || undefined, dueDate: form.dueDate, amount: form.amount, installments: form.installments, mode: form.mode, notes: form.notes || undefined,
      },
    })
    onDone()
  }, 'Título lançado')
  const cats = categories.filter((c) => c.label.startsWith(R ? '1.' : '2.'))
  return (
    <Modal opened onClose={onClose} title={R ? 'Nova conta a receber' : 'Nova conta a pagar'} size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label={R ? 'Cliente' : 'Fornecedor'} data={partners} value={form.partnerId} onChange={(v) => setForm({ ...form, partnerId: v })} searchable clearable />
          <Select label="Categoria (plano de contas)" data={cats.length ? cats : categories} value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} searchable clearable />
          <TextInput label="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} required />
          <TextInput label="Documento" placeholder="Nº do boleto, nota, contrato…" value={form.document} onChange={(e) => setForm({ ...form, document: e.currentTarget.value })} />
          <TextInput type="date" label="Primeiro vencimento" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.currentTarget.value })} required />
          <Money label="Valor" value={form.amount} onChange={(v) => setForm({ ...form, amount: Number(v) || 0 })} decimalScale={2} required />
          <NumberInput label="Parcelas (mensais)" value={form.installments} onChange={(v) => setForm({ ...form, installments: Math.max(1, Math.min(60, Number(v) || 1)) })} min={1} max={60} />
          {form.installments > 1 && (
            <div>
              <Text size="sm" fw={500} mb={4}>O valor é</Text>
              <SegmentedControl fullWidth data={[{ value: 'dividir', label: 'Total (divide)' }, { value: 'repetir', label: 'De cada parcela' }]} value={form.mode} onChange={(v) => setForm({ ...form, mode: v })} />
            </div>
          )}
        </SimpleGrid>
        <Textarea label="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} autosize />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={form.description.trim().length < 2 || form.amount <= 0 || !form.dueDate}>Lançar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function DueDateModal({ title, onClose, onDone }: { title: Title; onClose: () => void; onDone: () => void }) {
  const [dueDate, setDueDate] = useState(title.dueDate)
  const { busy, run } = useAction()
  return (
    <Modal opened onClose={onClose} title="Alterar vencimento">
      <Stack>
        <Text size="sm">{title.description} · {money(title.balance)}</Text>
        <TextInput type="date" label="Novo vencimento" value={dueDate} onChange={(e) => setDueDate(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={() => run(async () => { await api(`/finance/titles/${title.id}`, { method: 'PATCH', body: { dueDate } }); onDone() }, 'Vencimento alterado')}>Salvar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function TitleDrawer({ title, onClose, onChange }: { title: Title | null; onClose: () => void; onChange: (t: Title) => void }) {
  const { run } = useAction()
  const undo = (id: string) => confirm('Estornar esta baixa?') && run(async () => onChange(await api<Title>(`/finance/payments/${id}`, { method: 'DELETE' })), 'Baixa estornada')
  return (
    <Drawer opened={!!title} onClose={onClose} position="right" size="lg" title={title?.description}>
      {title && (
        <Stack>
          <Group gap="xs"><Status value={title.daysOverdue > 0 ? 'vencido' : title.status} /><Badge variant="light" color="gray" radius="sm">{title.kind === 'R' ? 'A receber' : 'A pagar'}</Badge></Group>
          <SimpleGrid cols={2}>
            <div><Text size="xs" c="dimmed">{title.kind === 'R' ? 'Cliente' : 'Fornecedor'}</Text><Text size="sm">{title.partner ?? '—'}</Text></div>
            <div><Text size="xs" c="dimmed">Categoria</Text><Text size="sm">{title.category ?? '—'}</Text></div>
            <div><Text size="xs" c="dimmed">Emissão · vencimento</Text><Text size="sm">{date(title.issueDate)} · {date(title.dueDate)}</Text></div>
            <div><Text size="xs" c="dimmed">Parcela</Text><Text size="sm">{title.installment}/{title.installments}</Text></div>
            <div><Text size="xs" c="dimmed">Valor · saldo</Text><Text size="sm" fw={600}>{money(title.amount)} · {money(title.balance)}</Text></div>
            <div><Text size="xs" c="dimmed">Origem</Text>
              {title.salesInvoiceId ? <Anchor component={Link} to={`/faturamento/notas/${title.salesInvoiceId}`} size="sm">{title.document}</Anchor>
                : title.invoiceId ? <Anchor component={Link} to={`/compras/notas/${title.invoiceId}`} size="sm">{title.document}</Anchor>
                : <Text size="sm">{title.document ?? 'Lançamento manual'}</Text>}
            </div>
          </SimpleGrid>
          {title.notes && <Alert variant="light">{title.notes}</Alert>}
          <Text fw={700} mt="sm">Baixas</Text>
          {title.payments?.length ? (
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Data</Table.Th><Table.Th>Conta</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th ta="right">Desc./juros</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {title.payments.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{date(p.paidAt)}</Table.Td><Table.Td><Text size="sm">{p.bankAccount}</Text><Text size="xs" c="dimmed">{p.userName}</Text></Table.Td>
                    <Table.Td ta="right">{money(p.amount)}</Table.Td><Table.Td ta="right"><Text size="xs">−{money(p.discount)} / +{money(p.interest)}</Text></Table.Td>
                    <Table.Td><ActionIcon variant="subtle" color="red" onClick={() => undo(p.id)} aria-label="Estornar baixa"><IconArrowBackUp size={16} /></ActionIcon></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text size="sm" c="dimmed">Nenhuma baixa ainda.</Text>}
        </Stack>
      )}
    </Drawer>
  )
}
