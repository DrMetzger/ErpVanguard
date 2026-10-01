import { MigrationInterface, QueryRunner } from 'typeorm'

// Marketplaces: anúncio ↔ produto (preço e estoque sincronizados) e vendas importadas como pedido.
export class Marketplace1729700000000 implements MigrationInterface {
  name = 'Marketplace1729700000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE marketplace_listings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(20) NOT NULL,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        external_id varchar(60) NOT NULL,
        title varchar(300),
        permalink varchar(500),
        status varchar(30),
        price numeric(14,2),
        quantity numeric(14,4),
        synced_at timestamptz,
        sync_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, external_id)
      )`)
    await q.query(`CREATE INDEX marketplace_listings_product ON marketplace_listings (product_id)`)
    await q.query(`
      CREATE TABLE marketplace_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(20) NOT NULL,
        external_id varchar(60) NOT NULL,
        status varchar(30) NOT NULL,
        sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
        buyer varchar(200),
        total numeric(14,2),
        error text,
        raw jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, external_id)
      )`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE marketplace_orders`)
    await q.query(`DROP TABLE marketplace_listings`)
  }
}
