export interface SalesOrderRow {
  id: string; code: string; number: number; status: string; total: number; createdAt: string; validUntil: string | null
  customerName: string; customerUf: string | null; sellerName: string; companyCode: string; paymentTerm: string; itemCount: number; invoiceNumber: number | null
}
export interface SalesOrderItem {
  id?: string; productId: string; sku: string; name: string; unit: string; stock: number; quantity: number; unitPrice: number; discountPct: number; total: number
  cfop?: string | null; tesCode?: string | null; updatesStock?: boolean | null
}
export interface SalesOrder {
  id: string; code: string; number: number; status: string; total: number; freight: number; discount: number; notes: string | null; validUntil: string | null
  createdAt: string; companyId: string; companyLabel: string; companyUf: string; customerId: string; customerName: string; customerDocument: string; customerUf: string | null
  sellerId: string; sellerName: string; operationTypeId: string; operationLabel: string; paymentTermId: string; paymentTerm: string; paymentDays: string
  priceTableId: string | null; priceTable: string | null; items: SalesOrderItem[]; invoice: { id: string; label: string } | null; warnings: string[]
}
export interface SalesInvoiceRow {
  id: string; number: number; series: number; issuedAt: string; total: number; status: string; sefazStatus: string
  customerName: string; customerUf: string | null; companyCode: string; orderCode: string | null
}
export interface SalesInvoice {
  id: string; number: number; series: number; issuedAt: string; productsTotal: number; freight: number; discount: number; total: number; status: string
  sefazStatus: string; cancelReason: string | null; orderId: string | null; orderCode: string | null; operationLabel: string; companyId: string
  customerName: string; customerDocument: string; customerIe: string | null; customerStreet: string | null; customerNumber: string | null
  customerDistrict: string | null; customerCity: string | null; customerUf: string | null; customerZip: string | null
  items: { itemNumber: number; sku: string; description: string; ncm: string | null; unit: string; cfop: string; tesCode: string; quantity: number; unitPrice: number; total: number }[]
  titles: { id: string; installment: number; installments: number; dueDate: string; amount: number; paidAmount: number; status: string }[]
}
