import {
  IconArrowsExchange, IconBarcode, IconBoxSeam, IconBuilding, IconBuildingStore, IconCategory, IconCertificate, IconFileDescription, IconGridDots,
  IconLink, IconListNumbers, IconReceiptTax, IconRuler2, IconTags, IconUsersGroup,
} from '@tabler/icons-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import { useUser } from '../../lib/auth'
import Certificates from './Certificates'
import Companies from './Companies'
import { FiscalMatrix } from './Fiscal'
import PriceTables from './PriceTables'
import Products from './Products'
import Suppliers from './Suppliers'


// Endereços antigos (antes dos grupos) continuam funcionando.
const OLD: Record<string, string> = {
  grupos: 'produtos/grupos', tipos: 'produtos/tipos', unidades: 'produtos/unidades', ncm: 'produtos/ncm', 'tabelas-preco': 'produtos/precos',
  fornecedores: 'parceiros/fornecedores', clientes: 'parceiros/clientes', 'produto-fornecedor': 'parceiros/produto-fornecedor',
}

export default function Cadastros() {
  const user = useUser()
  return (
    <Routes>
      <Route index element={<Navigate to="/cadastros/produtos" replace />} />
      <Route path="produtos/*" element={
        <ModuleTabs base="/cadastros/produtos" title="Cadastros · Produtos" tabs={[
          { path: 'produtos', label: 'Produtos', icon: IconBoxSeam, element: <Products /> },
          { path: 'grupos', label: 'Grupos', icon: IconCategory, element: <CatalogPage name="product-groups" /> },
          { path: 'tipos', label: 'Tipos', icon: IconTags, element: <CatalogPage name="product-types" /> },
          { path: 'unidades', label: 'Unidades', icon: IconRuler2, element: <CatalogPage name="units" /> },
          { path: 'ncm', label: 'NCM', icon: IconBarcode, element: <CatalogPage name="ncm" /> },
          { path: 'precos', label: 'Tabelas de preço', icon: IconReceiptTax, element: <PriceTables /> },
        ]} />
      } />
      <Route path="parceiros/*" element={
        <ModuleTabs base="/cadastros/parceiros" title="Cadastros · Clientes e fornecedores" tabs={[
          { path: 'fornecedores', label: 'Fornecedores', icon: IconBuildingStore, element: <Suppliers /> },
          { path: 'clientes', label: 'Clientes', icon: IconUsersGroup, element: <CatalogPage name="customers" /> },
          { path: 'produto-fornecedor', label: 'Produto × Fornecedor', icon: IconLink, element: <CatalogPage name="supplier-products" /> },
        ]} />
      } />
      <Route path="fiscal/*" element={
        <ModuleTabs base="/cadastros/fiscal" title="Cadastros · Fiscal" tabs={[
          { path: 'matriz', label: 'Matriz fiscal', icon: IconGridDots, element: <FiscalMatrix /> },
          { path: 'tes', label: 'TES (entrada/saída)', icon: IconArrowsExchange, element: <CatalogPage name="tes" /> },
          { path: 'operacoes', label: 'Tipos de operação', icon: IconFileDescription, element: <CatalogPage name="operation-types" /> },
          { path: 'cfop', label: 'CFOP', icon: IconListNumbers, element: <CatalogPage name="cfop" /> },
        ]} />
      } />
      <Route path="empresas/*" element={
        <ModuleTabs base="/cadastros/empresas" title="Cadastros · Empresas" tabs={[
          { path: 'empresas', label: 'Empresas e filiais', icon: IconBuilding, element: <Companies /> },
          { path: 'certificados', label: 'Certificado digital A1', icon: IconCertificate, element: <Certificates />, hidden: user.role !== 'admin' },
        ]} />
      } />
      {Object.entries(OLD).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={`/cadastros/${to}`} replace />} />)}
      <Route path="tabelas-preco" element={<Navigate to="/cadastros/produtos/precos" replace />} />
      <Route path="*" element={<Navigate to="/cadastros/produtos" replace />} />
    </Routes>
  )
}
