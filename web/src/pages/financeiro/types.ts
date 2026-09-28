export interface Title {
  id: string; kind: 'R' | 'P'; docType: 'NF' | 'NCC' | 'NDF' | 'OUT'; description: string; document: string | null; installment: number; installments: number; issueDate: string; dueDate: string
  amount: number; paidAmount: number; balance: number; status: string; notes: string | null; partner: string | null; partnerDocument: string | null
  categoryId: string | null; category: string | null; company: string | null; salesInvoiceId: string | null; invoiceId: string | null; daysOverdue: number
  costCenterId: string | null; costCenter: string | null
  payments?: Payment[]
}
export interface Payment { id: string; paidAt: string; amount: number; discount: number; interest: number; notes: string | null; bankAccount: string; userName: string | null }
export interface Summary {
  receivable: number; receivableOverdue: number; receivableWeek: number; payable: number; payableOverdue: number; payableWeek: number; cash: number
  accounts: { id: string; code: string; name: string; kind: string; balance: number }[]
}
