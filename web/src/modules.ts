import { IconBox, IconChartBar, IconHome, IconReceipt, IconShoppingCart, IconWallet, type Icon } from '@tabler/icons-react'

export interface ModuleDef {
  path: string
  icon: Icon
  title: string
  soon?: string[]
}

export const home: ModuleDef = { path: '/', icon: IconHome, title: 'Início' }

export const modules: ModuleDef[] = [
  { path: '/compras', icon: IconShoppingCart, title: 'Compras' },
  { path: '/estoque', icon: IconBox, title: 'Estoque' },
  { path: '/faturamento', icon: IconReceipt, title: 'Faturamento', soon: ['Orçamentos', 'Pedidos de venda', 'NF-e / NFC-e', 'Pedidos dos marketplaces'] },
  { path: '/financeiro', icon: IconWallet, title: 'Financeiro', soon: ['Contas a pagar', 'Contas a receber', 'Boletos e PIX', 'Fluxo de caixa'] },
  { path: '/bi', icon: IconChartBar, title: 'BI Avançado', soon: ['Painel de vendas', 'Margem por produto e canal', 'Metas e alertas', 'Exportação Excel/PDF'] },
]
