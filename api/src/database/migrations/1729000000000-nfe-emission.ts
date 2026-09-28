import { MigrationInterface, QueryRunner } from 'typeorm'

// Emissão da NF-e própria: chave, ambiente, retorno da SEFAZ, protocolo e XMLs na nota de venda,
// e o histórico de tudo que foi para a SEFAZ (transmissão, consulta, cancelamento, CC-e, inutilização).
export class NfeEmission1729000000000 implements MigrationInterface {
  name = 'NfeEmission1729000000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE sales_invoices ALTER COLUMN sefaz_status SET DEFAULT 'pendente'`)
    await q.query(`UPDATE sales_invoices SET sefaz_status = 'pendente' WHERE sefaz_status IS NULL OR sefaz_status NOT IN ('pendente', 'autorizada', 'rejeitada', 'denegada', 'cancelada', 'erro')`)
    await q.query(`ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_sefaz_status CHECK (sefaz_status IN ('pendente', 'autorizada', 'rejeitada', 'denegada', 'cancelada', 'erro'))`)
    await q.query(`ALTER TABLE sales_invoices ADD COLUMN access_key char(44), ADD COLUMN environment varchar(12) CHECK (environment IN ('homologacao', 'producao')),
      ADD COLUMN sefaz_code varchar(4), ADD COLUMN sefaz_message text, ADD COLUMN protocol varchar(20), ADD COLUMN authorized_at timestamptz,
      ADD COLUMN nfe_issued_at timestamptz, ADD COLUMN xml text, ADD COLUMN xml_proc text, ADD COLUMN sent_at timestamptz`)
    await q.query(`CREATE UNIQUE INDEX sales_invoices_access_key ON sales_invoices (access_key) WHERE access_key IS NOT NULL`)
    await q.query(`
      CREATE TABLE nfe_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid REFERENCES sales_invoices(id) ON DELETE CASCADE,
        company_id uuid NOT NULL REFERENCES companies(id),
        type varchar(14) NOT NULL CHECK (type IN ('transmissao', 'consulta', 'cancelamento', 'cce', 'inutilizacao', 'status')),
        environment varchar(12) NOT NULL,
        sequence int,
        series int,
        number_from int,
        number_to int,
        text text,
        request_xml text,
        response_xml text,
        status_code varchar(4),
        message text,
        protocol varchar(20),
        success boolean NOT NULL DEFAULT false,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX nfe_events_invoice ON nfe_events (invoice_id, created_at)`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE nfe_events`)
    await q.query(`DROP INDEX sales_invoices_access_key`)
    await q.query(`ALTER TABLE sales_invoices DROP COLUMN access_key, DROP COLUMN environment, DROP COLUMN sefaz_code, DROP COLUMN sefaz_message, DROP COLUMN protocol,
      DROP COLUMN authorized_at, DROP COLUMN nfe_issued_at, DROP COLUMN xml, DROP COLUMN xml_proc, DROP COLUMN sent_at`)
    await q.query(`ALTER TABLE sales_invoices DROP CONSTRAINT sales_invoices_sefaz_status`)
    await q.query(`UPDATE sales_invoices SET sefaz_status = 'nao_transmitida' WHERE sefaz_status = 'pendente'`)
    await q.query(`ALTER TABLE sales_invoices ALTER COLUMN sefaz_status SET DEFAULT 'nao_transmitida'`)
  }
}
