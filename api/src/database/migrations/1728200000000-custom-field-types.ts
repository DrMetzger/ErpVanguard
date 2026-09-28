import { MigrationInterface, QueryRunner } from 'typeorm'

// Campos personalizados: texto longo, inteiro, moeda, opções (única/várias) e máscara de digitação.
export class CustomFieldTypes1728200000000 implements MigrationInterface {
  name = 'CustomFieldTypes1728200000000'

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE custom_fields DROP CONSTRAINT custom_fields_type_check`)
    await q.query(`ALTER TABLE custom_fields ALTER COLUMN type TYPE varchar(16)`)
    await q.query(`ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_type_check
      CHECK (type IN ('text', 'memo', 'number', 'integer', 'currency', 'date', 'bool', 'select', 'radio', 'multiselect'))`)
    await q.query(`ALTER TABLE custom_fields ADD COLUMN mask varchar(40)`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE custom_fields DROP COLUMN mask`)
    await q.query(`UPDATE custom_fields SET type = CASE WHEN type IN ('memo') THEN 'text' WHEN type IN ('integer', 'currency') THEN 'number' WHEN type IN ('radio', 'multiselect') THEN 'select' ELSE type END`)
    await q.query(`ALTER TABLE custom_fields DROP CONSTRAINT custom_fields_type_check`)
    await q.query(`ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_type_check CHECK (type IN ('text', 'number', 'date', 'bool', 'select'))`)
  }
}
