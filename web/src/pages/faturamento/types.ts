export interface SalesDocRow {
  id: string; code: string; number: number; status: string; total: number; createdAt: string; validUntil: string | null
  customerName: string; customerUf: string | null; sellerName: string; companyCode: string; paymentTerm: string; linkNumber: number | null
}
export interface ItemTaxes {
  icms: { cst: string; base: number; rate: number; value: number; reduction: number; snCredit?: number }
  st: { base: number; mva: number; rate: number; value: number } | null
  ipi: { cst: string; base: number; rate: number; value: number } | null
  fcp: { base: number; rate: number; value: number } | null
  difal: { base: number; destRate: number; interRate: number; value: number; fcpRate: number; fcpValue: number } | null
  pis: { cst: string; base: number; rate: number; value: number }
  cofins: { cst: string; base: number; rate: number; value: number }
  freight: number; discount: number; total: number; rules: string[]
  approx?: { rate: number; value: number }
}
export interface TaxTotals {
  products: number; discount: number; freight: number; icmsBase: number; icms: number; stBase: number; st: number; ipi: number
  fcp: number; difal: number; fcpDest: number; pis: number; cofins: number; snCredit: number; total: number
  approxTax?: number
}
export interface SalesOrderItem {
  id?: string; productId: string; sku: string; name: string; unit: string; stock: number; quantity: number; unitPrice: number; discountPct: number; total: number
  cfop?: string | null; tesCode?: string | null; updatesStock?: boolean | null; taxes?: ItemTaxes | null
}
export interface SalesDoc {
  id: string; code: string; number: number; status: string; total: number; freight: number; discount: number; notes: string | null; validUntil: string | null
  createdAt: string; companyId: string; companyLabel: string; companyUf: string; customerId: string; customerName: string; customerDocument: string; customerUf: string | null; customerTaxpayer: string
  sellerId: string; sellerName: string; operationTypeId: string; operationLabel: string; paymentTermId: string; paymentTerm: string; paymentDays: string
  priceTableId: string | null; priceTable: string | null; items: SalesOrderItem[]; warnings: string[]; taxes: TaxTotals | null; taxRegime: string
  invoice?: { id: string; label: string } | null; quoteId?: string | null; quoteCode?: string | null
  lostReason?: string | null; orderId?: string | null; orderCode?: string | null
  emails?: DocEmail[]
}
export interface DocEmail { id: string; to: string; cc: string | null; status: 'enviado' | 'erro'; error: string | null; sentAt: string; userName: string }
export interface SalesInvoiceRow {
  id: string; number: number; series: number; issuedAt: string; total: number; status: string; sefazStatus: string
  customerName: string; customerUf: string | null; companyCode: string; orderCode: string | null
}
export interface SalesInvoice {
  id: string; number: number; series: number; issuedAt: string; productsTotal: number; freight: number; discount: number; total: number; status: string
  sefazStatus: string; cancelReason: string | null; orderId: string | null; orderCode: string | null; operationLabel: string; companyId: string
  model: string; taxRegime: string; companyLabel: string
  customerName: string; customerDocument: string; customerIe: string | null; customerStreet: string | null; customerNumber: string | null
  customerDistrict: string | null; customerCity: string | null; customerUf: string | null; customerZip: string | null
  items: { itemNumber: number; sku: string; description: string; ncm: string | null; unit: string; cfop: string; tesCode: string; quantity: number; unitPrice: number; total: number; taxes: ItemTaxes | null }[]
  taxes: TaxTotals | null
  titles: { id: string; kind: 'R' | 'P'; docType: string; installment: number; installments: number; dueDate: string; amount: number; paidAmount: number; status: string }[]
}
export interface Readiness {
  ready: boolean; complete: boolean
  issues: { key: string; message: string; blocking: boolean; link: string }[]
  company: { id: string; label: string; regime: string; uf: string } | null
  numbering: { series: number; model: string | null; nextNumber: number | null }
}
