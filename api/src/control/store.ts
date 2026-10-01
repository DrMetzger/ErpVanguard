import { control } from './control-config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require('pg') as { Pool: any }

// Banco do painel (vanguard_control). O usuário dele não é superusuário: não cria bancos nem mexe nos dos clientes.
export const db = new Pool({ connectionString: control.databaseUrl, max: 5 })

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows
}
export const q1 = async <T = any>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]

export async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS control_admins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(200) NOT NULL UNIQUE, name varchar(120),
      password_hash varchar(100), active boolean NOT NULL DEFAULT true, last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS control_codes (
      id bigserial PRIMARY KEY, email varchar(200) NOT NULL, purpose varchar(10) NOT NULL, code_hash varchar(64) NOT NULL,
      attempts int NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug varchar(30) NOT NULL UNIQUE, name varchar(200) NOT NULL, document varchar(14) NOT NULL,
      admin_email varchar(200) NOT NULL, admin_name varchar(120), status varchar(20) NOT NULL DEFAULT 'criando', step varchar(40),
      admin_password text, configured boolean NOT NULL DEFAULT false, setup jsonb NOT NULL DEFAULT '{}',
      running boolean, image_id varchar(100), state_at timestamptz,
      last_error text, created_by varchar(200), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS tenant_events (
      id bigserial PRIMARY KEY, tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE, kind varchar(30) NOT NULL, message text NOT NULL,
      admin_email varchar(200), created_at timestamptz NOT NULL DEFAULT now());
    -- Fila de pedidos para o agente da VPS (só ações da lista fechada).
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind varchar(20) NOT NULL CHECK (kind IN ('criar','suspender','reativar','reiniciar','atualizar','backup')),
      status varchar(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','ok','erro')),
      message text, requested_by varchar(200), created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz);
    CREATE INDEX IF NOT EXISTS agent_jobs_pending ON agent_jobs (created_at) WHERE status = 'pendente';
    CREATE TABLE IF NOT EXISTS agent_state (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), main_image varchar(100), seen_at timestamptz);
  `)
  if (control.ownerEmail) await db.query(`INSERT INTO control_admins (email, name) VALUES ($1, 'Administrador') ON CONFLICT (email) DO NOTHING`, [control.ownerEmail])
}
