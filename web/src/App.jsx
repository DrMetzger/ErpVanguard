import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { modules } from './modules.js'
import Account from './pages/Account.jsx'
import Compras from './pages/compras/index.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Login from './pages/Login.jsx'
import ModuleSoon from './pages/ModuleSoon.jsx'
import Products from './pages/Products.jsx'
import Users from './pages/Users.jsx'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <div className="splash"><img src="/logo.svg" alt="" width="48" height="48" /></div>
  if (!user) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="estoque" element={<Products />} />
        <Route path="compras/*" element={<Compras />} />
        <Route path="minha-conta" element={<Account />} />
        {user.role === 'admin' && <Route path="usuarios" element={<Users />} />}
        {modules.filter((m) => m.soon).map((m) => (
          <Route key={m.path} path={m.path.slice(1)} element={<ModuleSoon module={m} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
