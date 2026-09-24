import { Badge, Button, Card, ColorSwatch, Group, PasswordInput, SegmentedControl, SimpleGrid, Stack, Text, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { ANIMAL_NAMES } from '../components/avatars/vanguard'
import { AVATAR_STYLES, SKIN_TONES, UserAvatar, type AvatarStyle } from '../components/UserAvatar'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useAuth, useUser } from '../lib/auth'
import type { User } from '../lib/types'
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
            <UserAvatar size={72} name={user.name} avatar={user.avatar} />
            <div>
              <Text fw={700} size="xl">{user.name}</Text>
              <Text c="dimmed" size="sm">{user.email}</Text>
            </div>
          </Group>
          <Group gap={6} mt="lg">
            {user.role === 'admin' ? <Badge variant="light">Administrador</Badge> : user.permissions.map((p) => <Badge key={p} variant="light" color="gray" tt="capitalize">{p}</Badge>)}
          </Group>
          <AvatarPicker />
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

// Escolha do avatar: estilo, tom de pele (Pessoas) e 18 variações (dá para sortear outras).
function AvatarPicker() {
  const user = useUser()
  const { refresh } = useAuth()
  const [style, setStyle] = useState<AvatarStyle>(((user.avatar?.split(':')[0] as AvatarStyle) in AVATAR_STYLES ? user.avatar!.split(':')[0] : 'pessoas') as AvatarStyle)
  const [round, setRound] = useState(0)
  const [tone, setTone] = useState(Number(user.avatar?.match(/^pessoas:t(\d)-/)?.[1] ?? 0))
  const { busy, run } = useAction()
  // Bichos: um de cada; Pessoas: 18 variações no tom de pele escolhido.
  const seeds = style === 'bichos'
    ? ANIMAL_NAMES.map((a) => `${a}-${user.id.slice(0, 6)}${round}`)
    : Array.from({ length: 18 }, (_, i) => `t${tone}-${user.id.slice(0, 8)}-${round}-${i}`)
  const choose = (avatar: string | null) => run(async () => { await api<User>('/auth/me', { method: 'PATCH', body: { avatar } }); await refresh() }, 'Avatar atualizado')

  return (
    <Stack mt="xl" gap="sm">
      <Group justify="space-between">
        <Text fw={700}>Avatar</Text>
        <Group gap="xs">
          <Tooltip label="Outras opções"><Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => setRound((r) => r + 1)}>Sortear</Button></Tooltip>
          <Button variant="subtle" size="xs" onClick={() => choose(null)} disabled={!user.avatar || busy}>Usar iniciais</Button>
        </Group>
      </Group>
      <SegmentedControl size="xs" value={style} onChange={(v) => setStyle(v as AvatarStyle)} data={Object.entries(AVATAR_STYLES).map(([value, s]) => ({ value, label: s.label }))} style={{ overflowX: 'auto' }} />
      {style === 'pessoas' && (
        <Group gap="xs">
          <Text size="xs" c="dimmed">Tom de pele</Text>
          {SKIN_TONES.map((t, i) => (
            <Tooltip key={t.value} label={t.label}>
              <ColorSwatch component="button" type="button" color={`#${t.value}`} size={22} onClick={() => setTone(i)} aria-label={`Tom de pele ${t.label}`}
                style={{ cursor: 'pointer', outline: tone === i ? '2px solid var(--mantine-primary-color-filled)' : undefined, outlineOffset: 2 }} />
            </Tooltip>
          ))}
        </Group>
      )}
      <SimpleGrid cols={6} spacing="xs">
        {seeds.map((seed) => {
          const value = `${style}:${seed}`
          return (
            <UnstyledButton key={seed} onClick={() => choose(value)} aria-label="Escolher avatar" className={`avatar-option ${user.avatar === value ? 'selected' : ''}`}>
              <UserAvatar name={user.name} avatar={value} size={60} />
            </UnstyledButton>
          )
        })}
      </SimpleGrid>
      <Text size="xs" c="dimmed">Pessoas usa o Avataaars (livre para uso comercial); Bichos são desenhos do próprio Vanguard. Tudo gerado aqui mesmo, sem enviar seus dados para fora.</Text>
    </Stack>
  )
}
