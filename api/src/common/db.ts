import { DataSource, EntityManager } from 'typeorm'

export type Db = DataSource | EntityManager

export async function one<T extends Record<string, any> = Record<string, any>>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await db.query(sql, params)
  return rows[0]
}

export const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')

// numeric do Postgres chega como string; converte as colunas informadas para number.
export function numbers<T extends Record<string, any>>(row: T, ...keys: string[]): T {
  for (const key of keys) if (row[key] !== null && row[key] !== undefined) (row as any)[key] = Number(row[key])
  return row
}
