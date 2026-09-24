import { IconBarcode, IconBoxSeam, IconBuildingStore, IconCategory, IconLink, IconReceiptTax, IconRuler2, IconTags, IconUsersGroup } from '@tabler/icons-react'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import PriceTables from './PriceTables'
import Products from './Products'
import Suppliers from './Suppliers'

export default function Cadastros() {
  return (
    <ModuleTabs
      base="/cadastros"
      title="Cadastros"
      tabs={[
        { path: 'produtos', label: 'Produtos', icon: IconBoxSeam, element: <Products /> },
        { path: 'grupos', label: 'Grupos', icon: IconCategory, element: <CatalogPage name="product-groups" /> },
        { path: 'tipos', label: 'Tipos', icon: IconTags, element: <CatalogPage name="product-types" /> },
        { path: 'unidades', label: 'Unidades', icon: IconRuler2, element: <CatalogPage name="units" /> },
        { path: 'ncm', label: 'NCM', icon: IconBarcode, element: <CatalogPage name="ncm" /> },
        { path: 'fornecedores', label: 'Fornecedores', icon: IconBuildingStore, element: <Suppliers /> },
        { path: 'clientes', label: 'Clientes', icon: IconUsersGroup, element: <CatalogPage name="customers" /> },
        { path: 'tabelas-preco', label: 'Tabelas de preço', icon: IconReceiptTax, element: <PriceTables /> },
        { path: 'produto-fornecedor', label: 'Produto × Fornecedor', icon: IconLink, element: <CatalogPage name="supplier-products" /> },
      ]}
    />
  )
}
