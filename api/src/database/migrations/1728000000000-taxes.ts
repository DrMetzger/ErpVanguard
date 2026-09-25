import { MigrationInterface, QueryRunner } from 'typeorm'

// Motor de impostos: regime tributário da empresa, alíquotas de ICMS por UF, matriz de impostos
// (regras por imposto, como no emissor do SEBRAE) e parâmetros do sistema.
export class Taxes1728000000000 implements MigrationInterface {
  name = 'Taxes1728000000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE companies ADD COLUMN tax_regime varchar(16) NOT NULL DEFAULT 'presumido'
      CHECK (tax_regime IN ('simples', 'simples_excesso', 'mei', 'presumido', 'real'))`)
    await q.query(`UPDATE companies SET tax_regime = CASE crt WHEN '1' THEN 'simples' WHEN '2' THEN 'simples_excesso' WHEN '4' THEN 'mei' ELSE 'presumido' END`)
    await q.query(`ALTER TABLE companies ADD COLUMN sn_credit_rate numeric(5,2)`)

    // Alíquota interna de ICMS e FCP de cada UF (valores de referência: conferir com a contabilidade).
    await q.query(`
      CREATE TABLE uf_icms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        uf varchar(2) NOT NULL UNIQUE,
        internal_rate numeric(5,2) NOT NULL,
        fcp_rate numeric(5,2) NOT NULL DEFAULT 0,
        notes varchar(200),
        active boolean NOT NULL DEFAULT true
      )`)
    const ufs: [string, number, number][] = [
      ['AC', 19, 0], ['AL', 19, 1], ['AM', 20, 0], ['AP', 18, 0], ['BA', 19.5, 1], ['CE', 20, 0], ['DF', 20, 0], ['ES', 17, 0], ['GO', 19, 0],
      ['MA', 23, 0], ['MG', 18, 0], ['MS', 17, 0], ['MT', 17, 0], ['PA', 19, 0], ['PB', 20, 0], ['PE', 20.5, 0], ['PI', 22.5, 0], ['PR', 19.5, 0],
      ['RJ', 20, 2], ['RN', 20, 0], ['RO', 19.5, 0], ['RR', 20, 0], ['RS', 17, 0], ['SC', 17, 0], ['SE', 19, 1], ['SP', 18, 0], ['TO', 20, 0],
    ]
    for (const [uf, rate, fcp] of ufs) await q.query(`INSERT INTO uf_icms (uf, internal_rate, fcp_rate, notes) VALUES ($1, $2, $3, 'Valor de referência: conferir')`, [uf, rate, fcp])

    await q.query(`
      CREATE TABLE tax_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tax varchar(8) NOT NULL CHECK (tax IN ('ICMS', 'ICMS_ST', 'IPI', 'PIS', 'COFINS')),
        name varchar(120) NOT NULL,
        regime varchar(16) CHECK (regime IN ('simples', 'simples_excesso', 'mei', 'presumido', 'real')),
        valid_from date,
        valid_to date,
        operation_type_id uuid REFERENCES operation_types(id),
        uf varchar(2),
        taxpayer varchar(1),
        product_id uuid REFERENCES products(id),
        product_group_id uuid REFERENCES product_groups(id),
        product_type_id uuid REFERENCES product_types(id),
        ncm_prefix varchar(8),
        cfop varchar(4),
        cst varchar(3),
        rate numeric(6,2),
        base_reduction numeric(5,2) NOT NULL DEFAULT 0,
        mva numeric(6,2),
        st_rate numeric(5,2),
        fcp_rate numeric(5,2),
        credit_rate numeric(5,2),
        notes varchar(300),
        active boolean NOT NULL DEFAULT true
      )`)

    await q.query(`
      CREATE TABLE parameters (
        key varchar(12) PRIMARY KEY,
        value text NOT NULL,
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)

    // Venda a não contribuinte: CFOP 6108 fora do estado (regra da matriz fiscal com contribuinte = 9).
    await q.query(`INSERT INTO tes (code, kind, description, cfop_internal, cfop_interstate, updates_stock, generates_financial, icms_cst)
                   VALUES ('505', 'S', 'Venda a não contribuinte', '5102', '6108', true, true, '00') ON CONFLICT (code) DO NOTHING`)
    await q.query(`INSERT INTO fiscal_matrix (operation_type_id, tes_id, taxpayer, notes)
                   SELECT o.id, t.id, '9', 'Venda a não contribuinte (CFOP 6108 fora do estado)' FROM operation_types o, tes t
                   WHERE o.code = 'S01' AND t.code = '505'
                     AND NOT EXISTS (SELECT 1 FROM fiscal_matrix m WHERE m.operation_type_id = o.id AND m.taxpayer = '9')`)

    // Impostos calculados de cada item e totais do documento.
    for (const t of ['sales_order_items', 'sales_invoice_items']) await q.query(`ALTER TABLE ${t} ADD COLUMN taxes jsonb`)
    for (const t of ['sales_orders', 'sales_invoices']) await q.query(`ALTER TABLE ${t} ADD COLUMN taxes jsonb`)
  }

  async down(q: QueryRunner) {
    for (const t of ['sales_order_items', 'sales_invoice_items', 'sales_orders', 'sales_invoices']) await q.query(`ALTER TABLE ${t} DROP COLUMN taxes`)
    await q.query(`DROP TABLE parameters`)
    await q.query(`DROP TABLE tax_rules`)
    await q.query(`DROP TABLE uf_icms`)
    await q.query(`ALTER TABLE companies DROP COLUMN sn_credit_rate, DROP COLUMN tax_regime`)
  }
}
