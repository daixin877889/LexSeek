export interface MigrationConfig {
  /** 旧库（LexSeekApi 生产库快照）连接串 */
  legacyDatabaseUrl: string
  /** 新库连接串 */
  newDatabaseUrl: string
  /** 每批行数 */
  batchSize: number
  /** 单表失败率熔断阈值（0~1） */
  failureRateThreshold: number
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[legacy-migration] 缺少环境变量 ${name}`)
  return v
}

export function loadConfig(): MigrationConfig {
  return {
    legacyDatabaseUrl: required('LEGACY_DATABASE_URL'),
    newDatabaseUrl: required('DATABASE_URL'),
    batchSize: Number(process.env.MIGRATION_BATCH_SIZE ?? 800),
    failureRateThreshold: Number(process.env.MIGRATION_FAILURE_THRESHOLD ?? 0.05),
  }
}
