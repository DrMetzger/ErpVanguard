import {
  IconArrowsExchange, IconBarcode, IconBoxSeam, IconBuildingStore, IconCategory, IconFileDescription, IconGridDots,
  IconLink, IconListNumbers, IconMap, IconPercentage, IconReceiptTax, IconRuler2, IconTags, IconUsersGroup,
} from '@tabler/icons-react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { CatalogPage } from '../../components/CatalogPage'
import { ModuleTabs } from '../../components/ModuleTabs'
import { FiscalMatrix } from './Fiscal'
import PriceTables from './PriceTables'
import Products from './Products'
import { SerasaButton } from './Serasa'


// Endereços antigos (antes dos grupos) continuam funcionando.
const OLD: Record<string, string> = {
  grupos: 'produtos/grupos', tipos: 'produtos/tipos', unidades: 'produtos/unidades', ncm: 'produtos/ncm', 'tabelas-preco': 'produtos/precos',
  fornecedores: 'parceiros/fornecedores', clientes: 'parceiros/clientes', 'produto-fornecedor': 'parceiros/produto-fornecedor',
}

export default function Cadastros() {
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
          { path: 'fornecedores', label: 'Fornecedores', icon: IconBuildingStore, element: <CatalogPage name="suppliers" /> },
          { path: 'clientes', label: 'Clientes', icon: IconUsersGroup, element: <CatalogPage name="customers" rowActions={(row) => <SerasaButton id={row.id} name={String(row.name)} />} /> },
          { path: 'produto-fornecedor', label: 'Produto × Fornecedor', icon: IconLink, element: <CatalogPage name="supplier-products" /> },
        ]} />
      } />
      <Route path="fiscal/*" element={
        <ModuleTabs base="/cadastros/fiscal" title="Cadastros · Fiscal" tabs={[
          { path: 'matriz', label: 'Matriz fiscal (TES)', icon: IconGridDots, element: <FiscalMatrix /> },
          { path: 'impostos', label: 'Matriz de impostos', icon: IconPercentage, element: <CatalogPage name="tax-rules" /> },
          { path: 'icms-uf', label: 'ICMS por UF', icon: IconMap, element: <CatalogPage name="uf-icms" /> },
          { path: 'tes', label: 'TES (entrada/saída)', icon: IconArrowsExchange, element: <CatalogPage name="tes" /> },
          { path: 'operacoes', label: 'Tipos de operação', icon: IconFileDescription, element: <CatalogPage name="operation-types" /> },
          { path: 'cfop', label: 'CFOP', icon: IconListNumbers, element: <CatalogPage name="cfop" /> },
        ]} />
      } />
      {/* Empresas foi para Administração */}
      <Route path="empresas/*" element={<EmpresasRedirect />} />
      {Object.entries(OLD).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={`/cadastros/${to}`} replace />} />)}
      <Route path="tabelas-preco" element={<Navigate to="/cadastros/produtos/precos" replace />} />
      <Route path="*" element={<Navigate to="/cadastros/produtos" replace />} />
    </Routes>
  )
}

function EmpresasRedirect() {
  const rest = useParams()['*']
  return <Navigate to={`/empresas/${rest ?? ''}`} replace />
}
