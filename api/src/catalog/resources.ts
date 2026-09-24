import type { Permission } from '../users/user.entity'

export type FieldType = 'text' | 'int' | 'decimal' | 'bool' | 'date' | 'enum' | 'ref' | 'uf' | 'document'

export interface FieldDef {
  key: string
  column: string
  label: string
  type: FieldType
  required?: boolean
  max?: number
  pattern?: string
  patternMessage?: string
  upper?: boolean
  options?: { value: string; label: string }[]
  ref?: string // tabela referenciada (ver REF_TARGETS)
  list?: boolean // aparece na tabela da tela
  default?: string | number | boolean
  help?: string
  span?: 1 | 2 | 3
}

export interface ResourceDef {
  name: string
  module: 'cadastros' | 'fiscal'
  title: string
  singular: string
  description: string
  table: string
  labelExpr: string // como a linha aparece em listas de seleção
  search: string[]
  order: string
  write: Permission[] // além do admin
  fields: FieldDef[]
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const KIND = [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }]
const TAXPAYER = [{ value: '1', label: 'Contribuinte de ICMS' }, { value: '2', label: 'Contribuinte isento' }, { value: '9', label: 'Não contribuinte' }]
const active: FieldDef = { key: 'active', column: 'active', label: 'Ativo', type: 'bool', default: true, list: true }

// Tabelas que podem ser referenciadas (inclusive as que têm tela própria).
export const REF_TARGETS: Record<string, { table: string; labelExpr: string; search: string[] }> = {
  products: { table: 'products', labelExpr: "sku || ' · ' || name", search: ['sku', 'name'] },
  suppliers: { table: 'suppliers', labelExpr: 'name', search: ['name', 'cnpj'] },
}

export const RESOURCES: ResourceDef[] = [
  {
    name: 'product-groups', module: 'cadastros', title: 'Grupos de produtos', singular: 'grupo', description: 'Agrupam produtos para relatórios, regras fiscais e BI.',
    table: 'product_groups', labelExpr: "code || ' · ' || name", search: ['code', 'name'], order: 'code', write: ['cadastro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 10, upper: true, list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 120, list: true, span: 2 },
      active,
    ],
  },
  {
    name: 'product-types', module: 'cadastros', title: 'Tipos de produto', singular: 'tipo', description: 'Tipo do item conforme o SPED (registro 0200).',
    table: 'product_types', labelExpr: "code || ' · ' || description", search: ['code', 'description'], order: 'code', write: ['cadastro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 2, pattern: '^\\d{2}$', patternMessage: 'Use 2 dígitos', list: true },
      { key: 'description', column: 'description', label: 'Descrição', type: 'text', required: true, max: 120, list: true, span: 2 },
      active,
    ],
  },
  {
    name: 'units', module: 'cadastros', title: 'Unidades de medida', singular: 'unidade', description: 'Unidades usadas em produtos, pedidos e notas.',
    table: 'units', labelExpr: "code || ' · ' || description", search: ['code', 'description'], order: 'code', write: ['cadastro'],
    fields: [
      { key: 'code', column: 'code', label: 'Sigla', type: 'text', required: true, max: 6, upper: true, list: true },
      { key: 'description', column: 'description', label: 'Descrição', type: 'text', required: true, max: 60, list: true },
      { key: 'decimals', column: 'decimals', label: 'Casas decimais', type: 'int', default: 0, list: true, help: 'Ex.: KG = 3, UN = 0' },
      active,
    ],
  },
  {
    name: 'ncm', module: 'cadastros', title: 'NCM', singular: 'NCM', description: 'Nomenclatura Comum do Mercosul dos seus produtos.',
    table: 'ncm', labelExpr: "code || ' · ' || description", search: ['code', 'description'], order: 'code', write: ['cadastro', 'fiscal'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, pattern: '^\\d{8}$', patternMessage: 'O NCM tem 8 dígitos', list: true },
      { key: 'description', column: 'description', label: 'Descrição', type: 'text', required: true, max: 250, list: true, span: 2 },
      { key: 'ipiRate', column: 'ipi_rate', label: 'Alíquota de IPI (%)', type: 'decimal', list: true },
      active,
    ],
  },
  {
    name: 'customers', module: 'cadastros', title: 'Clientes', singular: 'cliente', description: 'Quem compra de você. A UF e o tipo de contribuinte definem a regra fiscal.',
    table: 'customers', labelExpr: 'name', search: ['name', 'trade_name', 'document'], order: 'name', write: ['cadastro'],
    fields: [
      { key: 'document', column: 'document', label: 'CPF/CNPJ', type: 'document', required: true, list: true },
      { key: 'name', column: 'name', label: 'Nome / razão social', type: 'text', required: true, max: 200, list: true, span: 2 },
      { key: 'tradeName', column: 'trade_name', label: 'Nome fantasia', type: 'text', max: 200, span: 2 },
      { key: 'ie', column: 'ie', label: 'Inscrição estadual', type: 'text', max: 20 },
      { key: 'taxpayer', column: 'taxpayer', label: 'Contribuinte', type: 'enum', options: TAXPAYER, default: '9', required: true, list: true },
      { key: 'email', column: 'email', label: 'E-mail', type: 'text', max: 200, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', patternMessage: 'E-mail inválido' },
      { key: 'phone', column: 'phone', label: 'Telefone', type: 'text', max: 30 },
      { key: 'zip', column: 'zip', label: 'CEP', type: 'text', pattern: '^\\d{8}$', patternMessage: 'CEP com 8 dígitos' },
      { key: 'street', column: 'street', label: 'Endereço', type: 'text', max: 200, span: 2 },
      { key: 'number', column: 'number', label: 'Número', type: 'text', max: 20 },
      { key: 'district', column: 'district', label: 'Bairro', type: 'text', max: 100 },
      { key: 'city', column: 'city', label: 'Cidade', type: 'text', max: 100, list: true },
      { key: 'uf', column: 'uf', label: 'UF', type: 'uf', list: true },
      active,
    ],
  },
  {
    name: 'price-tables', module: 'cadastros', title: 'Tabelas de preço', singular: 'tabela de preço', description: 'Preços de venda por tabela (varejo, atacado, marketplace…).',
    table: 'price_tables', labelExpr: "code || ' · ' || name", search: ['code', 'name'], order: 'code', write: ['cadastro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 10, upper: true, list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 120, list: true, span: 2 },
      { key: 'validFrom', column: 'valid_from', label: 'Válida de', type: 'date', list: true },
      { key: 'validTo', column: 'valid_to', label: 'Válida até', type: 'date', list: true },
      active,
    ],
  },
  {
    name: 'supplier-products', module: 'cadastros', title: 'Produto × Fornecedor', singular: 'amarração', description: 'Código do produto no fornecedor. O sistema também aprende sozinho ao lançar notas.',
    table: 'supplier_products', labelExpr: 'supplier_code', search: ['supplier_code'], order: 'created_at DESC', write: ['cadastro', 'comprador'],
    fields: [
      { key: 'supplierId', column: 'supplier_id', label: 'Fornecedor', type: 'ref', ref: 'suppliers', required: true, list: true, span: 2 },
      { key: 'supplierCode', column: 'supplier_code', label: 'Código no fornecedor', type: 'text', required: true, max: 60, list: true },
      { key: 'productId', column: 'product_id', label: 'Produto', type: 'ref', ref: 'products', required: true, list: true, span: 3 },
    ],
  },

  // ---- Fiscal
  {
    name: 'cfop', module: 'fiscal', title: 'CFOP', singular: 'CFOP', description: 'Código Fiscal de Operações e Prestações. 1/2/3 = entradas, 5/6/7 = saídas.',
    table: 'cfop', labelExpr: "code || ' · ' || description", search: ['code', 'description'], order: 'code', write: ['fiscal'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, pattern: '^[1-35-7]\\d{3}$', patternMessage: 'CFOP com 4 dígitos, começando em 1, 2, 3, 5, 6 ou 7', list: true },
      { key: 'description', column: 'description', label: 'Descrição', type: 'text', required: true, max: 250, list: true, span: 2 },
      active,
    ],
  },
  {
    name: 'operation-types', module: 'fiscal', title: 'Tipos de operação', singular: 'tipo de operação', description: 'A natureza do documento: venda, compra, devolução, remessa…',
    table: 'operation_types', labelExpr: "code || ' · ' || name", search: ['code', 'name'], order: 'code', write: ['fiscal'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 4, upper: true, list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 120, list: true, span: 2 },
      { key: 'kind', column: 'kind', label: 'Entrada/Saída', type: 'enum', options: KIND, required: true, list: true },
      active,
    ],
  },
  {
    name: 'tes', module: 'fiscal', title: 'TES (entrada e saída)', singular: 'TES', description: 'Como cada operação é tratada: CFOP, estoque, financeiro e impostos.',
    table: 'tes', labelExpr: "code || ' · ' || description", search: ['code', 'description', 'cfop_internal'], order: 'code', write: ['fiscal'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, pattern: '^\\d{3}$', patternMessage: '3 dígitos (001–499 entradas, 500–999 saídas)', list: true },
      { key: 'kind', column: 'kind', label: 'Entrada/Saída', type: 'enum', options: KIND, required: true, list: true },
      { key: 'description', column: 'description', label: 'Descrição', type: 'text', required: true, max: 120, list: true },
      { key: 'cfopInternal', column: 'cfop_internal', label: 'CFOP dentro do estado', type: 'text', required: true, pattern: '^[1-35-7]\\d{3}$', patternMessage: 'CFOP inválido', list: true },
      { key: 'cfopInterstate', column: 'cfop_interstate', label: 'CFOP fora do estado', type: 'text', pattern: '^[1-35-7]\\d{3}$', patternMessage: 'CFOP inválido', list: true },
      { key: 'icmsCst', column: 'icms_cst', label: 'CST/CSOSN do ICMS', type: 'text', max: 3, pattern: '^\\d{2,3}$', patternMessage: '2 ou 3 dígitos' },
      { key: 'ipiCst', column: 'ipi_cst', label: 'CST do IPI', type: 'text', max: 2, pattern: '^\\d{2}$', patternMessage: '2 dígitos' },
      { key: 'pisCofinsCst', column: 'pis_cofins_cst', label: 'CST PIS/COFINS', type: 'text', max: 2, pattern: '^\\d{2}$', patternMessage: '2 dígitos' },
      { key: 'updatesStock', column: 'updates_stock', label: 'Movimenta estoque', type: 'bool', default: true, list: true },
      { key: 'generatesFinancial', column: 'generates_financial', label: 'Gera financeiro', type: 'bool', default: true, list: true },
      { key: 'calcIcms', column: 'calc_icms', label: 'Calcula ICMS', type: 'bool', default: true },
      { key: 'calcIpi', column: 'calc_ipi', label: 'Calcula IPI', type: 'bool', default: false },
      { key: 'calcPisCofins', column: 'calc_pis_cofins', label: 'Calcula PIS/COFINS', type: 'bool', default: true },
      { key: 'notes', column: 'notes', label: 'Observações', type: 'text', max: 1000, span: 3 },
      active,
    ],
  },
  {
    name: 'fiscal-matrix', module: 'fiscal', title: 'Matriz fiscal', singular: 'regra', description: 'Qual TES usar em cada situação. Campo vazio vale para qualquer valor; vence a regra mais específica.',
    table: 'fiscal_matrix', labelExpr: "coalesce(notes, id::text)", search: ['notes', 'ncm_prefix', 'uf'], order: 'operation_type_id', write: ['fiscal'],
    fields: [
      { key: 'operationTypeId', column: 'operation_type_id', label: 'Tipo de operação', type: 'ref', ref: 'operation-types', required: true, list: true, span: 2 },
      { key: 'tesId', column: 'tes_id', label: 'TES a usar', type: 'ref', ref: 'tes', required: true, list: true },
      { key: 'uf', column: 'uf', label: 'UF do cliente/fornecedor', type: 'uf', list: true },
      { key: 'taxpayer', column: 'taxpayer', label: 'Contribuinte', type: 'enum', options: TAXPAYER, list: true },
      { key: 'productTypeId', column: 'product_type_id', label: 'Tipo de produto', type: 'ref', ref: 'product-types' },
      { key: 'productGroupId', column: 'product_group_id', label: 'Grupo de produto', type: 'ref', ref: 'product-groups', list: true },
      { key: 'ncmPrefix', column: 'ncm_prefix', label: 'NCM começa com', type: 'text', pattern: '^\\d{2,8}$', patternMessage: '2 a 8 dígitos', list: true },
      { key: 'notes', column: 'notes', label: 'Descrição da regra', type: 'text', max: 200, span: 3 },
      active,
    ],
  },
]

export const resource = (name: string) => RESOURCES.find((r) => r.name === name)
