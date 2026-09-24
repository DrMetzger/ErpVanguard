import { ActionIcon, Badge, Button, Card, Checkbox, Fieldset, Group, Modal, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Timeline, Title, Tooltip } from '@mantine/core'
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Money } from '../../components/inputs'
import { Empty } from '../../components/ui'
import { api } from '../../lib/api'
import { money, toNumber } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { ApprovalGroup, Permission, PurchaseGroup, User } from '../../lib/types'

// Seleção de usuários com um perfil (admin sempre aparece).
function UserChecks({ users, value, onChange, filter }: { users: User[] | null; value: string[]; onChange: (v: string[]) => void; filter: Permission }) {
  const list = users?.filter((u) => u.active && (u.role === 'admin' || u.permissions.includes(filter))) ?? []
  if (!list.length) return <Text size="sm" c="dimmed">Nenhum usuário com o perfil "{filter}". Cadastre em Usuários.</Text>
  return (
    <Checkbox.Group value={value} onChange={onChange}>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{list.map((u) => <Checkbox key={u.id} value={u.id} label={u.name} />)}</SimpleGrid>
    </Checkbox.Group>
  )
}

export default function Settings() {
  const groups = useApi<PurchaseGroup[]>('/purchase-groups')
  const approvals = useApi<ApprovalGroup[]>('/approval-groups')
  const users = useApi<User[]>('/users')
  const [editGroup, setEditGroup] = useState<Partial<PurchaseGroup> | null>(null)
  const [editApproval, setEditApproval] = useState<Partial<ApprovalGroup> | null>(null)

  return (
    <Stack gap={40}>
      <section>
        <Group justify="space-between" align="flex-end" mb="md">
          <div>
            <Title order={4}>Grupos de compras</Title>
            <Text size="sm" c="dimmed">Cada solicitação vai para um grupo; os compradores do grupo fazem a cotação e o pedido.</Text>
          </div>
          <Button leftSection={<IconPlus size={18} />} onClick={() => setEditGroup({})}>Novo grupo</Button>
        </Group>
        <Card p={0}>
          <Table.ScrollContainer minWidth={640}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Grupo</Table.Th><Table.Th>Compradores</Table.Th><Table.Th>Aprovação</Table.Th><Table.Th w={60} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {groups.data?.map((g) => (
                  <Table.Tr key={g.id} opacity={g.active ? 1 : 0.5}>
                    <Table.Td fw={600}>{g.name}</Table.Td>
                    <Table.Td>{g.buyers.map((b) => b.name).join(', ') || '—'}</Table.Td>
                    <Table.Td>{g.approvalGroupName ? <Badge variant="light" style={{ textTransform: 'none' }}>{g.approvalGroupName}</Badge> : <Text size="sm" c="dimmed">Sem alçada (pedido já nasce aprovado)</Text>}</Table.Td>
                    <Table.Td><Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditGroup(g)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {groups.data?.length === 0 && <Empty>Crie o primeiro grupo de compras.</Empty>}
        </Card>
      </section>

      <section>
        <Group justify="space-between" align="flex-end" mb="md">
          <div>
            <Title order={4}>Grupos de aprovação (alçadas)</Title>
            <Text size="sm" c="dimmed">O pedido sobe nível a nível até chegar num limite que cubra o valor. Qualquer aprovador do nível pode aprovar.</Text>
          </div>
          <Button leftSection={<IconPlus size={18} />} onClick={() => setEditApproval({})}>Nova alçada</Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {approvals.data?.map((a) => (
            <Card key={a.id}>
              <Group justify="space-between" mb="md">
                <Text fw={700}>{a.name}</Text>
                <Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditApproval(a)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip>
              </Group>
              <Timeline bulletSize={24} lineWidth={2}>
                {a.levels.map((l) => (
                  <Timeline.Item key={l.level} bullet={<Text size="xs" fw={700}>{l.level}</Text>} title={l.limitAmount === null ? 'Sem limite' : `Até ${money(l.limitAmount)}`}>
                    <Text size="xs" c="dimmed">{l.users.map((u) => u.name).join(', ')}</Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          ))}
        </SimpleGrid>
        {approvals.data?.length === 0 && <Card><Empty>Nenhuma alçada cadastrada.</Empty></Card>}
      </section>

      {editGroup && <GroupForm group={editGroup} users={users.data} approvals={approvals.data} onClose={() => setEditGroup(null)} onSaved={() => { setEditGroup(null); groups.reload() }} />}
      {editApproval && <ApprovalForm group={editApproval} users={users.data} onClose={() => setEditApproval(null)} onSaved={() => { setEditApproval(null); approvals.reload(); groups.reload() }} />}
    </Stack>
  )
}

function GroupForm({ group, users, approvals, onClose, onSaved }: { group: Partial<PurchaseGroup>; users: User[] | null; approvals: ApprovalGroup[] | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name ?? '')
  const [approvalGroupId, setApprovalGroupId] = useState<string | null>(group.approvalGroupId ?? null)
  const [buyerIds, setBuyerIds] = useState(group.buyers?.map((b) => b.id) ?? [])
  const [active, setActive] = useState(group.active ?? true)
  const { busy, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => api(group.id ? `/purchase-groups/${group.id}` : '/purchase-groups', { method: group.id ? 'PUT' : 'POST', body: { name, approvalGroupId, buyerIds, active } }).then(onSaved), 'Grupo salvo')
  }
  return (
    <Modal opened onClose={onClose} title={group.id ? 'Editar grupo de compras' : 'Novo grupo de compras'} size="lg">
      <Stack component="form" onSubmit={submit}>
        <TextInput label="Nome" required placeholder="Ex.: Materiais de manutenção" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select label="Alçada de aprovação dos pedidos" placeholder="Sem aprovação" clearable data={approvals?.map((a) => ({ value: a.id, label: a.name })) ?? []} value={approvalGroupId} onChange={setApprovalGroupId} />
        <Fieldset legend="Compradores"><UserChecks users={users} value={buyerIds} onChange={setBuyerIds} filter="comprador" /></Fieldset>
        {group.id && <Switch label="Grupo ativo" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}

function ApprovalForm({ group, users, onClose, onSaved }: { group: Partial<ApprovalGroup>; users: User[] | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name ?? '')
  const [levels, setLevels] = useState<{ limit: number | string; userIds: string[] }[]>(
    group.levels?.map((l) => ({ limit: l.limitAmount ?? '', userIds: l.users.map((u) => u.id) })) ?? [{ limit: '', userIds: [] }],
  )
  const { busy, run } = useAction()
  const update = (i: number, patch: Partial<(typeof levels)[number]>) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { name, levels: levels.map((l, i) => ({ level: i + 1, limitAmount: toNumber(l.limit), userIds: l.userIds })) }
    run(() => api(group.id ? `/approval-groups/${group.id}` : '/approval-groups', { method: group.id ? 'PUT' : 'POST', body }).then(onSaved), 'Alçada salva')
  }
  const remove = () => confirm('Excluir esta alçada?') && run(() => api(`/approval-groups/${group.id}`, { method: 'DELETE' }).then(onSaved), 'Alçada excluída')

  return (
    <Modal opened onClose={onClose} title={group.id ? 'Editar alçada' : 'Nova alçada'} size="xl">
      <Stack component="form" onSubmit={submit}>
        <TextInput label="Nome" required placeholder="Ex.: Alçada padrão" data-autofocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
        {levels.map((l, i) => (
          <Fieldset key={i} legend={`Nível ${i + 1}`}>
            <Group align="flex-end" mb="sm">
              <Money label="Aprova pedidos até" description="Vazio = sem limite" decimalScale={2} placeholder={i === levels.length - 1 ? 'Sem limite' : 'R$ 0,00'} value={l.limit} onChange={(v) => update(i, { limit: v })} style={{ flex: 1 }} />
              {levels.length > 1 && <Tooltip label="Remover nível"><ActionIcon variant="subtle" color="red" size="lg" onClick={() => setLevels(levels.filter((_, j) => j !== i))} aria-label="Remover nível"><IconTrash size={17} /></ActionIcon></Tooltip>}
            </Group>
            <UserChecks users={users} value={l.userIds} onChange={(userIds) => update(i, { userIds })} filter="aprovador" />
          </Fieldset>
        ))}
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setLevels([...levels, { limit: '', userIds: [] }])} w="fit-content">Adicionar nível</Button>
        <Group justify="flex-end">
          {group.id && <Button variant="subtle" color="red" onClick={remove} loading={busy} mr="auto">Excluir alçada</Button>}
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Salvar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
