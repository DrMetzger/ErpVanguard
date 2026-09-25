import { MigrationInterface, QueryRunner } from 'typeorm'

// Orçamento separado do pedido de venda: orçamento (aberto → ganho/perdido) gera o pedido;
// o pedido (aberto → faturado/cancelado) é o que fatura.
export class SalesQuotes1728100000000 implements MigrationInterface {
  name = 'SalesQuotes1728100000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE sales_quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number serial UNIQUE,
        company_id uuid NOT NULL REFERENCES companies(id),
        customer_id uuid NOT NULL REFERENCES customers(id),
        seller_id uuid NOT NULL REFERENCES users(id),
        operation_type_id uuid NOT NULL REFERENCES operation_types(id),
        payment_term_id uuid NOT NULL REFERENCES payment_terms(id),
        price_table_id uuid REFERENCES price_tables(id),
        status varchar(10) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'ganho', 'perdido')),
        valid_until date,
        freight numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
        discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
        total numeric(14,2) NOT NULL DEFAULT 0,
        taxes jsonb,
        notes text,
        lost_reason varchar(300),
        closed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE sales_quote_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
        unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
        discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
        total numeric(14,2) NOT NULL,
        tes_id uuid REFERENCES tes(id),
        cfop varchar(4),
        taxes jsonb,
        position int NOT NULL DEFAULT 0
      )`)
    await q.query(`ALTER TABLE sales_orders ADD COLUMN quote_id uuid REFERENCES sales_quotes(id)`)

    // Orçamentos que estavam como pedido viram orçamento de verdade.
    const old = await q.query(`SELECT * FROM sales_orders WHERE status = 'orcamento'`)
    for (const o of old) {
      const [row] = await q.query(
        `INSERT INTO sales_quotes (company_id, customer_id, seller_id, operation_type_id, payment_term_id, price_table_id, valid_until, freight, discount, total, taxes, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [o.company_id, o.customer_id, o.seller_id, o.operation_type_id, o.payment_term_id, o.price_table_id, o.valid_until, o.freight, o.discount, o.total, o.taxes, o.notes, o.created_at],
      )
      await q.query(
        `INSERT INTO sales_quote_items (quote_id, product_id, quantity, unit_price, discount_pct, total, tes_id, cfop, taxes, position)
         SELECT $1, product_id, quantity, unit_price, discount_pct, total, tes_id, cfop, taxes, position FROM sales_order_items WHERE order_id = $2`,
        [row.id, o.id],
      )
      await q.query(`DELETE FROM sales_orders WHERE id = $1`, [o.id])
    }
    await q.query(`ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check`)
    await q.query(`UPDATE sales_orders SET status = 'aberto' WHERE status = 'aprovado'`)
    await q.query(`ALTER TABLE sales_orders ALTER COLUMN status SET DEFAULT 'aberto'`)
    await q.query(`ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('aberto', 'faturado', 'cancelado'))`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_status_check`)
    await q.query(`UPDATE sales_orders SET status = 'aprovado' WHERE status = 'aberto'`)
    await q.query(`ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN ('orcamento', 'aprovado', 'faturado', 'cancelado'))`)
    await q.query(`ALTER TABLE sales_orders DROP COLUMN quote_id`)
    await q.query(`DROP TABLE sales_quote_items`)
    await q.query(`DROP TABLE sales_quotes`)
  }
}
