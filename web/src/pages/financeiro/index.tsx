import { Text, Title } from '@mantine/core'
import { IconArrowDownLeft, IconArrowUpRight, IconBuildingBank, IconChartLine, IconListTree, IconReportMoney, IconSitemap, IconTargetArrow } from '@tabler/icons-react'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import { useUser } from '../../lib/auth'
import { can } from '../../lib/format'
import CashFlow from './CashFlow'
import CostCenterReport from './CostCenterReport'
import Dre from './Dre'
import Titles from './Titles'

export default function Financeiro() {
  const user = useUser()
  if (!can(user, 'financeiro')) {
    return (
      <>
        <Title order={2}>Financeiro</Title>
        <Text c="dimmed" mt="sm">Seu usuário ainda não tem o perfil Financeiro. Peça a um administrador.</Text>
      </>
    )
  }
  return (
    <ModuleTabs
      base="/financeiro"
      title="Financeiro"
      tabs={[
        { path: 'receber', label: 'Contas a receber', icon: IconArrowDownLeft, element: <Titles key="R" kind="R" /> },
        { path: 'pagar', label: 'Contas a pagar', icon: IconArrowUpRight, element: <Titles key="P" kind="P" /> },
        { path: 'fluxo', label: 'Fluxo de caixa', icon: IconChartLine, element: <CashFlow /> },
        { path: 'dre', label: 'DRE', icon: IconReportMoney, element: <Dre /> },
        { path: 'resultado-centros', label: 'Por centro de custo', icon: IconTargetArrow, element: <CostCenterReport /> },
        { path: 'bancos', label: 'Bancos e caixa', icon: IconBuildingBank, element: <CatalogPage name="bank-accounts" /> },
        { path: 'plano', label: 'Plano de contas', icon: IconListTree, element: <CatalogPage name="finance-categories" /> },
        { path: 'centros-de-custo', label: 'Centros de custo', icon: IconSitemap, element: <CatalogPage name="cost-centers" /> },
      ]}
    />
  )
}
