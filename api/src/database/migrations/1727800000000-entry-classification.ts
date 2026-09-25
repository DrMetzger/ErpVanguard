import { MigrationInterface, QueryRunner } from 'typeorm'

// Documento de entrada em duas etapas: pré-nota (XML importado, nada movimentado) e
// classificação fiscal (tipo de operação + TES por item). A TES decide estoque e financeiro.
// Devoluções geram títulos de crédito: NCC (crédito do cliente, no contas a receber) e
// NDF (débito do fornecedor, no contas a pagar).
export class EntryClassification1727800000000 implements MigrationInterface {
  name = 'EntryClassification1727800000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE operation_types ADD COLUMN is_return boolean NOT NULL DEFAULT false`)
    await q.query(`UPDATE operation_types SET is_return = true WHERE code IN ('E05', 'S03')`)
    // Devoluções passam a gerar o título de crédito (NCC/NDF).
    await q.query(`UPDATE tes SET generates_financial = true WHERE code IN ('004', '503')`)

    await q.query(`ALTER TABLE invoices ADD COLUMN operation_type_id uuid REFERENCES operation_types(id)`)
    await q.query(`ALTER TABLE invoices ADD COLUMN customer_id uuid REFERENCES customers(id)`)
    await q.query(`ALTER TABLE invoices ADD COLUMN classified_by uuid REFERENCES users(id)`)
    await q.query(`UPDATE invoices SET status = 'pre_nota' WHERE status = 'pendente'`)
    await q.query(`UPDATE invoices SET status = 'classificada' WHERE status = 'lancada'`)
    await q.query(`ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'pre_nota'`)
    await q.query(`ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('pre_nota', 'classificada'))`)
    await q.query(`ALTER TABLE invoice_items ADD COLUMN tes_id uuid REFERENCES tes(id)`)
    await q.query(`ALTER TABLE invoice_items ADD COLUMN entry_cfop varchar(4)`)

    await q.query(`ALTER TABLE financial_titles ADD COLUMN doc_type varchar(3) NOT NULL DEFAULT 'NF' CHECK (doc_type IN ('NF', 'NCC', 'NDF', 'OUT'))`)
    await q.query(`UPDATE financial_titles SET doc_type = 'OUT' WHERE sales_invoice_id IS NULL AND invoice_id IS NULL`)
    await q.query(`ALTER TABLE financial_titles ALTER COLUMN doc_type SET DEFAULT 'OUT'`)
    await q.query(`INSERT INTO finance_categories (code, name, kind) VALUES ('1.04', 'Devoluções de compras (crédito do fornecedor)', 'R'), ('2.08', 'Devoluções de vendas (crédito do cliente)', 'D') ON CONFLICT (code) DO NOTHING`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE financial_titles DROP COLUMN doc_type`)
    await q.query(`ALTER TABLE invoice_items DROP COLUMN entry_cfop, DROP COLUMN tes_id`)
    await q.query(`ALTER TABLE invoices DROP CONSTRAINT invoices_status_check`)
    await q.query(`UPDATE invoices SET status = CASE status WHEN 'pre_nota' THEN 'pendente' ELSE 'lancada' END`)
    await q.query(`ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'pendente'`)
    await q.query(`ALTER TABLE invoices DROP COLUMN classified_by, DROP COLUMN customer_id, DROP COLUMN operation_type_id`)
    await q.query(`ALTER TABLE operation_types DROP COLUMN is_return`)
  }
}
