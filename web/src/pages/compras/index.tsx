import { Tabs, Text, Title } from '@mantine/core'
import { IconBuildingStore, IconChecks, IconFileInvoice, IconFileText, IconScale, IconSettings, IconShoppingBag } from '@tabler/icons-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useUser } from '../../lib/auth'
import { can } from '../../lib/format'
import Approvals from './Approvals'
import InvoiceDetail from './InvoiceDetail'
import Invoices from './Invoices'
import OrderDetail from './OrderDetail'
import Orders from './Orders'
import QuotationDetail from './QuotationDetail'
import Quotations from './Quotations'
import Requests from './Requests'
import Settings from './Settings'
import Suppliers from './Suppliers'

export default function Compras() {
  const user = useUser()
  const navigate = useNavigate()
  const location = useLocation()
  const buyer = can(user, 'comprador')
  const approver = can(user, 'aprovador')
  const tabs = [
    (can(user, 'solicitante') || buyer) && { path: 'solicitacoes', label: 'Solicitações', icon: IconFileText },
    buyer && { path: 'cotacoes', label: 'Cotações', icon: IconScale },
    (buyer || approver) && { path: 'pedidos', label: 'Pedidos', icon: IconShoppingBag },
    approver && { path: 'aprovacoes', label: 'Aprovações', icon: IconChecks },
    buyer && { path: 'notas', label: 'Notas (XML)', icon: IconFileInvoice },
    buyer && { path: 'fornecedores', label: 'Fornecedores', icon: IconBuildingStore },
    user.role === 'admin' && { path: 'configuracao', label: 'Grupos e alçadas', icon: IconSettings },
  ].filter(Boolean) as { path: string; label: string; icon: typeof IconFileText }[]

  if (!tabs.length) {
    return (
      <>
        <Title order={2}>Compras</Title>
        <Text c="dimmed" mt="sm">Seu usuário ainda não tem perfil no módulo de Compras. Peça a um administrador.</Text>
      </>
    )
  }
  const current = location.pathname.split('/')[2] ?? tabs[0]!.path

  return (
    <>
      <Title order={2} mb="md">Compras</Title>
      <Tabs value={current} onChange={(v) => v && navigate(v)} mb="lg" className="no-print">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          {tabs.map((t) => <Tabs.Tab key={t.path} value={t.path} leftSection={<t.icon size={16} />}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>
      <Routes>
        <Route index element={<Navigate to={tabs[0]!.path} replace />} />
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
        <Route path="*" element={<Navigate to={tabs[0]!.path} replace />} />
      </Routes>
    </>
  )
}
