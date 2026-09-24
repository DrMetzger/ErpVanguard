import { MigrationInterface, QueryRunner } from 'typeorm'

// Certificado digital A1 (.pfx) por empresa/filial (arquivo e senha criptografados) e logo para DANFE e relatórios.
export class Certificates1727600000000 implements MigrationInterface {
  name = 'Certificates1727600000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE certificates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        subject varchar NOT NULL,
        holder_document varchar(14) NOT NULL,
        issuer varchar,
        serial varchar,
        thumbprint varchar(64) NOT NULL,
        valid_from timestamptz NOT NULL,
        valid_to timestamptz NOT NULL,
        pfx jsonb NOT NULL,
        password jsonb NOT NULL,
        active boolean NOT NULL DEFAULT true,
        uploaded_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE UNIQUE INDEX certificates_one_active ON certificates (company_id) WHERE active`)
    await q.query(`ALTER TABLE companies ADD COLUMN logo text`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE companies DROP COLUMN logo`)
    await q.query(`DROP TABLE certificates`)
  }
}
