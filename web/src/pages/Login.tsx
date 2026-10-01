import { Capacitor } from '@capacitor/core'
import { Anchor, Button, Center, Group, Paper, PasswordInput, PinInput, Stack, Text, TextInput, ThemeIcon } from '@mantine/core'
import { IconAt, IconLock, IconBrandAndroid, IconDownload, IconMailCheck } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Logo } from '../components/Logo'
import { useAuth, type LoginChallenge } from '../lib/auth'

export default function Login() {
  const { login, verify } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 2ª etapa obrigatória: código de 6 números enviado ao e-mail do usuário.
  const [step, setStep] = useState<LoginChallenge | null>(null)
  const [code, setCode] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const challenge = await login(email, password)
      if (challenge) { setStep(challenge); setCode('') }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (value = code) => {
    if (!step || value.length !== 6) return
    setError('')
    setBusy(true)
    try {
      await verify(step.challenge, value)
    } catch (err) {
      setError((err as Error).message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const back = () => { setStep(null); setCode(''); setError(''); setPassword('') }

  return (
    <Center className="login-bg" p="md">
      <Stack w="100%" maw={400} gap="md">
      {step ? (
      <Paper component="form" onSubmit={(e: FormEvent) => { e.preventDefault(); void confirm() }} withBorder shadow="xl" p={36} w="100%">
        <Stack gap="md" align="stretch">
          <Center mb="xs"><Logo size={42} /></Center>
          <Center><ThemeIcon size={44} radius="xl" variant="light"><IconMailCheck size={24} /></ThemeIcon></Center>
          <Text ta="center" fw={600}>Confirme que é você</Text>
          <Text c="dimmed" size="sm" ta="center">Mandamos um código de 6 números para <b>{step.sentTo}</b>. Ele vale por {step.minutes} minutos.</Text>
          <Center>
            <PinInput length={6} type="number" oneTimeCode autoFocus size="md" value={code} disabled={busy} error={!!error} aria-label="Código de acesso"
              onChange={setCode} onComplete={(v) => void confirm(v)} />
          </Center>
          {error && <Text c="red" size="sm" ta="center">{error}</Text>}
          <Button type="submit" size="md" variant="gradient" loading={busy} disabled={code.length !== 6} fullWidth>Entrar</Button>
          <Group justify="space-between">
            <Anchor component="button" type="button" size="sm" onClick={back}>Voltar</Anchor>
            <Anchor component="button" type="button" size="sm" onClick={() => { setStep(null); setError(''); void submit({ preventDefault() {} } as FormEvent) }}>Mandar outro código</Anchor>
          </Group>
        </Stack>
      </Paper>
      ) : (
      <Paper component="form" onSubmit={submit} withBorder shadow="xl" p={36} w="100%">
        <Stack gap="md">
          <Center mb="xs"><Logo size={42} /></Center>
          <Text c="dimmed" size="sm" ta="center" mb="xs">Entre para acessar sua empresa</Text>
          <TextInput label="E-mail" type="email" required autoComplete="username" leftSection={<IconAt size={16} />} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label="Senha" required autoComplete="current-password" leftSection={<IconLock size={16} />} value={password} onChange={(e) => setPassword(e.currentTarget.value)} error={error || undefined} />
          <Button type="submit" size="md" variant="gradient" loading={busy} fullWidth mt="xs">Entrar</Button>
        </Stack>
      </Paper>
      )}
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
