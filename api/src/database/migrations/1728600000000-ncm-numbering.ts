import { MigrationInterface, QueryRunner } from 'typeorm'

// NCM cadastrado sozinho ao salvar produto (descrição pelo Gemini ou pendente), tributos aproximados
// (Lei 12.741) por NCM e controle de numeração das notas por série/modelo (como o MV_ESPECIE do Protheus).
export class NcmNumbering1728600000000 implements MigrationInterface {
  name = 'NcmNumbering1728600000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE ncm ADD COLUMN pending boolean NOT NULL DEFAULT false`)
    await q.query(`ALTER TABLE ncm ADD COLUMN source varchar(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'ia'))`)
    await q.query(`ALTER TABLE ncm ADD COLUMN tax_estimate_rate numeric(6,2)`)
    await q.query(`ALTER TABLE ncm ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()`)
    // Quem corrige a descrição na tela resolve a pendência.
    await q.query(`
      CREATE FUNCTION ncm_clear_pending() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.description IS DISTINCT FROM OLD.description AND NEW.pending = OLD.pending AND NEW.source = OLD.source THEN
          NEW.pending := false;
          NEW.source := 'manual';
        END IF;
        RETURN NEW;
      END $$`)
    await q.query(`CREATE TRIGGER ncm_clear_pending BEFORE UPDATE ON ncm FOR EACH ROW EXECUTE FUNCTION ncm_clear_pending()`)

    await q.query(`
      CREATE TABLE invoice_numbering (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        series int NOT NULL CHECK (series BETWEEN 0 AND 999),
        model varchar(2) NOT NULL DEFAULT '55' CHECK (model IN ('55', '65')),
        next_number int NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 999999999),
        active boolean NOT NULL DEFAULT true,
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, series)
      )`)
    await q.query(`ALTER TABLE sales_invoices ADD COLUMN model varchar(2) NOT NULL DEFAULT '55'`)
    // Quem já emitiu notas continua do número seguinte.
    await q.query(`
      INSERT INTO invoice_numbering (company_id, series, next_number)
      SELECT company_id, series, max(number) + 1 FROM sales_invoices GROUP BY company_id, series`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE sales_invoices DROP COLUMN model`)
    await q.query(`DROP TABLE invoice_numbering`)
    await q.query(`DROP TRIGGER ncm_clear_pending ON ncm`)
    await q.query(`DROP FUNCTION ncm_clear_pending()`)
    await q.query(`ALTER TABLE ncm DROP COLUMN created_at, DROP COLUMN tax_estimate_rate, DROP COLUMN source, DROP COLUMN pending`)
  }
}
