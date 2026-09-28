import { MigrationInterface, QueryRunner } from 'typeorm'

// Vídeos do produto (até 3): link (YouTube, Vimeo ou URL de vídeo) ou arquivo enviado (guardado em disco).
export class ProductVideos1728400000000 implements MigrationInterface {
  name = 'ProductVideos1728400000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE product_videos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        position int NOT NULL DEFAULT 0,
        kind varchar(6) NOT NULL CHECK (kind IN ('link', 'file')),
        provider varchar(10) CHECK (provider IN ('youtube', 'vimeo', 'url')),
        title varchar(120),
        url varchar(500),
        file_name varchar(200),
        content_type varchar(40),
        size bigint,
        storage_key varchar(80),
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`CREATE INDEX product_videos_product ON product_videos (product_id, position)`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE product_videos`)
  }
}
