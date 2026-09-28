import { MigrationInterface, QueryRunner } from 'typeorm'
import { municipioPorNome } from '../../common/br'

// Clientes e fornecedores com contato, endereço completo, código IBGE do município (vai no XML) e dados da Receita.
export class PartnersAddress1728500000000 implements MigrationInterface {
  name = 'PartnersAddress1728500000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE customers ADD COLUMN contact varchar(120), ADD COLUMN phone2 varchar(20), ADD COLUMN complement varchar(100),
      ADD COLUMN city_code char(7), ADD COLUMN cnae varchar(250), ADD COLUMN receita jsonb`)
    await q.query(`ALTER TABLE suppliers ADD COLUMN contact varchar(120), ADD COLUMN ie varchar(20), ADD COLUMN phone2 varchar(20), ADD COLUMN zip varchar(8),
      ADD COLUMN street varchar(200), ADD COLUMN number varchar(20), ADD COLUMN complement varchar(100), ADD COLUMN district varchar(100),
      ADD COLUMN city_code char(7), ADD COLUMN cnae varchar(250), ADD COLUMN receita jsonb`)
    await q.query(`ALTER TABLE companies ADD COLUMN complement varchar(100), ADD COLUMN city_code char(7)`)
    // Telefones e CEPs só com números.
    for (const t of ['customers', 'suppliers', 'companies']) {
      await q.query(`UPDATE ${t} SET phone = nullif(regexp_replace(phone, '\\D', '', 'g'), '') WHERE phone IS NOT NULL`)
      if (t !== 'suppliers') await q.query(`UPDATE ${t} SET zip = nullif(regexp_replace(zip, '\\D', '', 'g'), '') WHERE zip IS NOT NULL`)
      // Código IBGE pelo nome da cidade + UF que já estão no cadastro.
      for (const r of await q.query(`SELECT id, city, uf FROM ${t} WHERE city IS NOT NULL AND uf IS NOT NULL`)) {
        const m = municipioPorNome(r.uf, r.city)
        if (m) await q.query(`UPDATE ${t} SET city_code = $2, city = $3 WHERE id = $1`, [r.id, m.code, m.name])
      }
    }
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE companies DROP COLUMN complement, DROP COLUMN city_code`)
    await q.query(`ALTER TABLE suppliers DROP COLUMN contact, DROP COLUMN ie, DROP COLUMN phone2, DROP COLUMN zip, DROP COLUMN street, DROP COLUMN number,
      DROP COLUMN complement, DROP COLUMN district, DROP COLUMN city_code, DROP COLUMN cnae, DROP COLUMN receita`)
    await q.query(`ALTER TABLE customers DROP COLUMN contact, DROP COLUMN phone2, DROP COLUMN complement, DROP COLUMN city_code, DROP COLUMN cnae, DROP COLUMN receita`)
  }
}
