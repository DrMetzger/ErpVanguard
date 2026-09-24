import { Button, Card, Checkbox, Group, Modal, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Loading, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { date, qty } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { PendingItem, Quotation, QuotationSummary, Supplier } from '../../lib/types'

export default function Quotations() {
  const { data, loading } = useApi<QuotationSummary[]>('/quotations')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      <Group justify="flex-end" mb="md"><Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>Nova cotação</Button></Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Número</Table.Th><Table.Th>Grupo</Table.Th><Table.Th>Comprador</Table.Th><Table.Th ta="right">Itens</Table.Th><Table.Th ta="right">Fornecedores</Table.Th><Table.Th>Prazo</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data?.map((q) => (
                  <Table.Tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/compras/cotacoes/${q.id}`)}>
                    <Table.Td fw={700}>{q.code}</Table.Td>
                    <Table.Td>{q.purchaseGroupName}</Table.Td>
                    <Table.Td>{q.buyerName}</Table.Td>
                    <Table.Td ta="right">{q.itemCount}</Table.Td>
                    <Table.Td ta="right">{q.supplierCount}</Table.Td>
                    <Table.Td>{date(q.deadline)}</Table.Td>
                    <Table.Td><Status value={q.status} /></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>Nenhuma cotação. Clique em "Nova cotação" para cotar os itens das solicitações.</Empty>}
      </Card>
      {creating && <QuotationForm onClose={() => setCreating(false)} onCreated={(q) => navigate(`/compras/cotacoes/${q.id}`)} />}
    </>
  )
}

function QuotationForm({ onClose, onCreated }: { onClose: () => void; onCreated: (q: Quotation) => void }) {
  const pending = useApi<PendingItem[]>('/purchase-requests/pending-items')
  const suppliers = useApi<Supplier[]>('/suppliers')
  const [itemIds, setItemIds] = useState<string[]>([])
  const [supplierIds, setSupplierIds] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const { busy, run } = useAction()
  const groupId = pending.data?.find((i) => itemIds.includes(i.id))?.purchaseGroupId
  const toggle = (id: string) => setItemIds(itemIds.includes(id) ? itemIds.filter((x) => x !== id) : [...itemIds, id])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      if (!itemIds.length) throw new Error('Selecione os itens a cotar')
      if (!supplierIds.length) throw new Error('Selecione pelo menos um fornecedor')
      onCreated(await api<Quotation>('/quotations', { method: 'POST', body: { requestItemIds: itemIds, supplierIds, deadline: deadline || undefined } }))
    })
  }

  return (
    <Modal opened onClose={onClose} title="Nova cotação" size="xl">
      <Stack component="form" onSubmit={submit}>
        <Title order={5}>1. Itens das solicitações</Title>
        <Card p={0} radius="md">
          <Table.ScrollContainer minWidth={600} maxHeight={300}>
            <Table stickyHeader>
              <Table.Thead><Table.Tr><Table.Th w={40} /><Table.Th>Item</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th>Solicitação</Table.Th><Table.Th>Grupo</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {pending.data?.map((i) => {
                  const blocked = !!groupId && i.purchaseGroupId !== groupId
                  return (
                    <Table.Tr key={i.id} opacity={blocked ? 0.4 : 1} style={{ cursor: blocked ? 'not-allowed' : 'pointer' }} onClick={() => !blocked && toggle(i.id)} bg={itemIds.includes(i.id) ? 'var(--mantine-primary-color-light)' : undefined}>
                      <Table.Td><Checkbox checked={itemIds.includes(i.id)} disabled={blocked} readOnly aria-label={i.description} /></Table.Td>
                      <Table.Td>{i.sku && <Text span fw={700}>{i.sku} · </Text>}{i.description}</Table.Td>
                      <Table.Td ta="right">{qty(i.quantity)} {i.unit}</Table.Td>
                      <Table.Td>{i.requestCode} · {i.requesterName}</Table.Td>
                      <Table.Td>{i.purchaseGroupName}</Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {pending.data?.length === 0 && <Empty>Nenhum item pendente de cotação.</Empty>}
        </Card>
        <Title order={5}>2. Fornecedores que vão cotar</Title>
        <Checkbox.Group value={supplierIds} onChange={setSupplierIds}>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
            {suppliers.data?.filter((s) => s.active).map((s) => <Checkbox key={s.id} value={s.id} label={s.name} />)}
          </SimpleGrid>
        </Checkbox.Group>
        {suppliers.data?.length === 0 && <Text size="sm" c="dimmed">Cadastre fornecedores na aba Fornecedores.</Text>}
        <TextInput label="Prazo para resposta" type="date" value={deadline} onChange={(e) => setDeadline(e.currentTarget.value)} maw={220} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Criar cotação ({itemIds.length} itens × {supplierIds.length} fornecedores)</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
