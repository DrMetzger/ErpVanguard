import { MigrationInterface, QueryRunner } from 'typeorm'

// Sincronização do app do celular: cada cadastro guarda quando mudou (updated_at) e as exclusões ficam registradas,
// para o aparelho baixar só o que mudou desde a última vez.
const TABLES = ['products', 'customers', 'suppliers', 'payment_terms', 'price_tables', 'units', 'product_groups', 'product_types', 'operation_types', 'cost_centers', 'companies']

export class Sync1729300000000 implements MigrationInterface {
  name = 'Sync1729300000000'

  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE sync_deletions (id bigserial PRIMARY KEY, tbl varchar(40) NOT NULL, row_key text NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now())`)
    await q.query(`CREATE INDEX sync_deletions_tbl_at ON sync_deletions (tbl, deleted_at)`)
    await q.query(`CREATE OR REPLACE FUNCTION sync_touch() RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql`)
    await q.query(`CREATE OR REPLACE FUNCTION sync_deleted() RETURNS trigger AS $$ BEGIN INSERT INTO sync_deletions (tbl, row_key) VALUES (TG_TABLE_NAME, OLD.id::text); RETURN OLD; END $$ LANGUAGE plpgsql`)
    await q.query(`CREATE OR REPLACE FUNCTION sync_deleted_price_item() RETURNS trigger AS $$ BEGIN INSERT INTO sync_deletions (tbl, row_key) VALUES (TG_TABLE_NAME, OLD.price_table_id::text || ':' || OLD.product_id::text); RETURN OLD; END $$ LANGUAGE plpgsql`)
    for (const t of [...TABLES, 'price_table_items']) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`)
      await q.query(`CREATE INDEX IF NOT EXISTS ${t}_updated_at ON ${t} (updated_at)`)
      await q.query(`CREATE TRIGGER ${t}_sync_touch BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION sync_touch()`)
      await q.query(`CREATE TRIGGER ${t}_sync_deleted AFTER DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t === 'price_table_items' ? 'sync_deleted_price_item' : 'sync_deleted'}()`)
    }
  }

  async down(q: QueryRunner) {
    for (const t of [...TABLES, 'price_table_items']) {
      await q.query(`DROP TRIGGER IF EXISTS ${t}_sync_touch ON ${t}`)
      await q.query(`DROP TRIGGER IF EXISTS ${t}_sync_deleted ON ${t}`)
    }
    await q.query(`DROP FUNCTION IF EXISTS sync_touch(); DROP FUNCTION IF EXISTS sync_deleted(); DROP FUNCTION IF EXISTS sync_deleted_price_item()`)
    await q.query(`DROP TABLE sync_deletions`)
  }
}
