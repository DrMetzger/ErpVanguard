import { ActionIcon, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { BrNumber } from '../../components/inputs'
import { Empty, Loading, ProductSelect, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { can, date, qty, toNumber } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { Product, PurchaseGroup, PurchaseRequest } from '../../lib/types'

const STATUSES = [
  { value: '', label: 'Todas' }, { value: 'aberta', label: 'Abertas' }, { value: 'em_cotacao', label: 'Em cotação' },
  { value: 'atendida', label: 'Atendidas' }, { value: 'cancelada', label: 'Canceladas' },
]

export default function Requests() {
  const user = useUser()
  const [status, setStatus] = useState('')
  const { data, loading, reload } = useApi<PurchaseRequest[]>(`/purchase-requests${status ? `?status=${status}` : ''}`)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<PurchaseRequest | null>(null)

  return (
    <>
      <Group justify="space-between" mb="md">
        <Select data={STATUSES} value={status} onChange={(v) => setStatus(v ?? '')} allowDeselect={false} w={220} aria-label="Filtrar por situação" />
        {can(user, 'solicitante') && <Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>Nova solicitação</Button>}
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Número</Table.Th><Table.Th>Solicitante</Table.Th><Table.Th>Grupo</Table.Th><Table.Th ta="right">Itens</Table.Th><Table.Th>Necessidade</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data?.map((r) => (
                  <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(r)}>
                    <Table.Td fw={700}>{r.code}</Table.Td>
                    <Table.Td>{r.requesterName}</Table.Td>
                    <Table.Td>{r.purchaseGroupName}</Table.Td>
                    <Table.Td ta="right">{r.items.length}</Table.Td>
                    <Table.Td>{date(r.neededBy)}</Table.Td>
                    <Table.Td><Status value={r.status} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>Nenhuma solicitação.</Empty>}
      </Card>
      {creating && <RequestForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {viewing && <RequestView request={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reload() }} />}
    </>
  )
}

function RequestView({ request, onClose, onChanged }: { request: PurchaseRequest; onClose: () => void; onChanged: () => void }) {
  const user = useUser()
  const { busy, run } = useAction()
  const cancel = () => confirm(`Cancelar a solicitação ${request.code}?`) && run(() => api(`/purchase-requests/${request.id}/cancel`, { method: 'POST' }).then(onChanged), 'Solicitação cancelada')
  const facts: [string, React.ReactNode][] = [
    ['Solicitante', request.requesterName], ['Grupo de compras', request.purchaseGroupName], ['Aberta em', date(request.createdAt)],
    ['Necessidade', date(request.neededBy)], ['Situação', <Status value={request.status} />],
  ]
  return (
    <Modal opened onClose={onClose} title={`Solicitação ${request.code}`} size="xl">
      <SimpleGrid cols={{ base: 2, sm: 5 }} mb="md">
        {facts.map(([label, value]) => <div key={label}><Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text><Text size="sm" component="div">{value}</Text></div>)}
      </SimpleGrid>
      {request.notes && <Card bg="var(--mantine-color-default-hover)" withBorder={false} p="sm" mb="md"><Text size="sm">{request.notes}</Text></Card>}
      <Table.ScrollContainer minWidth={480}>
        <Table>
          <Table.Thead><Table.Tr><Table.Th>Item</Table.Th><Table.Th ta="right">Quantidade</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {request.items.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>{i.sku && <Text span fw={700}>{i.sku} · </Text>}{i.description}</Table.Td>
                <Table.Td ta="right">{qty(i.quantity)} {i.unit}</Table.Td>
                <Table.Td><Status value={i.status} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group justify="flex-end" mt="md">
        {request.status === 'aberta' && (request.requesterId === user.id || user.role === 'admin') && <Button variant="subtle" color="red" onClick={cancel} loading={busy}>Cancelar solicitação</Button>}
        <Button variant="default" onClick={onClose}>Fechar</Button>
      </Group>
    </Modal>
  )
}

interface ItemDraft { product: Product | null; description: string; unit: string; quantity: number | string }
const emptyItem = (): ItemDraft => ({ product: null, description: '', unit: 'UN', quantity: '' })

function RequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const groups = useApi<PurchaseGroup[]>('/purchase-groups')
  const active = groups.data?.filter((g) => g.active) ?? []
  const [groupId, setGroupId] = useState<string | null>(null)
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()])
  const { busy, run } = useAction()
  const update = (i: number, patch: Partial<ItemDraft>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const group = groupId ?? active[0]?.id ?? null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      if (!group) throw new Error('Nenhum grupo de compras cadastrado. Peça ao administrador.')
      const body = {
        purchaseGroupId: group, neededBy: neededBy || undefined, notes: notes || undefined,
        items: items.map((it) => {
          const quantity = toNumber(it.quantity)
          if (!quantity) throw new Error('Informe a quantidade de todos os itens')
          if (!it.product && !it.description.trim()) throw new Error('Escolha um produto ou descreva cada item')
          return it.product ? { productId: it.product.id, quantity } : { description: it.description.trim(), unit: it.unit || 'UN', quantity }
        }),
      }
      await api('/purchase-requests', { method: 'POST', body })
      onSaved()
    }, 'Solicitação enviada')
  }

  return (
    <Modal opened onClose={onClose} title="Nova solicitação de compra" size="xl">
      <Stack component="form" onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Grupo de compras" required data={active.map((g) => ({ value: g.id, label: g.name }))} value={group} onChange={setGroupId} style={{ gridColumn: 'span 2' }} allowDeselect={false} />
          <TextInput label="Preciso até" type="date" value={neededBy} onChange={(e) => setNeededBy(e.currentTarget.value)} />
        </SimpleGrid>
        <Stack gap="sm">
          <Text size="sm" fw={500}>Itens</Text>
          {items.map((it, i) => (
            <Card key={i} p="sm" radius="md" data-item={i}>
              <Group align="flex-start" wrap="nowrap" gap="sm">
                <Stack gap={6} style={{ flex: 1 }}>
                  <ProductSelect value={it.product} onChange={(product) => update(i, { product })} placeholder="Produto do cadastro…" aria-label="Produto" />
                  {!it.product && <TextInput placeholder="…ou descreva o item (sem cadastro)" value={it.description} onChange={(e) => update(i, { description: e.currentTarget.value })} aria-label="Descrição" />}
                </Stack>
                {!it.product && <TextInput placeholder="Un." w={72} maxLength={6} value={it.unit} onChange={(e) => update(i, { unit: e.currentTarget.value })} aria-label="Unidade" />}
                <BrNumber placeholder="Qtd." w={110} decimalScale={4} value={it.quantity} onChange={(v) => update(i, { quantity: v })} aria-label="Quantidade" />
                <Tooltip label="Remover item"><ActionIcon variant="subtle" color="red" size="lg" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remover item"><IconTrash size={17} /></ActionIcon></Tooltip>
              </Group>
            </Card>
          ))}
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setItems([...items, emptyItem()])} w="fit-content">Adicionar item</Button>
        </Stack>
        <Textarea label="Observações" autosize minRows={2} placeholder="Onde vai ser usado, marca preferida, urgência…" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Enviar solicitação</Button></Group>
      </Stack>
    </Modal>
  )
}
