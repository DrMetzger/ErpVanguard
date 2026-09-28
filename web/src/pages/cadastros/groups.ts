import { IconBoxSeam, IconReceiptTax, IconUsersGroup } from '@tabler/icons-react'

// Cadastros em 3 grupos (Empresas fica em Administração) (cada um com suas abas): /cadastros/<grupo>/<aba>.
export const CADASTRO_GROUPS = [
  { path: 'produtos', label: 'Produtos', icon: IconBoxSeam },
  { path: 'parceiros', label: 'Clientes e fornecedores', icon: IconUsersGroup },
  { path: 'fiscal', label: 'Fiscal', icon: IconReceiptTax },
] as const
