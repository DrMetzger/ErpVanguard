import { MigrationInterface, QueryRunner } from 'typeorm'

// Bloqueio de aparelho pelo administrador (corta o acesso daquele celular).
export class DeviceBlock1729200000000 implements MigrationInterface {
  name = 'DeviceBlock1729200000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE devices ADD COLUMN blocked boolean NOT NULL DEFAULT false, ADD COLUMN blocked_reason varchar(200),
      ADD COLUMN blocked_at timestamptz, ADD COLUMN blocked_by uuid REFERENCES users(id) ON DELETE SET NULL`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE devices DROP COLUMN blocked, DROP COLUMN blocked_reason, DROP COLUMN blocked_at, DROP COLUMN blocked_by`)
  }
}
