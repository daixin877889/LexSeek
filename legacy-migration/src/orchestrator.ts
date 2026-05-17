import { writeFileSync } from 'node:fs'
import { bindAdminRoles } from './adminRoles'
import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import type { MigrationConfig } from './config'
import { ExceptionCollector } from './exceptions'
import { FkRegistry } from './fkRegistry'
import { loadConfigRemaps } from './idRemapLoader'
import { log } from './logger'
import { buildMigrators } from './migrators/index'
import { ensureProgressTable } from './progress'
import { runMigration } from './runner'
import { resetSequences } from './sequenceReset'
import { synthesizeTransaction } from './transforms/payment'

/** 所有保留旧 ID 插入、需迁移后重置序列的表（按新库表名） */
const SEQUENCE_TABLES = [
  'system_configs', 'users', 'oss_files', 'asr_tasks', 'asr_records',
  'doc_recognition_records', 'image_recognition_records', 'cases', 'case_sessions',
  'case_materials', 'text_content_records', 'case_analyses', 'user_memberships',
  'orders', 'payment_transactions', 'membership_upgrade_records', 'point_records',
  'point_consumption_records', 'user_benefits', 'redemption_codes', 'redemption_records',
  'user_roles',
]

export async function runFullMigration(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  cfg: MigrationConfig,
  adminRoleId: number,
): Promise<void> {
  const migratedAt = new Date()
  const exceptions = new ExceptionCollector()
  const fk = new FkRegistry()

  log('===== 数据迁移开始 =====')
  await ensureProgressTable(next as any)
  const remaps = await loadConfigRemaps(legacy, next)
  const migrators = buildMigrators({ legacy, next, remaps, fk, migratedAt, adminRoleId })

  const deps = {
    newDb: next as any,
    exceptions,
    batchSize: cfg.batchSize,
    failureRateThreshold: cfg.failureRateThreshold,
  }

  // 阶段 0~5：按 §7 顺序逐表迁移；每张完成后把成功 ID 登记进 FkRegistry 供子表预校验
  for (const spec of migrators) {
    const result = await runMigration(spec as any, deps)
    fk.record(spec.table, result.migratedIds)
  }

  // 阶段 6：序列重置
  log('--- 重置自增序列 ---')
  await resetSequences(next as any, SEQUENCE_TABLES)

  // 阶段 6：合成缺失的支付交易（须在 payment_transactions 序列重置之后）
  await synthesizeMissingTransactions(legacy, next, migratedAt, exceptions)

  // 阶段 6：管理员角色补绑
  log('--- 管理员角色补绑 ---')
  await bindAdminRoles(next)

  // 异常清单落盘
  const reportPath = 'legacy-migration/reports/exceptions.csv'
  exceptions.flush(reportPath)
  log(`===== 数据迁移完成：异常 ${exceptions.count()} 行，清单见 ${reportPath} =====`)
  writeFileSync(
    'legacy-migration/reports/migration-summary.json',
    JSON.stringify({ migratedAt, exceptions: exceptions.count() }, null, 2),
    'utf8',
  )
}

/**
 * 为"已支付（status=1）却无对应 payment_transactions"的订单合成交易行。
 * 在 payment_transactions 序列重置之后执行，合成行用自增 ID；
 * 幂等：按 transactionNo（LEGACY-ORD+orderId）唯一约束去重。
 */
async function synthesizeMissingTransactions(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  migratedAt: Date,
  exceptions: ExceptionCollector,
): Promise<void> {
  log('--- 合成缺失的支付交易 ---')
  const L = legacy as any
  const N = next as any
  let after = 0
  let synthesized = 0
  for (;;) {
    const orders = await L.paymentOrders.findMany({
      where: { id: { gt: after }, status: 1 }, orderBy: { id: 'asc' }, take: 500,
    })
    if (orders.length === 0) break
    for (const o of orders) {
      const hasTx = await N.paymentTransactions.findFirst({ where: { orderId: o.id }, select: { id: true } })
      if (hasTx) continue
      // 仅为迁移成功的订单合成（订单可能因外键/重映射失败被跳过）
      const orderExists = await N.orders.findUnique({ where: { id: o.id }, select: { id: true } })
      if (!orderExists) continue
      try {
        await N.paymentTransactions.create({ data: synthesizeTransaction(o, migratedAt) })
        synthesized++
      } catch (e) {
        exceptions.add('paymentTransactions(合成)', o.id, `合成失败：${(e as Error).message}`)
      }
    }
    after = orders[orders.length - 1].id
  }
  log(`--- 合成交易完成：新增 ${synthesized} 条 ---`)
}
