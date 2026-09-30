export type Permission = 'solicitante' | 'comprador' | 'aprovador' | 'cadastro' | 'fiscal' | 'vendedor' | 'faturamento' | 'financeiro' | 'bi'

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  permissions: Permission[]
  avatar: string | null
  active: boolean
}

export interface Product {
  id: string
  sku: string
  name: string
  barcode: string | null
  ncm: string | null
  unit: string
  costPrice: number
  salePrice: number
  stock: number
  minStock: number
  typeId: string | null
  groupId: string | null
  classTribId?: string | null
  typeLabel?: string | null
  groupLabel?: string | null
  origin: number
  active: boolean
  thumb?: string | null
  custom?: Record<string, unknown>
}

export interface Supplier {
  id: string
  cnpj: string
  name: string
  tradeName: string | null
  email: string | null
  phone: string | null
  city: string | null
  uf: string | null
  active: boolean
  custom?: Record<string, unknown>
}

export interface Named { id: string; name: string }

export interface PurchaseGroup {
  id: string
  name: string
  active: boolean
  approvalGroupId: string | null
  approvalGroupName: string | null
  buyers: Named[]
}

export interface ApprovalGroup {
  id: string
  name: string
  levels: { level: number; limitAmount: number | null; users: Named[] }[]
}

export interface RequestItem {
  id: string
  productId: string | null
  sku: string | null
  description: string
  unit: string
  quantity: number
  status: string
}

export interface PurchaseRequest {
  id: string
  code: string
  status: string
  neededBy: string | null
  notes: string | null
  createdAt: string
  purchaseGroupId: string
  purchaseGroupName: string
  requesterId: string
  requesterName: string
  items: RequestItem[]
}

export interface PendingItem {
  id: string
  sku: string | null
  description: string
  unit: string
  quantity: number
  requestCode: string
  requesterName: string
  purchaseGroupId: string
  purchaseGroupName: string
}

export interface QuotationSummary {
  id: string
  code: string
  status: string
  deadline: string | null
  purchaseGroupName: string
  buyerName: string
  itemCount: number
  supplierCount: number
}

export interface QuotationSupplier {
  id: string
  supplierId: string
  name: string
  paymentTerms: string | null
  deliveryDays: number | null
  freight: number
  total: number
}

export interface QuotationItem {
  id: string
  sku: string | null
  description: string
  unit: string
  quantity: number
  requestCode: string | null
  prices: { quotationSupplierId: string; unitPrice: number | null; winner: boolean }[]
}

export interface Quotation {
  id: string
  code: string
  status: string
  deadline: string | null
  purchaseGroupName: string
  buyerName: string
  suppliers: QuotationSupplier[]
  items: QuotationItem[]
}

export interface Order {
  id: string
  code: string
  number: number
  status: string
  total: number
  freight: number
  paymentTerms: string | null
  deliveryDays: number | null
  createdAt: string
  supplierName: string
  supplierCnpj: string
  purchaseGroupName: string
  buyerId: string
  buyerName: string
  quotationCode: string | null
  requiredLevels: number[]
  pendingLevel: number | null
  canApprove: boolean
}

export interface OrderDetail extends Order {
  items: { id: string; sku: string | null; description: string; unit: string; quantity: number; unitPrice: number; receivedQuantity: number; requestCode: string | null }[]
  approvals: { level: number; decision: string; comment: string | null; createdAt: string; userName: string }[]
  levels: { level: number; limitAmount: number | null; approvers: string[] }[]
}

export interface InvoiceSummary {
  id: string
  number: string
  series: string | null
  issueDate: string | null
  total: number
  status: string
  supplierName: string
  orderCode: string | null
}

export interface InvoiceItem {
  id: string
  itemNumber: number
  supplierCode: string
  ean: string | null
  description: string
  ncm: string | null
  unit: string
  quantity: number
  unitPrice: number
  productId: string | null
  productSku: string | null
  productName: string | null
  orderItemId: string | null
  matchSource: string | null
  matchNote: string | null
  tesId: string | null
  tesLabel: string | null
  entryCfop: string | null
  updatesStock: boolean | null
  generatesFinancial: boolean | null
}

export interface Invoice {
  id: string
  accessKey: string
  number: string
  series: string | null
  issueDate: string | null
  total: number
  status: string
  postedAt: string | null
  supplierName: string
  supplierCnpj: string
  supplierId: string
  recipientDocument: string | null
  companyLabel: string | null
  purchaseOrderId: string | null
  orderCode: string | null
  items: InvoiceItem[]
  warnings: string[]
  orders: { id: string; code: string; total: number }[]
  orderItems: { id: string; description: string; quantity: number; receivedQuantity: number }[]
  aiEnabled: boolean
  operationTypeId: string | null
  operationLabel: string | null
  isReturn: boolean
  customerName: string | null
  classifiedBy: string | null
  titles: { id: string; kind: 'R' | 'P'; docType: string; installment: number; installments: number; dueDate: string; amount: number; paidAmount: number; status: string }[]
  preview: { stockItems: number; financialAmount: number; financialKind: 'NCC' | 'pagar'; duplicates: number }
}

export interface Notice {
  id: string
  kind: 'aprovacao' | 'cotacao' | 'nota' | 'solicitacao' | 'reprovado' | 'certificado'
  title: string
  description: string
  link: string
  createdAt: string
}

export type FieldType = 'text' | 'int' | 'decimal' | 'bool' | 'date' | 'enum' | 'ref' | 'uf' | 'document' | 'phone' | 'zip' | 'city' | 'ie' | 'json'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  max?: number
  pattern?: string
  patternMessage?: string
  upper?: boolean
  options?: { value: string; label: string }[]
  ref?: string
  list?: boolean
  default?: string | number | boolean
  help?: string
  span?: 1 | 2 | 3
  hidden?: boolean
}

export interface ResourceMeta {
  name: string
  module: string
  title: string
  singular: string
  description: string
  customizable?: boolean
  write: Permission[]
  fields: FieldDef[]
}

export type CatalogRow = Record<string, unknown> & { id: string }
