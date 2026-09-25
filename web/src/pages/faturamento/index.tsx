import { Text, Title } from '@mantine/core'
import { IconCalendarDollar, IconFileInvoice, IconFileText } from '@tabler/icons-react'
import { Route } from 'react-router-dom'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import { useUser } from '../../lib/auth'
import { can } from '../../lib/format'
import SalesInvoiceDetail from './SalesInvoiceDetail'
import SalesInvoices from './SalesInvoices'
import SalesOrderForm from './SalesOrderForm'
import SalesOrders from './SalesOrders'

export default function Faturamento() {
  const user = useUser()
  if (!can(user, 'vendedor') && !can(user, 'faturamento')) {
    return (
      <>
        <Title order={2}>Faturamento</Title>
        <Text c="dimmed" mt="sm">Seu usuário ainda não tem o perfil Vendedor ou Faturamento. Peça a um administrador.</Text>
      </>
    )
  }
  return (
    <ModuleTabs
      base="/faturamento"
      title="Faturamento"
      tabs={[
        { path: 'pedidos', label: 'Orçamentos e pedidos', icon: IconFileText, element: <SalesOrders /> },
        { path: 'notas', label: 'Notas emitidas', icon: IconFileInvoice, element: <SalesInvoices /> },
        { path: 'condicoes', label: 'Condições de pagamento', icon: IconCalendarDollar, element: <CatalogPage name="payment-terms" /> },
      ]}
      extraRoutes={<>
        <Route path="pedidos/novo" element={<SalesOrderForm />} />
        <Route path="pedidos/:id" element={<SalesOrderForm />} />
        <Route path="notas/:id" element={<SalesInvoiceDetail />} />
      </>}
    />
  )
}
