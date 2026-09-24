import { ActionIcon, Badge, Button, Card, Checkbox, Group, Modal, PasswordInput, SegmentedControl, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconEdit, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import { UserAvatar } from '../components/UserAvatar'
import { useAction, useApi } from '../lib/hooks'
import type { Permission, User } from '../lib/types'

const PERMS: [Permission, string, string][] = [
  ['solicitante', 'Solicitante', 'Abre solicitações de compra'],
  ['comprador', 'Comprador', 'Cotações, pedidos, fornecedores e notas'],
  ['aprovador', 'Aprovador', 'Aprova pedidos na sua alçada'],
  ['cadastro', 'Cadastros', 'Produtos, clientes, grupos, unidades, NCM, tabelas de preço'],
  ['fiscal', 'Fiscal', 'CFOP, TES, tipos de operação e matriz fiscal'],
]

export default function Users() {
  const me = useUser()
  const { data: users, reload } = useApi<User[]>('/users')
  const [editing, setEditing] = useState<Partial<User> | null>(null)

  return (
    <>
      <PageHeader title="Usuários" description="Quem acessa o sistema e o que cada um pode fazer." actions={<Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo usuário</Button>} />
      <Card p={0}>
        {!users ? <Loading /> : (
          <Table.ScrollContainer minWidth={700}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Usuário</Table.Th><Table.Th>Perfis</Table.Th><Table.Th>Situação</Table.Th><Table.Th w={60} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {users.map((u) => (
                  <Table.Tr key={u.id} opacity={u.active ? 1 : 0.5}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <UserAvatar name={u.name} avatar={u.avatar} />
                        <div><Text size="sm" fw={600}>{u.name}{u.id === me.id && <Text span c="dimmed" size="xs"> (você)</Text>}</Text><Text size="xs" c="dimmed">{u.email}</Text></div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>{u.role === 'admin' ? <Badge variant="light">Administrador</Badge> : u.permissions.map((p) => <Badge key={p} variant="light" color="gray" tt="capitalize">{p}</Badge>)}</Group>
                    </Table.Td>
                    <Table.Td><Badge variant="dot" color={u.active ? 'teal' : 'gray'} style={{ textTransform: 'none' }}>{u.active ? 'Ativo' : 'Inativo'}</Badge></Table.Td>
                    <Table.Td><Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditing(u)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function UserForm({ user, onClose, onSaved }: { user: Partial<User>; onClose: () => void; onSaved: () => void }) {
  const isNew = !user.id
  const [form, setForm] = useState({
    name: user.name ?? '', email: user.email ?? '', password: '', role: user.role ?? 'user',
    permissions: (user.permissions ?? ['solicitante']) as string[], active: user.active ?? true,
  })
  const { busy, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { name: form.name, role: form.role, permissions: form.permissions }
    run(() => (isNew
      ? api('/users', { method: 'POST', body: { ...body, email: form.email, password: form.password } })
      : api(`/users/${user.id}`, { method: 'PATCH', body: { ...body, active: form.active, ...(form.password ? { password: form.password } : {}) } })
    ).then(onSaved), 'Usuário salvo')
  }

  return (
    <Modal opened onClose={onClose} title={isNew ? 'Novo usuário' : 'Editar usuário'} size="lg">
      <Stack component="form" onSubmit={submit}>
        <TextInput label="Nome" required data-autofocus value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        <TextInput label="E-mail" type="email" required disabled={!isNew} value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
        <PasswordInput label={isNew ? 'Senha inicial' : 'Nova senha'} description={isNew ? 'Pelo menos 8 caracteres' : 'Deixe vazio para manter a atual'} required={isNew} minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
        <div>
          <Text size="sm" fw={500} mb={6}>Tipo de acesso</Text>
          <SegmentedControl fullWidth value={form.role} onChange={(v) => setForm({ ...form, role: v as User['role'] })} data={[{ value: 'user', label: 'Usuário' }, { value: 'admin', label: 'Administrador' }]} />
        </div>
        {form.role === 'user' ? (
          <Checkbox.Group label="Perfis" value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })}>
            <Stack gap="xs" mt="xs">{PERMS.map(([key, label, hint]) => <Checkbox key={key} value={key} label={label} description={hint} />)}</Stack>
          </Checkbox.Group>
        ) : <Text size="sm" c="dimmed">Administrador tem todos os perfis e configura grupos, alçadas e usuários.</Text>}
        {!isNew && <Switch label="Usuário ativo" checked={form.active} onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })} />}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}
