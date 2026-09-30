import { MigrationInterface, QueryRunner } from 'typeorm'
import { BRANCH_DOCUMENTS, BRANCH_TABLES, NO_BRANCH } from '../../branches/branch-tables'

// Filiais: cadastros compartilhados ou exclusivos por filial, documentos sempre na filial que os fez
// e usuário amarrado às filiais liberadas para ele.
export class Branches1729500000000 implements MigrationInterface {
  name = 'Branches1729500000000'

  async up(q: QueryRunner) {
    const head = (await q.query(`SELECT id FROM companies WHERE is_head LIMIT 1`))[0]?.id
      ?? (await q.query(`SELECT id FROM companies ORDER BY code LIMIT 1`))[0]?.id ?? null

    await q.query(`CREATE TABLE branch_modes (tbl varchar(40) PRIMARY KEY, mode char(1) NOT NULL CHECK (mode IN ('C', 'E')), updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
    for (const t of BRANCH_TABLES) {
      await q.query(`INSERT INTO branch_modes (tbl, mode) VALUES ($1, $2)`, [t.table, t.defaultMode])
      await q.query(`ALTER TABLE ${t.table} ADD COLUMN branch_id uuid REFERENCES companies(id)`)
      await q.query(`CREATE INDEX ${t.table}_branch ON ${t.table} (branch_id)`)
      // Código único dentro da filial (ou entre os compartilhados); o nome do índice é o da antiga restrição.
      if (t.unique) {
        await q.query(`ALTER TABLE ${t.table} DROP CONSTRAINT ${t.unique.name}`)
        await q.query(`CREATE UNIQUE INDEX ${t.unique.name} ON ${t.table} ((coalesce(branch_id, '${NO_BRANCH}'::uuid)), ${t.unique.column})`)
      }
      // Exclusivos: o que já existe fica na matriz.
      if (t.defaultMode === 'E' && head) await q.query(`UPDATE ${t.table} SET branch_id = $1`, [head])
    }

    for (const t of BRANCH_DOCUMENTS) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id)`)
      if (head) await q.query(`UPDATE ${t} SET company_id = $1 WHERE company_id IS NULL`, [head])
      await q.query(`CREATE INDEX IF NOT EXISTS ${t}_company ON ${t} (company_id)`)
    }

    // Estoque por filial: saldo e custo médio de cada produto em cada filial. products.stock vira o total (soma).
    await q.query(`
      CREATE TABLE product_stock (
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        quantity numeric(14,4) NOT NULL DEFAULT 0,
        avg_cost numeric(14,4) NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (product_id, company_id)
      )`)
    await q.query(`CREATE INDEX product_stock_company ON product_stock (company_id)`)
    if (head) await q.query(`INSERT INTO product_stock (product_id, company_id, quantity, avg_cost) SELECT id, $1, stock, cost_price FROM products`, [head])
    await q.query(`
      CREATE OR REPLACE FUNCTION product_stock_total() RETURNS trigger AS $$
      DECLARE pid uuid := coalesce(NEW.product_id, OLD.product_id);
      BEGIN
        UPDATE products SET stock = (SELECT coalesce(sum(quantity), 0) FROM product_stock WHERE product_id = pid) WHERE id = pid;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`)
    await q.query(`CREATE TRIGGER product_stock_total AFTER INSERT OR UPDATE OR DELETE ON product_stock FOR EACH ROW EXECUTE FUNCTION product_stock_total()`)

    await q.query(`ALTER TABLE users ADD COLUMN branch_ids uuid[] NOT NULL DEFAULT '{}', ADD COLUMN default_branch_id uuid REFERENCES companies(id) ON DELETE SET NULL`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE product_stock`)
    await q.query(`DROP FUNCTION IF EXISTS product_stock_total()`)
    await q.query(`ALTER TABLE users DROP COLUMN branch_ids, DROP COLUMN default_branch_id`)
    for (const t of BRANCH_TABLES) {
      if (t.unique) {
        await q.query(`DROP INDEX ${t.unique.name}`)
        await q.query(`ALTER TABLE ${t.table} ADD CONSTRAINT ${t.unique.name} UNIQUE (${t.unique.column})`)
      }
      await q.query(`ALTER TABLE ${t.table} DROP COLUMN branch_id`)
    }
    await q.query(`DROP TABLE branch_modes`)
  }
}
