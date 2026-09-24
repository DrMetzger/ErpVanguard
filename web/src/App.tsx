import { Center, Loader } from '@mantine/core'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { useAuth } from './lib/auth'
import { modules } from './modules'
const Account = lazy(() => import('./pages/Account'))
const Compras = lazy(() => import('./pages/compras'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
import Login from './pages/Login'
const ModuleSoon = lazy(() => import('./pages/ModuleSoon'))
const Products = lazy(() => import('./pages/Products'))
const Users = lazy(() => import('./pages/Users'))

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <Center h="100vh"><Loader type="dots" /></Center>
  if (!user) return <Login />

  return (
    <Suspense fallback={<Center h="60vh"><Loader type="dots" /></Center>}>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="estoque" element={<Products />} />
        <Route path="compras/*" element={<Compras />} />
        <Route path="minha-conta" element={<Account />} />
        {user.role === 'admin' && <Route path="usuarios" element={<Users />} />}
        {modules.filter((m) => m.soon).map((m) => <Route key={m.path} path={m.path.slice(1)} element={<ModuleSoon module={m} />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
