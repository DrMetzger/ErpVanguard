import { Capacitor } from '@capacitor/core'
import { Button, Center, Group, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon } from '@mantine/core'
import { IconAt, IconLock, IconBrandAndroid, IconDownload } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Logo } from '../components/Logo'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Center className="login-bg" p="md">
      <Stack w="100%" maw={400} gap="md">
      <Paper component="form" onSubmit={submit} withBorder shadow="xl" p={36} w="100%">
        <Stack gap="md">
          <Center mb="xs"><Logo size={42} /></Center>
          <Text c="dimmed" size="sm" ta="center" mb="xs">Entre para acessar sua empresa</Text>
          <TextInput label="E-mail" type="email" required autoComplete="username" leftSection={<IconAt size={16} />} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label="Senha" required autoComplete="current-password" leftSection={<IconLock size={16} />} value={password} onChange={(e) => setPassword(e.currentTarget.value)} error={error || undefined} />
          <Button type="submit" size="md" variant="gradient" loading={busy} fullWidth mt="xs">Entrar</Button>
        </Stack>
      </Paper>
      {/* No navegador: convite para instalar o app Android (dentro do app não aparece). */}
      {!Capacitor.isNativePlatform() && (
        <Paper withBorder p="sm" radius="md" component="a" href="/download/" style={{ textDecoration: 'none' }} aria-label="Baixar o app Android">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size={38} radius="md" variant="light" color="teal"><IconBrandAndroid size={22} /></ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={600} c="var(--mantine-color-text)">Baixe o app ERP Vanguard para Android</Text>
              <Text size="xs" c="dimmed">Use no celular, até sem internet</Text>
            </div>
            <IconDownload size={18} />
          </Group>
        </Paper>
      )}
      </Stack>
    </Center>
  )
}
