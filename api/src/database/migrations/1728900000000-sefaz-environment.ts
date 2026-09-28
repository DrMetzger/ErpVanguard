import { MigrationInterface, QueryRunner } from 'typeorm'

// Ambiente da SEFAZ por certificado: homologação (testes, sem valor fiscal) ou produção.
export class SefazEnvironment1728900000000 implements MigrationInterface {
  name = 'SefazEnvironment1728900000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE certificates ADD COLUMN environment varchar(12) NOT NULL DEFAULT 'homologacao' CHECK (environment IN ('homologacao', 'producao')),
      ADD COLUMN environment_changed_at timestamptz, ADD COLUMN environment_changed_by uuid REFERENCES users(id)`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE certificates DROP COLUMN environment, DROP COLUMN environment_changed_at, DROP COLUMN environment_changed_by`)
  }
}
