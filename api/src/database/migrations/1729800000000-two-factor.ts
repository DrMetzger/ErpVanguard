import { MigrationInterface, QueryRunner } from 'typeorm'

// Login em duas etapas obrigatório: senha + código de 6 números por e-mail.
export class TwoFactor1729800000000 implements MigrationInterface {
  name = 'TwoFactor1729800000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE login_codes (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash varchar(64) NOT NULL,
        attempts int NOT NULL DEFAULT 0,
        used boolean NOT NULL DEFAULT false,
        ip varchar(60),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX login_codes_user ON login_codes (user_id, created_at DESC);
      ALTER TABLE users ADD COLUMN last_login_at timestamptz;
      -- E-mail que recebe o código (vazio = o próprio e-mail de login).
      ALTER TABLE users ADD COLUMN two_factor_email varchar(200);
    `)
    // O administrador inicial do ambiente da Prime ERP usava um e-mail que não existe: passa para o do responsável.
    await q.query(`UPDATE users SET email = 'kleber.farias@primeerp.com.br'
      WHERE email = 'admin@erpvanguard.com.br' AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'kleber.farias@primeerp.com.br')`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE login_codes; ALTER TABLE users DROP COLUMN last_login_at, DROP COLUMN two_factor_email`)
  }
}
