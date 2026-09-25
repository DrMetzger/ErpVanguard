import { MigrationInterface, QueryRunner } from 'typeorm'

// Campos personalizados nos cadastros (valores em jsonb "custom") e ajuste dos formulários
// (esconder, reordenar e renomear campos padrão).
export const CUSTOM_TABLES = ['products', 'suppliers', 'customers', 'companies', 'product_groups', 'product_types', 'units', 'ncm', 'price_tables', 'bank_accounts', 'payment_terms']

export class CustomFields1727900000000 implements MigrationInterface {
  name = 'CustomFields1727900000000'

  async up(q: QueryRunner) {
    for (const t of CUSTOM_TABLES) await q.query(`ALTER TABLE ${t} ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'`)
    await q.query(`
      CREATE TABLE custom_fields (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        resource varchar(40) NOT NULL,
        key varchar(40) NOT NULL,
        label varchar(80) NOT NULL,
        type varchar(10) NOT NULL CHECK (type IN ('text', 'number', 'date', 'bool', 'select')),
        options text[] NOT NULL DEFAULT '{}',
        required boolean NOT NULL DEFAULT false,
        show_in_list boolean NOT NULL DEFAULT false,
        help varchar(200),
        position int NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (resource, key)
      )`)
    await q.query(`
      CREATE TABLE form_layouts (
        resource varchar(40) PRIMARY KEY,
        hidden text[] NOT NULL DEFAULT '{}',
        field_order text[] NOT NULL DEFAULT '{}',
        labels jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE form_layouts`)
    await q.query(`DROP TABLE custom_fields`)
    for (const t of CUSTOM_TABLES) await q.query(`ALTER TABLE ${t} DROP COLUMN custom`)
  }
}
