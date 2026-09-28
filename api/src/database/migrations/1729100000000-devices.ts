import { MigrationInterface, QueryRunner } from 'typeorm'

// App do celular: aparelhos, histórico de localização e envio sem repetição (fila de quando está sem internet).
export class Devices1729100000000 implements MigrationInterface {
  name = 'Devices1729100000000'

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE devices (
        id varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform varchar(20), model varchar(80), os_version varchar(40), app_version varchar(40),
        last_seen timestamptz NOT NULL DEFAULT now(),
        last_lat double precision, last_lng double precision, last_accuracy real, last_location_at timestamptz,
        battery real, online boolean,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await q.query(`
      CREATE TABLE device_locations (
        id bigserial PRIMARY KEY,
        device_id varchar(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lat double precision NOT NULL, lng double precision NOT NULL, accuracy real,
        at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (device_id, at)
      )`)
    await q.query(`CREATE INDEX device_locations_device_at ON device_locations (device_id, at DESC)`)
    await q.query(`
      CREATE TABLE idempotency_keys (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key varchar(80) NOT NULL,
        method varchar(8) NOT NULL, path text NOT NULL,
        status int, body jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, key)
      )`)
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE idempotency_keys`)
    await q.query(`DROP TABLE device_locations`)
    await q.query(`DROP TABLE devices`)
  }
}
