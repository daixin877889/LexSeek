import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import { log, warn } from './logger'

export interface ScanResult {
  name: string
  status: 'ok' | 'warn'
  detail: string
}

/** 在旧库统计某 SQL 的计数（SQL 须返回单列单行，列名 n） */
async function legacyCount(legacy: LegacyPrismaClient, sql: string): Promise<number> {
  const rows = await legacy.$queryRawUnsafe<{ n: bigint | number }[]>(sql)
  return rows[0] ? Number(rows[0].n) : 0
}

/** 1. 唯一约束冲突：users.username / users.email 重复非空值；oss_files (user,bucket,path) 重复 */
async function scanUniqueConflicts(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const dupUsername = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT username FROM users WHERE username IS NOT NULL
      GROUP BY username HAVING count(*) > 1
    ) t`)
  const dupEmail = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT email FROM users WHERE email IS NOT NULL
      GROUP BY email HAVING count(*) > 1
    ) t`)
  const dupOss = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT user_id, bucket_name, file_path FROM oss_files
      WHERE file_path IS NOT NULL
      GROUP BY user_id, bucket_name, file_path HAVING count(*) > 1
    ) t`)
  const bad = dupUsername + dupEmail + dupOss
  return {
    name: '唯一约束冲突',
    status: bad === 0 ? 'ok' : 'warn',
    detail: `username 重复值 ${dupUsername} 组、email 重复值 ${dupEmail} 组、oss_files(user,bucket,path) 重复 ${dupOss} 组`,
  }
}

/** 2. 类型收窄：orderNo≤32 / redemption code≤32 / transactionId≤64 / imageType≤50 */
async function scanFieldLength(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const orderNo = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM payment_orders WHERE length(order_no) > 32`)
  const code = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM redemption_codes WHERE length(code) > 32`)
  const txId = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM payment_transactions WHERE length(transaction_id) > 64`)
  const imgType = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM image_recognition_records WHERE length(image_type) > 50`)
  const bad = orderNo + code + txId + imgType
  return {
    name: '类型收窄',
    status: bad === 0 ? 'ok' : 'warn',
    detail: `超长行数 — order_no:${orderNo} redemption code:${code} transaction_id:${txId} image_type:${imgType}`,
  }
}

/** 3. 视频材料：case_materials type=5（新库无对应类型） */
async function scanVideoMaterials(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM case_materials WHERE type = 5`)
  return {
    name: '视频材料',
    status: n === 0 ? 'ok' : 'warn',
    detail: `case_materials type=5（视频）共 ${n} 行，新库无对应类型，需用户决定处理方式`,
  }
}

/** 4. 配置匹配预检：旧配置表的 name 是否都能在新库找到对应 */
async function scanConfigMatch(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<ScanResult> {
  // [旧表名, 旧 name 列, 新表名, 新 name 列]
  const pairs: [string, string, string, string][] = [
    ['case_type', 'name', 'case_types', 'name'],
    ['membership_levels', 'name', 'membership_levels', 'name'],
    ['products', 'name', 'products', 'name'],
    ['analysis_modules', 'name', 'nodes', 'name'],
    ['point_consumption_items', 'name', 'point_consumption_items', 'name'],
    ['benefits', 'name', 'benefits', 'name'],
  ]
  const misses: string[] = []
  for (const [oldTable, oldCol, newTable, newCol] of pairs) {
    const oldRows = await legacy.$queryRawUnsafe<{ v: string }[]>(
      `SELECT DISTINCT ${oldCol} AS v FROM "${oldTable}" WHERE deleted_at IS NULL`,
    )
    const newRows = await next.$queryRawUnsafe<{ v: string }[]>(
      `SELECT DISTINCT ${newCol} AS v FROM "${newTable}" WHERE deleted_at IS NULL`,
    )
    const newSet = new Set(newRows.map(r => r.v))
    const unmatched = oldRows.map(r => r.v).filter(v => !newSet.has(v))
    if (unmatched.length > 0) misses.push(`${oldTable}→${newTable}: ${unmatched.join('、')}`)
  }
  return {
    name: '配置匹配预检',
    status: misses.length === 0 ? 'ok' : 'warn',
    detail: misses.length === 0 ? '旧配置名称在新库均有对应' : `失配：${misses.join('；')}`,
  }
}

/** 5. 必填外键空值：membership_upgrade_records 关键外键为 null */
async function scanUpgradeNullFk(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM membership_upgrade_records
    WHERE to_membership_id IS NULL OR payment_order_id IS NULL`)
  return {
    name: '会员升级记录缺关键外键',
    status: n === 0 ? 'ok' : 'warn',
    detail: `to_membership_id 或 payment_order_id 为 null 的行 ${n} 条，迁移时将跳过`,
  }
}

/** 6. case_analyses 缺口：sessionId 为空；analysisType 在新 nodes 无匹配 */
async function scanCaseAnalysesGap(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<ScanResult> {
  const nullSession = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM case_analyses WHERE session_id IS NULL`)
  const oldTypes = await legacy.$queryRawUnsafe<{ v: string }[]>(
    `SELECT DISTINCT analysis_type AS v FROM case_analyses WHERE deleted_at IS NULL`,
  )
  const newNodes = await next.$queryRawUnsafe<{ v: string }[]>(
    `SELECT DISTINCT name AS v FROM nodes WHERE deleted_at IS NULL`,
  )
  const nodeSet = new Set(newNodes.map(r => r.v))
  const unmatchedTypes = oldTypes.map(r => r.v).filter(v => !nodeSet.has(v))
  return {
    name: 'case_analyses 缺口',
    status: nullSession === 0 && unmatchedTypes.length === 0 ? 'ok' : 'warn',
    detail: `session_id 为空 ${nullSession} 行；analysisType 无匹配节点：${unmatchedTypes.join('、') || '无'}`,
  }
}

/** 7. NULL 时间戳：11 张迁移表 created_at/updated_at 为 null（旧可空、新必填） */
async function scanNullTimestamps(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const tables = [
    'user_memberships', 'user_benefits', 'redemption_codes', 'redemption_records',
    'payment_orders', 'membership_upgrade_records', 'asr_records', 'asr_tasks',
    'doc_recognition_records', 'image_recognition_records', 'case_analyses',
  ]
  const hits: string[] = []
  for (const t of tables) {
    const n = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM "${t}" WHERE created_at IS NULL OR updated_at IS NULL`)
    if (n > 0) hits.push(`${t}:${n}`)
  }
  return {
    name: 'NULL 时间戳',
    status: hits.length === 0 ? 'ok' : 'warn',
    detail: hits.length === 0 ? '无 NULL 时间戳' : `存在 NULL 时间戳（迁移时按规则兜底）：${hits.join(' ')}`,
  }
}

/** 8. 重复激活版本：case_analyses 同 caseId+analysisType 多条 isActive=1 */
async function scanDuplicateActive(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT case_id, analysis_type FROM case_analyses
      WHERE is_active = 1 AND deleted_at IS NULL
      GROUP BY case_id, analysis_type HAVING count(*) > 1
    ) t`)
  return {
    name: '重复激活版本',
    status: n === 0 ? 'ok' : 'warn',
    detail: `同 case+analysisType 多条 isActive=1 的组 ${n} 个（不阻塞迁移，需业务确认）`,
  }
}

/** 跑全部 8 项扫描，打印结果，返回结果数组 */
export async function runPreflight(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [
    await scanUniqueConflicts(legacy),
    await scanFieldLength(legacy),
    await scanVideoMaterials(legacy),
    await scanConfigMatch(legacy, next),
    await scanUpgradeNullFk(legacy),
    await scanCaseAnalysesGap(legacy, next),
    await scanNullTimestamps(legacy),
    await scanDuplicateActive(legacy),
  ]
  log('===== Preflight 扫描结果 =====')
  for (const r of results) {
    const line = `[${r.status === 'ok' ? 'OK  ' : 'WARN'}] ${r.name} — ${r.detail}`
    if (r.status === 'warn') warn(line)
    else log(line)
  }
  const warnCount = results.filter(r => r.status === 'warn').length
  log(`===== 共 ${results.length} 项，${warnCount} 项需关注 =====`)
  return results
}
