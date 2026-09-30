import { MigrationInterface, QueryRunner } from 'typeorm'
import { CLASS_TRIB } from '../data/cclasstrib'
import { upsertClassTrib } from '../../taxes/class-trib'

// Reforma tributária (LC 214/2025): tabela oficial cClassTrib (CST + classificação do IBS/CBS)
// e onde ela é escolhida: na TES (padrão da operação) e no produto (exceção do item).
export class IbsCbs1729400000000 implements MigrationInterface {
  name = 'IbsCbs1729400000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE class_trib (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code char(6) NOT NULL UNIQUE,
        cst char(3) NOT NULL,
        cst_description varchar(250) NOT NULL DEFAULT '',
        name varchar(250) NOT NULL,
        description text NOT NULL DEFAULT '',
        lc_article varchar(250),
        aliquot_type varchar(60) NOT NULL DEFAULT '',
        p_red_ibs numeric(7,4) NOT NULL DEFAULT 0 CHECK (p_red_ibs BETWEEN 0 AND 100),
        p_red_cbs numeric(7,4) NOT NULL DEFAULT 0 CHECK (p_red_cbs BETWEEN 0 AND 100),
        flags jsonb NOT NULL DEFAULT '{}',
        tp_rbsn varchar(10),
        valid_from date,
        valid_to date,
        source_date date,
        ind_nfe boolean NOT NULL DEFAULT true,
        ind_nfce boolean NOT NULL DEFAULT true,
        annex varchar(20),
        link varchar(500),
        active boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX class_trib_cst ON class_trib (cst)`)
    await upsertClassTrib(q.manager, CLASS_TRIB)
    await q.query(`ALTER TABLE tes ADD COLUMN class_trib_id uuid REFERENCES class_trib(id)`)
    await q.query(`ALTER TABLE products ADD COLUMN class_trib_id uuid REFERENCES class_trib(id)`)
    // TES de saída que já existem: tributação integral (000001), como no padrão da tabela oficial.
    await q.query(`UPDATE tes SET class_trib_id = (SELECT id FROM class_trib WHERE code = '000001') WHERE kind = 'S'`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE products DROP COLUMN class_trib_id`)
    await q.query(`ALTER TABLE tes DROP COLUMN class_trib_id`)
    await q.query(`DROP TABLE class_trib`)
  }
}
