import type { Permission } from '../users/user.entity'

// phone/zip: só números, com máscara na tela; city: lista de municípios da UF (preenche cityCode); ie: validada pela UF; json: dados guardados (ex.: Receita).
export type FieldType = 'text' | 'int' | 'decimal' | 'bool' | 'date' | 'enum' | 'ref' | 'uf' | 'document' | 'phone' | 'zip' | 'city' | 'ie' | 'json'

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
  hidden?: boolean // não aparece no formulário (preenchido pelo sistema)
}

export interface ResourceDef {
  name: string
  module: 'cadastros' | 'fiscal' | 'faturamento' | 'financeiro'
  title: string
  singular: string
  description: string
  table: string
  labelExpr: string // como a linha aparece em listas de seleção
  search: string[]
  order: string
  write: Permission[] // além do admin
  fields: FieldDef[]
  // Mensagem para violações de restrições específicas do banco.
  constraints?: Record<string, string>
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const KIND = [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }]
const BANKS = [
  ['001', 'Banco do Brasil'], ['033', 'Santander'], ['077', 'Inter'], ['104', 'Caixa Econômica'], ['237', 'Bradesco'], ['260', 'Nubank'],
  ['341', 'Itaú'], ['336', 'C6 Bank'], ['422', 'Safra'], ['748', 'Sicredi'], ['756', 'Sicoob'], ['041', 'Banrisul'], ['070', 'BRB'], ['290', 'PagBank'], ['323', 'Mercado Pago'],
].map(([value, name]) => ({ value: value!, label: `${value} · ${name}` }))
export const REGIMES = [
  { value: 'simples', label: 'Simples Nacional' }, { value: 'simples_excesso', label: 'Simples Nacional (excesso de sublimite)' },
  { value: 'mei', label: 'MEI' }, { value: 'presumido', label: 'Lucro Presumido' }, { value: 'real', label: 'Lucro Real' },
]
const TAXES = [{ value: 'ICMS', label: 'ICMS' }, { value: 'ICMS_ST', label: 'ICMS-ST (substituição tributária)' }, { value: 'IPI', label: 'IPI' }, { value: 'PIS', label: 'PIS' }, { value: 'COFINS', label: 'COFINS' }]
const TAXPAYER = [{ value: '1', label: 'Contribuinte de ICMS' }, { value: '2', label: 'Contribuinte isento' }, { value: '9', label: 'Não contribuinte' }]
export const DRE_LINES = [
  { value: 'receita', label: 'Receita bruta' }, { value: 'deducao', label: '(−) Deduções e impostos sobre vendas' }, { value: 'cmv', label: '(−) CMV / CPV' },
  { value: 'desp_adm', label: '(−) Despesas administrativas' }, { value: 'desp_com', label: '(−) Despesas comerciais' }, { value: 'desp_fin', label: '(−) Despesas financeiras (líquidas)' },
  { value: 'outras', label: 'Outras receitas e despesas' }, { value: 'ir_csll', label: '(−) IR e CSLL' }, { value: 'fora', label: 'Fora da DRE' },
]
// Endereço completo: CEP busca o resto; UF antes da cidade (a cidade vem da lista do IBGE).
const address = (ufRequired = false): FieldDef[] => [
  { key: 'zip', column: 'zip', label: 'CEP', type: 'zip', required: true, help: 'Digite o CEP e o endereço é preenchido' },
  { key: 'uf', column: 'uf', label: 'UF', type: 'uf', required: ufRequired, list: true },
  { key: 'city', column: 'city', label: 'Cidade', type: 'city', max: 100, list: true },
  { key: 'street', column: 'street', label: 'Endereço', type: 'text', max: 200, span: 2 },
  { key: 'number', column: 'number', label: 'Número', type: 'text', max: 20 },
  { key: 'complement', column: 'complement', label: 'Complemento', type: 'text', max: 100 },
  { key: 'district', column: 'district', label: 'Bairro', type: 'text', max: 100 },
  { key: 'cityCode', column: 'city_code', label: 'Código IBGE do município', type: 'text', pattern: '^\\d{7}$', patternMessage: 'Código IBGE com 7 dígitos', hidden: true },
]
const email: FieldDef = { key: 'email', column: 'email', label: 'E-mail', type: 'text', max: 200, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', patternMessage: 'E-mail inválido' }
const receita: FieldDef[] = [
  { key: 'cnae', column: 'cnae', label: 'CNAE principal', type: 'text', max: 250, hidden: true },
  { key: 'receita', column: 'receita', label: 'Dados da Receita', type: 'json', hidden: true },
]
const active: FieldDef = { key: 'active', column: 'active', label: 'Ativo', type: 'bool', default: true, list: true }

// Tabelas que podem ser referenciadas (inclusive as que têm tela própria).
export const REF_TARGETS: Record<string, { table: string; labelExpr: string; search: string[] }> = {
  products: { table: 'products', labelExpr: "sku || ' · ' || name", search: ['sku', 'name'] },
}

export const RESOURCES: ResourceDef[] = [
  {
    name: 'companies', module: 'cadastros', title: 'Empresas e filiais', singular: 'empresa', description: 'Matriz e filiais. A UF de cada uma define se a operação é dentro ou fora do estado.',
    table: 'companies', labelExpr: "code || ' · ' || coalesce(trade_name, name)", search: ['code', 'name', 'trade_name', 'document', 'city'], order: 'code', write: [],
    constraints: { companies_one_head: 'Já existe uma matriz cadastrada. Desmarque a atual antes.', companies_document_key: 'Já existe uma empresa com este CNPJ' },
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 4, pattern: '^\\d{2,4}$', patternMessage: '2 a 4 dígitos (ex.: 01)', list: true },
      { key: 'isHead', column: 'is_head', label: 'Matriz', type: 'bool', default: false, list: true },
      { key: 'document', column: 'document', label: 'CNPJ', type: 'document', required: true, list: true },
      { key: 'name', column: 'name', label: 'Razão social', type: 'text', required: true, max: 200, list: true, span: 2 },
      { key: 'tradeName', column: 'trade_name', label: 'Nome fantasia', type: 'text', max: 200 },
      { key: 'taxRegime', column: 'tax_regime', label: 'Regime tributário', type: 'enum', options: REGIMES, default: 'presumido', required: true, list: true, help: 'Define CST ou CSOSN, PIS/COFINS e o CRT da nota' },
      { key: 'snCreditRate', column: 'sn_credit_rate', label: 'Alíquota de crédito do Simples (%)', type: 'decimal', help: 'Para CSOSN 101/201 (pCredSN)' },
      { key: 'ie', column: 'ie', label: 'Inscrição estadual', type: 'ie', max: 20 },
      { key: 'im', column: 'im', label: 'Inscrição municipal', type: 'text', max: 20 },
      email,
      { key: 'phone', column: 'phone', label: 'Telefone', type: 'phone' },
      ...address(true),
      active,
    ],
  },
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
      { key: 'taxEstimateRate', column: 'tax_estimate_rate', label: 'Tributos aproximados (%)', type: 'decimal', help: 'Lei 12.741 (tabela IBPT, federal + estadual). Vazio: parâmetro MV_IBPTPCT' },
      { key: 'pending', column: 'pending', label: 'Descrição pendente', type: 'bool', default: false, list: true, help: 'Cadastrado sozinho ao salvar um produto; confira a descrição' },
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
      { key: 'contact', column: 'contact', label: 'Contato', type: 'text', max: 120, help: 'Pessoa com quem falar' },
      { key: 'taxpayer', column: 'taxpayer', label: 'Contribuinte', type: 'enum', options: TAXPAYER, default: '9', required: true, list: true },
      { key: 'ie', column: 'ie', label: 'Inscrição estadual', type: 'ie', max: 20 },
      email,
      { key: 'phone', column: 'phone', label: 'Telefone', type: 'phone', list: true },
      { key: 'phone2', column: 'phone2', label: 'Celular / telefone 2', type: 'phone' },
      ...address(),
      ...receita,
      active,
    ],
  },
  {
    name: 'suppliers', module: 'cadastros', title: 'Fornecedores', singular: 'fornecedor', description: 'De quem você compra. Também são cadastrados sozinhos ao importar um XML.',
    table: 'suppliers', labelExpr: 'name', search: ['name', 'trade_name', 'cnpj', 'city'], order: 'name', write: ['cadastro', 'comprador'],
    constraints: { suppliers_cnpj_key: 'Já existe um fornecedor com este CNPJ/CPF' },
    fields: [
      { key: 'cnpj', column: 'cnpj', label: 'CNPJ/CPF', type: 'document', required: true, list: true },
      { key: 'name', column: 'name', label: 'Razão social', type: 'text', required: true, max: 200, list: true, span: 2 },
      { key: 'tradeName', column: 'trade_name', label: 'Nome fantasia', type: 'text', max: 200, span: 2 },
      { key: 'contact', column: 'contact', label: 'Contato', type: 'text', max: 120, list: true, help: 'Pessoa com quem falar' },
      { key: 'ie', column: 'ie', label: 'Inscrição estadual', type: 'ie', max: 20 },
      email,
      { key: 'phone', column: 'phone', label: 'Telefone', type: 'phone', list: true },
      { key: 'phone2', column: 'phone2', label: 'Celular / telefone 2', type: 'phone' },
      ...address(),
      ...receita,
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
      { key: 'isReturn', column: 'is_return', label: 'É devolução', type: 'bool', default: false, list: true, help: 'Devolução de venda gera crédito ao cliente (NCC); de compra, débito do fornecedor (NDF)' },
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
    name: 'tax-rules', module: 'fiscal', title: 'Matriz de impostos', singular: 'regra de imposto',
    description: 'Como calcular cada imposto. Filtros vazios valem para qualquer valor; vence a regra mais específica. Sem regra: ICMS pela alíquota da UF (CST 00 ou CSOSN 102) e PIS/COFINS pelo regime.',
    table: 'tax_rules', labelExpr: "tax || ' · ' || name", search: ['name', 'tax', 'ncm_prefix', 'cst', 'cfop'], order: 'tax, name', write: ['fiscal'],
    fields: [
      { key: 'tax', column: 'tax', label: 'Imposto', type: 'enum', options: TAXES, required: true, list: true },
      { key: 'name', column: 'name', label: 'Nome da regra', type: 'text', required: true, max: 120, list: true, span: 2 },
      { key: 'regime', column: 'regime', label: 'Regime fiscal', type: 'enum', options: REGIMES, list: true, help: 'Vazio = qualquer regime' },
      { key: 'validFrom', column: 'valid_from', label: 'Vigência de', type: 'date' },
      { key: 'validTo', column: 'valid_to', label: 'Vigência até', type: 'date' },
      { key: 'operationTypeId', column: 'operation_type_id', label: 'Tipo de operação', type: 'ref', ref: 'operation-types' },
      { key: 'uf', column: 'uf', label: 'UF do destinatário', type: 'uf', list: true },
      { key: 'taxpayer', column: 'taxpayer', label: 'Contribuinte', type: 'enum', options: TAXPAYER },
      { key: 'productId', column: 'product_id', label: 'Produto', type: 'ref', ref: 'products' },
      { key: 'productGroupId', column: 'product_group_id', label: 'Grupo de produto', type: 'ref', ref: 'product-groups' },
      { key: 'productTypeId', column: 'product_type_id', label: 'Tipo de item', type: 'ref', ref: 'product-types' },
      { key: 'ncmPrefix', column: 'ncm_prefix', label: 'NCM começa com', type: 'text', pattern: '^\\d{2,8}$', patternMessage: '2 a 8 dígitos', list: true },
      { key: 'cfop', column: 'cfop', label: 'CFOP', type: 'text', pattern: '^[1-7]\\d{3}$', patternMessage: 'CFOP com 4 dígitos' },
      { key: 'cst', column: 'cst', label: 'CST / CSOSN', type: 'text', required: true, pattern: '^\\d{2,3}$', patternMessage: 'CST (2 dígitos) ou CSOSN (3 dígitos)', list: true },
      { key: 'rate', column: 'rate', label: 'Alíquota (%)', type: 'decimal', list: true, help: 'Vazio: ICMS pela tabela de UF; IPI pelo NCM' },
      { key: 'baseReduction', column: 'base_reduction', label: 'Redução da base (%)', type: 'decimal', default: 0 },
      { key: 'mva', column: 'mva', label: 'MVA / IVA-ST (%)', type: 'decimal', help: 'Só ICMS-ST. Ajustada sozinha em operação interestadual' },
      { key: 'stRate', column: 'st_rate', label: 'Alíquota interna do destino p/ ST (%)', type: 'decimal', help: 'Vazio: tabela de UF' },
      { key: 'fcpRate', column: 'fcp_rate', label: 'FCP (%)', type: 'decimal', help: 'Vazio: tabela de UF' },
      { key: 'creditRate', column: 'credit_rate', label: 'Crédito do Simples (%)', type: 'decimal', help: 'CSOSN 101/201; vazio usa o da empresa' },
      { key: 'notes', column: 'notes', label: 'Observações', type: 'text', max: 300, span: 3 },
      active,
    ],
  },
  {
    name: 'uf-icms', module: 'fiscal', title: 'ICMS por UF', singular: 'UF', description: 'Alíquota interna de ICMS e FCP de cada estado. Interestadual: 7% saindo do Sul/Sudeste (menos ES) para N/NE/CO/ES, 12% nos demais e 4% para importados.',
    table: 'uf_icms', labelExpr: "uf", search: ['uf', 'notes'], order: 'uf', write: ['fiscal'],
    fields: [
      { key: 'uf', column: 'uf', label: 'UF', type: 'uf', required: true, list: true },
      { key: 'internalRate', column: 'internal_rate', label: 'Alíquota interna (%)', type: 'decimal', required: true, list: true },
      { key: 'fcpRate', column: 'fcp_rate', label: 'FCP (%)', type: 'decimal', default: 0, list: true },
      { key: 'notes', column: 'notes', label: 'Observações', type: 'text', max: 200, list: true, span: 2 },
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
  {
    name: 'payment-terms', module: 'faturamento', title: 'Condições de pagamento', singular: 'condição', description: 'Em quantos dias vence cada parcela. Ex.: 30/60/90 gera 3 parcelas.',
    table: 'payment_terms', labelExpr: "code || ' · ' || name", search: ['code', 'name', 'days'], order: 'code', write: ['faturamento', 'financeiro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 6, upper: true, list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 60, list: true },
      { key: 'days', column: 'days', label: 'Dias das parcelas', type: 'text', required: true, max: 60, pattern: '^\\d{1,3}(/\\d{1,3}){0,11}$', patternMessage: 'Dias separados por barra, ex.: 30/60/90', help: '0 = à vista', list: true },
      active,
    ],
  },
  {
    name: 'finance-categories', module: 'financeiro', title: 'Plano de contas', singular: 'conta', description: 'Classifica receitas e despesas para o fluxo de caixa e o BI.',
    table: 'finance_categories', labelExpr: "code || ' · ' || name", search: ['code', 'name'], order: 'code', write: ['financeiro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 10, pattern: '^[\\d.]{1,10}$', patternMessage: 'Números e pontos, ex.: 2.08', list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 100, list: true, span: 2 },
      { key: 'kind', column: 'kind', label: 'Tipo', type: 'enum', options: [{ value: 'R', label: 'Receita' }, { value: 'D', label: 'Despesa' }], required: true, list: true },
      { key: 'dreLine', column: 'dre_line', label: 'Linha da DRE', type: 'enum', options: DRE_LINES, list: true, span: 2, help: 'Natureza financeira: onde os títulos desta conta entram na DRE. Vazio ou "Fora da DRE" não entra' },
      active,
    ],
  },
  {
    name: 'cost-centers', module: 'financeiro', title: 'Centros de custo', singular: 'centro de custo', description: 'Separa receitas e despesas por área. Só o analítico recebe lançamentos; o sintético agrupa os filhos nos relatórios.',
    table: 'cost_centers', labelExpr: "code || ' · ' || name", search: ['code', 'name'], order: 'code', write: ['financeiro'],
    constraints: { cost_centers_code_key: 'Já existe um centro de custo com este código', cost_centers_check: 'O centro de custo não pode ser pai dele mesmo' },
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 20, pattern: '^[\\d.]{1,20}$', patternMessage: 'Números e pontos, ex.: 02.01', list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 120, list: true, span: 2 },
      { key: 'type', column: 'type', label: 'Tipo', type: 'enum', options: [{ value: 'A', label: 'Analítico (recebe lançamentos)' }, { value: 'S', label: 'Sintético (agrupa)' }], required: true, default: 'A', list: true },
      { key: 'parentId', column: 'parent_id', label: 'Centro superior', type: 'ref', ref: 'cost-centers', list: true, span: 2, help: 'Use um centro sintético' },
      active,
    ],
  },
  {
    name: 'bank-accounts', module: 'financeiro', title: 'Contas bancárias e caixa', singular: 'conta', description: 'Onde o dinheiro entra e sai. O saldo é o inicial mais as baixas.',
    table: 'bank_accounts', labelExpr: "code || ' · ' || name", search: ['code', 'name', 'bank'], order: 'code', write: ['financeiro'],
    fields: [
      { key: 'code', column: 'code', label: 'Código', type: 'text', required: true, max: 6, upper: true, list: true },
      { key: 'name', column: 'name', label: 'Nome', type: 'text', required: true, max: 80, list: true, span: 2 },
      { key: 'kind', column: 'kind', label: 'Tipo', type: 'enum', options: [{ value: 'banco', label: 'Banco' }, { value: 'caixa', label: 'Caixa' }], required: true, default: 'banco', list: true },
      { key: 'bankCode', column: 'bank_code', label: 'Banco', type: 'enum', options: BANKS, list: true, span: 2 },
      { key: 'bank', column: 'bank', label: 'Nome do banco (outro)', type: 'text', max: 60 },
      { key: 'agency', column: 'agency', label: 'Agência', type: 'text', max: 10, pattern: '^\\d{1,10}$', patternMessage: 'Só números' },
      { key: 'agencyDigit', column: 'agency_digit', label: 'Dígito da agência', type: 'text', max: 2 },
      { key: 'account', column: 'account', label: 'Conta', type: 'text', max: 20, pattern: '^\\d{1,20}$', patternMessage: 'Só números', list: true },
      { key: 'accountDigit', column: 'account_digit', label: 'Dígito da conta', type: 'text', max: 2 },
      { key: 'openingBalance', column: 'opening_balance', label: 'Saldo inicial (R$)', type: 'decimal', default: 0 },
      { key: 'cnabLayout', column: 'cnab_layout', label: 'Layout CNAB', type: 'enum', options: [{ value: '240', label: 'CNAB 240' }, { value: '400', label: 'CNAB 400' }], help: 'Para boletos e retorno do banco' },
      { key: 'wallet', column: 'wallet', label: 'Carteira', type: 'text', max: 5 },
      { key: 'agreement', column: 'agreement', label: 'Convênio', type: 'text', max: 20 },
      { key: 'beneficiaryCode', column: 'beneficiary_code', label: 'Código do beneficiário (cedente)', type: 'text', max: 20 },
      { key: 'nextOurNumber', column: 'next_our_number', label: 'Próximo nosso número', type: 'int', default: 1 },
      { key: 'nextRemittance', column: 'next_remittance', label: 'Próxima remessa', type: 'int', default: 1 },
      { key: 'finePct', column: 'fine_pct', label: 'Multa por atraso (%)', type: 'decimal', default: 0 },
      { key: 'interestMonthPct', column: 'interest_month_pct', label: 'Juros ao mês (%)', type: 'decimal', default: 0 },
      { key: 'protestDays', column: 'protest_days', label: 'Protestar após (dias)', type: 'int' },
      { key: 'instructions', column: 'instructions', label: 'Instruções no boleto', type: 'text', max: 240, span: 3 },
      active,
    ],
  },
]

export const resource = (name: string) => RESOURCES.find((r) => r.name === name)
