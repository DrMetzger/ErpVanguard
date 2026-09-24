import { MigrationInterface, QueryRunner } from 'typeorm'

export class Initial1727200000000 implements MigrationInterface {
  name = 'Initial1727200000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        email varchar NOT NULL UNIQUE,
        password_hash varchar NOT NULL,
        role varchar NOT NULL DEFAULT 'user',
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        barcode varchar,
        ncm varchar(8),
        unit varchar NOT NULL DEFAULT 'UN',
        cost_price numeric(14,4) NOT NULL DEFAULT 0,
        sale_price numeric(14,4) NOT NULL DEFAULT 0,
        stock numeric(14,4) NOT NULL DEFAULT 0,
        min_stock numeric(14,4) NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX products_name_idx ON products (lower(name))`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE products`)
    await q.query(`DROP TABLE users`)
  }
}
