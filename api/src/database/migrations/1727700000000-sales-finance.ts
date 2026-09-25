import { MigrationInterface, QueryRunner } from 'typeorm'

// Faturamento (orçamentos, pedidos de venda e notas de saída) e Financeiro
// (contas a pagar/receber, baixas, contas bancárias, plano de contas e condições de pagamento).
export class SalesFinance1727700000000 implements MigrationInterface {
  name = 'SalesFinance1727700000000'

  async up(q: QueryRunner) {
    // ---- Cadastros do financeiro
    await q.query(`
      CREATE TABLE payment_terms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(6) NOT NULL UNIQUE,
        name varchar NOT NULL,
        days varchar(60) NOT NULL,
        active boolean NOT NULL DEFAULT true
      )`)
    const terms = [['AV', 'À vista', '0'], ['28', '28 dias', '28'], ['30', '30 dias', '30'], ['3060', '30/60 dias', '30/60'], ['306090', '30/60/90 dias', '30/60/90']]
    for (const [code, name, days] of terms) await q.query(`INSERT INTO payment_terms (code, name, days) VALUES ($1, $2, $3)`, [code, name, days])

    await q.query(`
      CREATE TABLE finance_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(10) NOT NULL UNIQUE,
        name varchar NOT NULL,
        kind varchar(1) NOT NULL CHECK (kind IN ('R', 'D')),
        active boolean NOT NULL DEFAULT true
      )`)
    const categories = [
      ['1.01', 'Venda de mercadorias', 'R'], ['1.02', 'Prestação de serviços', 'R'], ['1.03', 'Vendas nos marketplaces', 'R'], ['1.99', 'Outras receitas', 'R'],
      ['2.01', 'Compra de mercadorias', 'D'], ['2.02', 'Despesas administrativas', 'D'], ['2.03', 'Salários e encargos', 'D'], ['2.04', 'Impostos', 'D'],
      ['2.05', 'Aluguel e condomínio', 'D'], ['2.06', 'Fretes', 'D'], ['2.07', 'Tarifas bancárias', 'D'], ['2.99', 'Outras despesas', 'D'],
    ]
    for (const [code, name, kind] of categories) await q.query(`INSERT INTO finance_categories (code, name, kind) VALUES ($1, $2, $3)`, [code, name, kind])

    await q.query(`
      CREATE TABLE bank_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(6) NOT NULL UNIQUE,
        name varchar NOT NULL,
        kind varchar(10) NOT NULL DEFAULT 'banco' CHECK (kind IN ('caixa', 'banco')),
        bank_code varchar(3),
        bank varchar(60),
        agency varchar(10),
        agency_digit varchar(2),
        account varchar(20),
        account_digit varchar(2),
        opening_balance numeric(14,2) NOT NULL DEFAULT 0,
        -- Parâmetros de cobrança (boleto/CNAB)
        cnab_layout varchar(3) CHECK (cnab_layout IN ('240', '400')),
        wallet varchar(5),
        agreement varchar(20),
        beneficiary_code varchar(20),
        next_our_number bigint NOT NULL DEFAULT 1,
        next_remittance int NOT NULL DEFAULT 1,
        fine_pct numeric(5,2) NOT NULL DEFAULT 0,
        interest_month_pct numeric(5,2) NOT NULL DEFAULT 0,
        protest_days int,
        instructions varchar(240),
        active boolean NOT NULL DEFAULT true
      )`)
    await q.query(`INSERT INTO bank_accounts (code, name, kind) VALUES ('CX', 'Caixa da empresa', 'caixa')`)

    // Regras básicas da matriz fiscal, para cada operação que ainda não tem nenhuma (ajustar com a contabilidade).
    const rules = [['S01', '501'], ['S02', '501'], ['S03', '503'], ['S04', '504'], ['E01', '001'], ['E03', '002'], ['E04', '003'], ['E05', '004']]
    for (const [operation, tes] of rules) {
      await q.query(
        `INSERT INTO fiscal_matrix (operation_type_id, tes_id, notes)
         SELECT o.id, t.id, 'Regra padrão ' || o.name FROM operation_types o, tes t
         WHERE o.code = $1 AND t.code = $2 AND NOT EXISTS (SELECT 1 FROM fiscal_matrix m WHERE m.operation_type_id = o.id)`,
        [operation, tes],
      )
    }

    // ---- Faturamento
    await q.query(`
      CREATE TABLE sales_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        number serial UNIQUE,
        company_id uuid NOT NULL REFERENCES companies(id),
        customer_id uuid NOT NULL REFERENCES customers(id),
        seller_id uuid NOT NULL REFERENCES users(id),
        operation_type_id uuid NOT NULL REFERENCES operation_types(id),
        payment_term_id uuid NOT NULL REFERENCES payment_terms(id),
        price_table_id uuid REFERENCES price_tables(id),
        status varchar(12) NOT NULL DEFAULT 'orcamento' CHECK (status IN ('orcamento', 'aprovado', 'faturado', 'cancelado')),
        valid_until date,
        freight numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
        discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
        total numeric(14,2) NOT NULL DEFAULT 0,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE sales_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
        unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
        discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
        total numeric(14,2) NOT NULL,
        tes_id uuid REFERENCES tes(id),
        cfop varchar(4),
        position int NOT NULL DEFAULT 0
      )`)
    await q.query(`
      CREATE TABLE sales_invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES companies(id),
        series int NOT NULL DEFAULT 1,
        number int NOT NULL,
        order_id uuid REFERENCES sales_orders(id),
        customer_id uuid NOT NULL REFERENCES customers(id),
        operation_type_id uuid NOT NULL REFERENCES operation_types(id),
        issued_at timestamptz NOT NULL DEFAULT now(),
        products_total numeric(14,2) NOT NULL,
        freight numeric(14,2) NOT NULL DEFAULT 0,
        discount numeric(14,2) NOT NULL DEFAULT 0,
        total numeric(14,2) NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida', 'cancelada')),
        sefaz_status varchar(20) NOT NULL DEFAULT 'nao_transmitida',
        cancel_reason text,
        created_by uuid REFERENCES users(id),
        UNIQUE (company_id, series, number)
      )`)
    await q.query(`
      CREATE TABLE sales_invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        item_number int NOT NULL,
        product_id uuid NOT NULL REFERENCES products(id),
        description varchar NOT NULL,
        ncm varchar(8),
        unit varchar(6) NOT NULL,
        cfop varchar(4) NOT NULL,
        tes_id uuid NOT NULL REFERENCES tes(id),
        quantity numeric(14,4) NOT NULL,
        unit_price numeric(14,4) NOT NULL,
        total numeric(14,2) NOT NULL,
        unit_cost numeric(14,4) NOT NULL DEFAULT 0,
        updates_stock boolean NOT NULL
      )`)

    // ---- Financeiro
    await q.query(`
      CREATE TABLE financial_titles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind varchar(1) NOT NULL CHECK (kind IN ('R', 'P')),
        company_id uuid REFERENCES companies(id),
        customer_id uuid REFERENCES customers(id),
        supplier_id uuid REFERENCES suppliers(id),
        category_id uuid REFERENCES finance_categories(id),
        description varchar NOT NULL,
        document varchar(40),
        installment int NOT NULL DEFAULT 1,
        installments int NOT NULL DEFAULT 1,
        issue_date date NOT NULL DEFAULT CURRENT_DATE,
        due_date date NOT NULL,
        amount numeric(14,2) NOT NULL CHECK (amount > 0),
        paid_amount numeric(14,2) NOT NULL DEFAULT 0,
        status varchar(10) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'parcial', 'pago', 'cancelado')),
        sales_invoice_id uuid REFERENCES sales_invoices(id),
        invoice_id uuid REFERENCES invoices(id),
        notes text,
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (kind = 'R' OR customer_id IS NULL),
        CHECK (kind = 'P' OR supplier_id IS NULL)
      )`)
    await q.query(`CREATE INDEX financial_titles_due ON financial_titles (kind, status, due_date)`)
    await q.query(`
      CREATE TABLE financial_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title_id uuid NOT NULL REFERENCES financial_titles(id) ON DELETE CASCADE,
        bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
        paid_at date NOT NULL,
        amount numeric(14,2) NOT NULL CHECK (amount > 0),
        discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
        interest numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0),
        notes text,
        user_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX financial_payments_date ON financial_payments (paid_at)`)
  }

  async down(q: QueryRunner) {
    for (const t of ['financial_payments', 'financial_titles', 'sales_invoice_items', 'sales_invoices', 'sales_order_items', 'sales_orders', 'bank_accounts', 'finance_categories', 'payment_terms']) {
      await q.query(`DROP TABLE ${t}`)
    }
  }
}
