import { MigrationInterface, QueryRunner } from 'typeorm'

// Empresas e filiais. Só uma pode ser a matriz.
export class Companies1727500000000 implements MigrationInterface {
  name = 'Companies1727500000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(4) NOT NULL UNIQUE,
        is_head boolean NOT NULL DEFAULT false,
        document varchar(14) NOT NULL UNIQUE,
        name varchar NOT NULL,
        trade_name varchar,
        ie varchar(20),
        im varchar(20),
        crt varchar(1) NOT NULL DEFAULT '3',
        email varchar,
        phone varchar,
        zip varchar(8),
        street varchar,
        number varchar(20),
        district varchar,
        city varchar,
        uf varchar(2) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE UNIQUE INDEX companies_one_head ON companies ((true)) WHERE is_head`)

    // Aproveita os dados da empresa salvos em Configurações, se houver CNPJ.
    const [saved] = await q.query(`SELECT value FROM app_settings WHERE key = 'company'`)
    const company = saved?.value
    if (company?.cnpj && /^\d{14}$/.test(company.cnpj)) {
      await q.query(`INSERT INTO companies (code, is_head, document, name, uf) VALUES ('01', true, $1, $2, $3)`, [
        company.cnpj, company.name || 'Matriz', company.uf || 'SP',
      ])
    }

    // Guarda o destinatário do XML para conferir se a nota é para uma das empresas.
    await q.query(`ALTER TABLE invoices ADD COLUMN recipient_document varchar(14)`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE invoices DROP COLUMN recipient_document`)
    await q.query(`DROP TABLE companies`)
  }
}
