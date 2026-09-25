import { Text, Title } from '@mantine/core'
import { IconCalendarDollar, IconFileDollar, IconFileInvoice, IconFileText } from '@tabler/icons-react'
import { Route } from 'react-router-dom'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import { useUser } from '../../lib/auth'
import { can } from '../../lib/format'
import SalesDocForm from './SalesDocForm'
import SalesDocs from './SalesDocs'
import SalesInvoiceDetail from './SalesInvoiceDetail'
import SalesInvoices from './SalesInvoices'

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
        { path: 'orcamentos', label: 'Orçamentos', icon: IconFileDollar, element: <SalesDocs key="quote" kind="quote" /> },
        { path: 'pedidos', label: 'Pedidos de venda', icon: IconFileText, element: <SalesDocs key="order" kind="order" /> },
        { path: 'notas', label: 'Notas emitidas', icon: IconFileInvoice, element: <SalesInvoices /> },
        { path: 'condicoes', label: 'Condições de pagamento', icon: IconCalendarDollar, element: <CatalogPage name="payment-terms" /> },
      ]}
      extraRoutes={<>
        <Route path="orcamentos/novo" element={<SalesDocForm key="quote-new" kind="quote" />} />
        <Route path="orcamentos/:id" element={<SalesDocForm key="quote" kind="quote" />} />
        <Route path="pedidos/novo" element={<SalesDocForm key="order-new" kind="order" />} />
        <Route path="pedidos/:id" element={<SalesDocForm key="order" kind="order" />} />
        <Route path="notas/:id" element={<SalesInvoiceDetail />} />
      </>}
    />
  )
}
