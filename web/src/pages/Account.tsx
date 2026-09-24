import { Avatar, Badge, Button, Card, Group, PasswordInput, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import { initials } from '../lib/format'
import { useAction } from '../lib/hooks'

export default function Account() {
  const user = useUser()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const { busy, run } = useAction()
  const mismatch = form.confirm && form.newPassword !== form.confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    const ok = await run(() => api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } }).then(() => true), 'Senha alterada')
    if (ok) setForm({ currentPassword: '', newPassword: '', confirm: '' })
  }

  return (
    <>
      <Title order={2} mb="lg">Meu perfil</Title>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Group>
            <Avatar size={72} radius="xl" variant="gradient">{initials(user.name)}</Avatar>
            <div>
              <Text fw={700} size="xl">{user.name}</Text>
              <Text c="dimmed" size="sm">{user.email}</Text>
            </div>
          </Group>
          <Group gap={6} mt="lg">
            {user.role === 'admin' ? <Badge variant="light">Administrador</Badge> : user.permissions.map((p) => <Badge key={p} variant="light" color="gray" tt="capitalize">{p}</Badge>)}
          </Group>
        </Card>
        <Card component="form" onSubmit={submit}>
          <Title order={4} mb="md">Trocar senha</Title>
          <Stack>
            <PasswordInput label="Senha atual" required autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.currentTarget.value })} />
            <PasswordInput label="Nova senha" description="Pelo menos 8 caracteres" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.currentTarget.value })} />
            <PasswordInput label="Confirme a nova senha" required autoComplete="new-password" value={form.confirm} error={mismatch ? 'Não confere com a nova senha' : undefined} onChange={(e) => setForm({ ...form, confirm: e.currentTarget.value })} />
            <Button type="submit" loading={busy}>Salvar nova senha</Button>
          </Stack>
        </Card>
      </SimpleGrid>
    </>
  )
}
