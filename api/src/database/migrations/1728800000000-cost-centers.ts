import { MigrationInterface, QueryRunner } from 'typeorm'

// Centros de custo nas movimentações e classificação do plano de contas (naturezas) nas linhas da DRE.
export class CostCenters1728800000000 implements MigrationInterface {
  name = 'CostCenters1728800000000'

  async up(q: QueryRunner) {
    // A = analítico (recebe lançamentos) · S = sintético (só agrupa)
    await q.query(`
      CREATE TABLE cost_centers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(20) NOT NULL UNIQUE,
        name varchar(120) NOT NULL,
        type varchar(1) NOT NULL DEFAULT 'A' CHECK (type IN ('A', 'S')),
        parent_id uuid REFERENCES cost_centers(id),
        active boolean NOT NULL DEFAULT true,
        CHECK (parent_id IS NULL OR parent_id <> id)
      )`)
    const seed = [['01', 'Administrativo', 'A', null], ['02', 'Comercial', 'S', null], ['02.01', 'Vendas diretas', 'A', '02'], ['02.02', 'E-commerce', 'A', '02'], ['03', 'Produção', 'A', null]]
    for (const [code, name, type, parent] of seed) {
      await q.query(`INSERT INTO cost_centers (code, name, type, parent_id) VALUES ($1, $2, $3, (SELECT id FROM cost_centers WHERE code = $4))`, [code, name, type, parent])
    }

    for (const t of ['financial_titles', 'sales_quotes', 'sales_orders', 'sales_invoices', 'invoices', 'stock_movements']) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN cost_center_id uuid REFERENCES cost_centers(id)`)
    }
    await q.query(`CREATE INDEX financial_titles_cost_center ON financial_titles (cost_center_id, issue_date)`)

    // Natureza financeira → linha da DRE. "fora" = não entra na DRE (ex.: compra de mercadoria vai para o estoque).
    await q.query(`ALTER TABLE finance_categories ADD COLUMN dre_line varchar(12) CHECK (dre_line IN ('receita', 'deducao', 'cmv', 'desp_adm', 'desp_com', 'desp_fin', 'outras', 'ir_csll', 'fora'))`)
    const extra = [['1.05', 'Receitas financeiras (juros recebidos)', 'R'], ['2.09', 'IRPJ e CSLL', 'D'], ['2.10', 'Custos de produção', 'D'],
      ['2.11', 'Comissões e marketing', 'D'], ['2.12', 'Juros e encargos financeiros', 'D']]
    for (const [code, name, kind] of extra) await q.query(`INSERT INTO finance_categories (code, name, kind) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`, [code, name, kind])
    const map: Record<string, string> = {
      '1.01': 'receita', '1.02': 'receita', '1.03': 'receita', '1.04': 'fora', '1.05': 'desp_fin', '1.99': 'outras',
      '2.01': 'fora', '2.02': 'desp_adm', '2.03': 'desp_adm', '2.04': 'fora', '2.05': 'desp_adm', '2.06': 'desp_com', '2.07': 'desp_fin', '2.08': 'fora',
      '2.09': 'ir_csll', '2.10': 'cmv', '2.11': 'desp_com', '2.12': 'desp_fin', '2.99': 'outras',
    }
    for (const [code, line] of Object.entries(map)) await q.query(`UPDATE finance_categories SET dre_line = $2 WHERE code = $1`, [code, line])
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE finance_categories DROP COLUMN dre_line`)
    for (const t of ['financial_titles', 'sales_quotes', 'sales_orders', 'sales_invoices', 'invoices', 'stock_movements']) await q.query(`ALTER TABLE ${t} DROP COLUMN cost_center_id`)
    await q.query(`DROP TABLE cost_centers`)
  }
}
