import { IconBoxSeam, IconBuilding, IconReceiptTax, IconUsersGroup } from '@tabler/icons-react'

// Cadastros em 4 grupos (cada um com suas abas): /cadastros/<grupo>/<aba>.
export const CADASTRO_GROUPS = [
  { path: 'produtos', label: 'Produtos', icon: IconBoxSeam },
  { path: 'parceiros', label: 'Clientes e fornecedores', icon: IconUsersGroup },
  { path: 'fiscal', label: 'Fiscal', icon: IconReceiptTax },
  { path: 'empresas', label: 'Empresas', icon: IconBuilding },
] as const
