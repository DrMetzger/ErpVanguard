import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../auth.jsx'
import { can } from '../../ui.jsx'
import Approvals from './Approvals.jsx'
import InvoiceDetail from './InvoiceDetail.jsx'
import Invoices from './Invoices.jsx'
import OrderDetail from './OrderDetail.jsx'
import Orders from './Orders.jsx'
import QuotationDetail from './QuotationDetail.jsx'
import Quotations from './Quotations.jsx'
import Requests from './Requests.jsx'
import Settings from './Settings.jsx'
import Suppliers from './Suppliers.jsx'

export default function Compras() {
  const { user } = useAuth()
  const buyer = can(user, 'comprador')
  const approver = can(user, 'aprovador')
  const tabs = [
    can(user, 'solicitante') || buyer ? ['solicitacoes', 'Solicitações'] : null,
    buyer ? ['cotacoes', 'Cotações'] : null,
    buyer || approver ? ['pedidos', 'Pedidos'] : null,
    approver ? ['aprovacoes', 'Aprovações'] : null,
    buyer ? ['notas', 'Notas (XML)'] : null,
    buyer ? ['fornecedores', 'Fornecedores'] : null,
    user.role === 'admin' ? ['configuracao', 'Grupos e alçadas'] : null,
  ].filter(Boolean)

  if (!tabs.length) {
    return (
      <>
        <h1>Compras</h1>
        <p className="muted">Seu usuário ainda não tem perfil no módulo de Compras. Peça a um administrador.</p>
      </>
    )
  }

  return (
    <>
      <h1>Compras</h1>
      <nav className="subnav">
        {tabs.map(([path, label]) => <NavLink key={path} to={path}>{label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Navigate to={tabs[0][0]} replace />} />
        <Route path="solicitacoes" element={<Requests />} />
        <Route path="cotacoes" element={<Quotations />} />
        <Route path="cotacoes/:id" element={<QuotationDetail />} />
        <Route path="pedidos" element={<Orders />} />
        <Route path="pedidos/:id" element={<OrderDetail />} />
        <Route path="aprovacoes" element={<Approvals />} />
        <Route path="notas" element={<Invoices />} />
        <Route path="notas/:id" element={<InvoiceDetail />} />
        <Route path="fornecedores" element={<Suppliers />} />
        <Route path="configuracao" element={<Settings />} />
        <Route path="*" element={<Navigate to={tabs[0][0]} replace />} />
      </Routes>
    </>
  )
}
