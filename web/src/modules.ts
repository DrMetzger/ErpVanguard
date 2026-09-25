import { IconBox, IconChartBar, IconDatabase, IconHome, IconReceipt, IconShoppingCart, IconWallet, type Icon } from '@tabler/icons-react'

export interface ModuleDef {
  path: string
  icon: Icon
  title: string
  soon?: string[]
}

export const home: ModuleDef = { path: '/', icon: IconHome, title: 'Início' }

export const modules: ModuleDef[] = [
  { path: '/cadastros', icon: IconDatabase, title: 'Cadastros' },
  { path: '/compras', icon: IconShoppingCart, title: 'Compras' },
  { path: '/estoque', icon: IconBox, title: 'Estoque' },
  { path: '/faturamento', icon: IconReceipt, title: 'Faturamento' },
  { path: '/financeiro', icon: IconWallet, title: 'Financeiro' },
  { path: '/bi', icon: IconChartBar, title: 'BI Avançado' },
]
