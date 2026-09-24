import { MigrationInterface, QueryRunner } from 'typeorm'

// Módulo de Compras: fornecedores, grupos de compras, alçadas de aprovação,
// solicitações, cotações, pedidos e entrada de notas fiscais (XML).
export class Purchasing1727300000000 implements MigrationInterface {
  name = 'Purchasing1727300000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE users ADD COLUMN permissions text[] NOT NULL DEFAULT '{}'`)

    await q.query(`
      CREATE TABLE suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cnpj varchar(14) NOT NULL UNIQUE,
        name varchar NOT NULL,
        trade_name varchar,
        email varchar,
        phone varchar,
        city varchar,
        uf varchar(2),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)

    // Amarração produto x fornecedor, aprendida nas entradas de nota.
    await q.query(`
      CREATE TABLE supplier_products (
        supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        supplier_code varchar NOT NULL,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        PRIMARY KEY (supplier_id, supplier_code)
      )`)

    await q.query(`
      CREATE TABLE approval_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE approval_levels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id uuid NOT NULL REFERENCES approval_groups(id) ON DELETE CASCADE,
        level int NOT NULL,
        limit_amount numeric(14,2),
        UNIQUE (group_id, level)
      )`)
    await q.query(`
      CREATE TABLE approval_level_members (
        level_id uuid NOT NULL REFERENCES approval_levels(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (level_id, user_id)
      )`)

    await q.query(`
      CREATE TABLE purchase_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        approval_group_id uuid REFERENCES approval_groups(id) ON DELETE SET NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE purchase_group_members (
        group_id uuid NOT NULL REFERENCES purchase_groups(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, user_id)
      )`)

    await q.query(`
      CREATE TABLE purchase_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number serial UNIQUE,
        requester_id uuid NOT NULL REFERENCES users(id),
        purchase_group_id uuid NOT NULL REFERENCES purchase_groups(id),
        status varchar NOT NULL DEFAULT 'aberta',
        needed_by date,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE purchase_request_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        product_id uuid REFERENCES products(id),
        description varchar NOT NULL,
        unit varchar NOT NULL DEFAULT 'UN',
        quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
        status varchar NOT NULL DEFAULT 'pendente'
      )`)

    await q.query(`
      CREATE TABLE quotations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number serial UNIQUE,
        purchase_group_id uuid NOT NULL REFERENCES purchase_groups(id),
        buyer_id uuid NOT NULL REFERENCES users(id),
        status varchar NOT NULL DEFAULT 'aberta',
        deadline date,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE quotation_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        request_item_id uuid REFERENCES purchase_request_items(id),
        product_id uuid REFERENCES products(id),
        description varchar NOT NULL,
        unit varchar NOT NULL,
        quantity numeric(14,4) NOT NULL
      )`)
    await q.query(`
      CREATE TABLE quotation_suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        payment_terms varchar,
        delivery_days int,
        freight numeric(14,2) NOT NULL DEFAULT 0,
        notes text,
        UNIQUE (quotation_id, supplier_id)
      )`)
    await q.query(`
      CREATE TABLE quotation_prices (
        quotation_item_id uuid NOT NULL REFERENCES quotation_items(id) ON DELETE CASCADE,
        quotation_supplier_id uuid NOT NULL REFERENCES quotation_suppliers(id) ON DELETE CASCADE,
        unit_price numeric(14,4),
        winner boolean NOT NULL DEFAULT false,
        PRIMARY KEY (quotation_item_id, quotation_supplier_id)
      )`)

    await q.query(`
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number serial UNIQUE,
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        purchase_group_id uuid NOT NULL REFERENCES purchase_groups(id),
        quotation_id uuid REFERENCES quotations(id),
        buyer_id uuid NOT NULL REFERENCES users(id),
        status varchar NOT NULL,
        payment_terms varchar,
        delivery_days int,
        freight numeric(14,2) NOT NULL DEFAULT 0,
        total numeric(14,2) NOT NULL,
        required_levels int[] NOT NULL DEFAULT '{}',
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE purchase_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        request_item_id uuid REFERENCES purchase_request_items(id),
        product_id uuid REFERENCES products(id),
        description varchar NOT NULL,
        unit varchar NOT NULL,
        quantity numeric(14,4) NOT NULL,
        unit_price numeric(14,4) NOT NULL,
        received_quantity numeric(14,4) NOT NULL DEFAULT 0
      )`)
    await q.query(`
      CREATE TABLE purchase_order_approvals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        level int NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id),
        decision varchar NOT NULL,
        comment text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)

    await q.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        access_key varchar(44) NOT NULL UNIQUE,
        number varchar NOT NULL,
        series varchar,
        issue_date timestamptz,
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        purchase_order_id uuid REFERENCES purchase_orders(id),
        total numeric(14,2) NOT NULL,
        status varchar NOT NULL DEFAULT 'pendente',
        xml text NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id),
        posted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        item_number int NOT NULL,
        supplier_code varchar,
        ean varchar,
        description varchar NOT NULL,
        ncm varchar,
        cfop varchar,
        unit varchar,
        quantity numeric(14,4) NOT NULL,
        unit_price numeric(14,6) NOT NULL,
        total numeric(14,2) NOT NULL,
        product_id uuid REFERENCES products(id),
        order_item_id uuid REFERENCES purchase_order_items(id),
        match_source varchar,
        match_note text
      )`)

    await q.query(`
      CREATE TABLE stock_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id),
        quantity numeric(14,4) NOT NULL,
        unit_cost numeric(14,6),
        kind varchar NOT NULL,
        reference varchar,
        user_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
  }

  async down(q: QueryRunner) {
    for (const t of [
      'stock_movements', 'invoice_items', 'invoices', 'purchase_order_approvals', 'purchase_order_items',
      'purchase_orders', 'quotation_prices', 'quotation_suppliers', 'quotation_items', 'quotations',
      'purchase_request_items', 'purchase_requests', 'purchase_group_members', 'purchase_groups',
      'approval_level_members', 'approval_levels', 'approval_groups', 'supplier_products', 'suppliers',
    ]) {
      await q.query(`DROP TABLE ${t}`)
    }
    await q.query(`ALTER TABLE users DROP COLUMN permissions`)
  }
}
