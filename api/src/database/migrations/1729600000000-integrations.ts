import { MigrationInterface, QueryRunner } from 'typeorm'

// Integrações (WhatsApp, Mercado Livre, Shopee, Magalu): configuração com chaves criptografadas e histórico.
export class Integrations1729600000000 implements MigrationInterface {
  name = 'Integrations1729600000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE integrations (
        provider varchar(20) PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false,
        config jsonb NOT NULL DEFAULT '{}',
        secrets jsonb NOT NULL DEFAULT '{}',
        status varchar(20) NOT NULL DEFAULT 'desconectado',
        last_error text,
        checked_at timestamptz,
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE integration_logs (
        id bigserial PRIMARY KEY,
        provider varchar(20) NOT NULL,
        direction varchar(3) NOT NULL CHECK (direction IN ('out', 'in')),
        kind varchar(40) NOT NULL,
        external_id varchar(200),
        status varchar(20) NOT NULL,
        target varchar(200),
        doc_kind varchar(20),
        doc_id uuid,
        summary text,
        error text,
        payload jsonb,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX integration_logs_provider ON integration_logs (provider, created_at DESC)`)
    await q.query(`CREATE INDEX integration_logs_external ON integration_logs (provider, external_id)`)
    await q.query(`CREATE INDEX integration_logs_doc ON integration_logs (doc_kind, doc_id)`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE integration_logs`)
    await q.query(`DROP TABLE integrations`)
  }
}
