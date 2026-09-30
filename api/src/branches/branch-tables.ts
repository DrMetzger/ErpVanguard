// Cadastros que podem ser compartilhados entre as filiais (branch_id vazio) ou exclusivos de cada filial,
// como o X2_MODO do Protheus. Tabelas oficiais e a configuração fiscal (NCM, CFOP, UF, cClassTrib, TES,
// tipos de operação, matriz fiscal e de impostos, unidades e tipos de produto) são sempre compartilhadas.
export interface BranchTable { table: string; resource: string; label: string; defaultMode: 'C' | 'E'; unique?: { name: string; column: string } }

export const BRANCH_TABLES: BranchTable[] = [
  { table: 'products', resource: 'products', label: 'Produtos', defaultMode: 'C', unique: { name: 'products_sku_key', column: 'sku' } },
  { table: 'product_groups', resource: 'product-groups', label: 'Grupos de produtos', defaultMode: 'C', unique: { name: 'product_groups_code_key', column: 'code' } },
  { table: 'customers', resource: 'customers', label: 'Clientes', defaultMode: 'C', unique: { name: 'customers_document_key', column: 'document' } },
  { table: 'suppliers', resource: 'suppliers', label: 'Fornecedores', defaultMode: 'C', unique: { name: 'suppliers_cnpj_key', column: 'cnpj' } },
  { table: 'price_tables', resource: 'price-tables', label: 'Tabelas de preço', defaultMode: 'C', unique: { name: 'price_tables_code_key', column: 'code' } },
  { table: 'payment_terms', resource: 'payment-terms', label: 'Condições de pagamento', defaultMode: 'C', unique: { name: 'payment_terms_code_key', column: 'code' } },
  { table: 'finance_categories', resource: 'finance-categories', label: 'Plano de contas', defaultMode: 'C', unique: { name: 'finance_categories_code_key', column: 'code' } },
  { table: 'cost_centers', resource: 'cost-centers', label: 'Centros de custo', defaultMode: 'C', unique: { name: 'cost_centers_code_key', column: 'code' } },
  { table: 'bank_accounts', resource: 'bank-accounts', label: 'Contas bancárias e caixa', defaultMode: 'E', unique: { name: 'bank_accounts_code_key', column: 'code' } },
]
export const branchTable = (table: string) => BRANCH_TABLES.find((t) => t.table === table)

// Documentos que sempre pertencem à filial que os fez.
export const BRANCH_DOCUMENTS = ['purchase_requests', 'quotations', 'purchase_orders', 'invoices', 'stock_movements', 'financial_titles', 'sales_quotes', 'sales_orders', 'sales_invoices']
export const NO_BRANCH = '00000000-0000-0000-0000-000000000000'
