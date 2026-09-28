import { MigrationInterface, QueryRunner } from 'typeorm'

// Fotos dos produtos (até 6). A primeira é a principal; a miniatura dela fica no produto para as listas.
export class ProductPhotos1728300000000 implements MigrationInterface {
  name = 'ProductPhotos1728300000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE product_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        position int NOT NULL DEFAULT 0,
        content_type varchar(20) NOT NULL,
        data bytea NOT NULL,
        thumb text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX product_photos_product ON product_photos (product_id, position)`)
    await q.query(`ALTER TABLE products ADD COLUMN thumb text`)
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE products DROP COLUMN thumb`)
    await q.query(`DROP TABLE product_photos`)
  }
}
