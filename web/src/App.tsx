import { Button, Center, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconLock } from '@tabler/icons-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { useAuth } from './lib/auth'
import { modules } from './modules'
const Account = lazy(() => import('./pages/Account'))
const Compras = lazy(() => import('./pages/compras'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
import Login from './pages/Login'
const ModuleSoon = lazy(() => import('./pages/ModuleSoon'))
const Cadastros = lazy(() => import('./pages/cadastros'))
const Settings = lazy(() => import('./pages/Settings'))
const Customize = lazy(() => import('./pages/Customize'))
const Parameters = lazy(() => import('./pages/Parameters'))
const EmailTemplates = lazy(() => import('./pages/EmailTemplates'))
const Empresas = lazy(() => import('./pages/Empresas'))
const Stock = lazy(() => import('./pages/Stock'))
const Faturamento = lazy(() => import('./pages/faturamento'))
const Financeiro = lazy(() => import('./pages/financeiro'))
const Bi = lazy(() => import('./pages/bi'))
const Users = lazy(() => import('./pages/Users'))
const Devices = lazy(() => import('./pages/Devices'))
const Integrations = lazy(() => import('./pages/Integrations'))

export default function App() {
  const { user, loading, logout } = useAuth()
  const [blocked, setBlocked] = useState<string | null>(null)
  const [accessBlocked, setAccessBlocked] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => { setBlocked((e as CustomEvent<string>).detail); logout() }
    const onAccess = (e: Event) => setAccessBlocked((e as CustomEvent<string>).detail)
    window.addEventListener('vanguard:device-blocked', on)
    window.addEventListener('vanguard:access-blocked', onAccess)
    return () => { window.removeEventListener('vanguard:device-blocked', on); window.removeEventListener('vanguard:access-blocked', onAccess) }
  }, [logout])
  if (accessBlocked) return <BlockedScreen title="Acesso desativado" message={accessBlocked} />
  if (blocked) return <BlockedScreen message={blocked} hint="Fale com o administrador do sistema da sua empresa para liberar este celular." />
  if (loading) return <Center h="100vh"><Loader type="dots" /></Center>
  if (!user) return <Login />

  return (
    <Suspense fallback={<Center h="60vh"><Loader type="dots" /></Center>}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="cadastros/*" element={<Cadastros />} />
        <Route path="estoque" element={<Stock />} />
        <Route path="fiscal/*" element={<FiscalRedirect />} />
        <Route path="compras/*" element={<Compras />} />
        <Route path="faturamento/*" element={<Faturamento />} />
        <Route path="financeiro/*" element={<Financeiro />} />
        <Route path="bi" element={<Bi />} />
        <Route path="minha-conta" element={<Account />} />
        {user.role === 'admin' && <Route path="usuarios" element={<Users />} />}
        {user.role === 'admin' && <Route path="configuracoes" element={<Settings />} />}
        {user.role === 'admin' && <Route path="personalizar" element={<Customize />} />}
        {user.role === 'admin' && <Route path="parametros" element={<Parameters />} />}
        {user.role === 'admin' && <Route path="modelos-email" element={<EmailTemplates />} />}
        {user.role === 'admin' && <Route path="empresas/*" element={<Empresas />} />}
        {user.role === 'admin' && <Route path="dispositivos" element={<Devices />} />}
        {user.role === 'admin' && <Route path="integracoes" element={<Integrations />} />}
        {modules.filter((m) => m.soon).map((m) => <Route key={m.path} path={m.path.slice(1)} element={<ModuleSoon module={m} />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}

// Fiscal agora fica em Cadastros.
function FiscalRedirect() {
  const tab = useParams()['*']
  return <Navigate to={`/cadastros/fiscal/${tab ?? ''}`} replace />
}

// Aparelho bloqueado pelo administrador (Administração › Dispositivos) ou acesso do cliente desativado pela Prime ERP.
function BlockedScreen({ title = 'Aparelho bloqueado', message, hint }: { title?: string; message: string; hint?: string }) {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" maw={420} ta="center">
        <ThemeIcon size={72} radius="xl" color="red" variant="light"><IconLock size={40} /></ThemeIcon>
        <Title order={2}>{title}</Title>
        <Text>{message}</Text>
        {hint && <Text size="sm" c="dimmed">{hint}</Text>}
        <Button variant="default" onClick={() => window.location.reload()}>Tentar de novo</Button>
      </Stack>
    </Center>
  )
}
