import type { RawDb } from './progress'
import { log } from './logger'

/**
 * 把单张表的自增主键序列重置到当前 MAX(id)。
 * 表无行时 setval 到 1。
 */
export async function resetSequence(db: RawDb, table: string): Promise<void> {
  await db.$executeRawUnsafe(
    `SELECT setval(
       pg_get_serial_sequence($1, 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1)
     )`,
    table,
  )
  log(`[sequenceReset] ${table} 序列已重置`)
}

/** 批量重置多张表的序列 */
export async function resetSequences(db: RawDb, tables: string[]): Promise<void> {
  for (const t of tables) await resetSequence(db, t)
}
