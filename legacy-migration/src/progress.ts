/** 仅依赖 $executeRawUnsafe / $queryRawUnsafe 两个方法，便于在测试中以假对象注入 */
export interface RawDb {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>
  $queryRawUnsafe: <T = unknown>(sql: string, ...args: unknown[]) => Promise<T[]>
}

export type ProgressStatus = 'running' | 'done'

/** 创建进度表（幂等） */
export async function ensureProgressTable(db: RawDb): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _migration_progress (
      table_name text PRIMARY KEY,
      last_id    bigint NOT NULL DEFAULT 0,
      status     text   NOT NULL DEFAULT 'running',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** 读取某表已迁移到的最大旧行 ID；无记录返回 0 */
export async function getLastId(db: RawDb, table: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ last_id: bigint | number }>(
    `SELECT last_id FROM _migration_progress WHERE table_name = $1`,
    table,
  )
  return rows[0] ? Number(rows[0].last_id) : 0
}

/** 写入/更新某表进度 */
export async function setProgress(
  db: RawDb,
  table: string,
  lastId: number,
  status: ProgressStatus,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO _migration_progress (table_name, last_id, status, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (table_name)
     DO UPDATE SET last_id = EXCLUDED.last_id, status = EXCLUDED.status, updated_at = now()`,
    table, lastId, status,
  )
}
