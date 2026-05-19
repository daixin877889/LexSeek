import { writeFileSync } from 'node:fs'
import { bindAdminRoles } from './adminRoles'
import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import type { MigrationConfig } from './config'
import { ExceptionCollector } from './exceptions'
import { FkRegistry } from './fkRegistry'
import { loadConfigRemaps } from './idRemapLoader'
import { log, warn } from './logger'
import { buildMigrators } from './migrators/index'
import { ensureProgressTable } from './progress'
import { runMigration } from './runner'
import { resetSequence, resetSequences } from './sequenceReset'
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

/** 确保新库有承载无匹配 analysisType 的占位节点，返回其 id */
async function ensurePlaceholderNode(next: NewPrismaClient): Promise<number> {
  const N = next as any
  const existing = await N.nodes.findUnique({ where: { name: 'legacy_unmapped' }, select: { id: true } })
  if (existing) return existing.id
  const model = await N.models.findFirst({ select: { id: true } })
  if (!model) throw new Error('新库无可用 model，无法创建占位节点')
  const node = await N.nodes.create({
    data: {
      name: 'legacy_unmapped',
      title: '历史迁移占位节点',
      description: '承载旧库 analysisType 在新 nodes 无对应的历史 case_analyses（含文书生成记录）',
      type: 'analysis',
      modelId: model.id,
    },
  })
  log(`[占位节点] 已创建 legacy_unmapped (id=${node.id})`)
  return node.id
}

/**
 * 把旧库中新库缺失的 point_consumption_items 补齐到新库。
 * 旧 name（code 串）→ 新 key；旧 description（中文）→ 新 name，使迁移后的积分消耗记录能显示对应信息。
 * 幂等：按 key 判存在。须在 loadConfigRemaps 之前调用。
 */
async function ensurePointConsumptionItems(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<void> {
  const L = legacy as any
  const N = next as any
  const oldItems = await L.pointConsumptionItems.findMany({ orderBy: { id: 'asc' } })
  const existingKeys = new Set<string>(
    (await N.pointConsumptionItems.findMany({ select: { key: true } }))
      .map((p: any) => p.key)
      .filter((k: any): k is string => k != null),
  )
  let added = 0
  for (const o of oldItems) {
    // 旧 point_consumption_items.name 不唯一——重名只补第一条（新表 key 唯一）
    if (existingKeys.has(o.name)) continue
    await N.pointConsumptionItems.create({
      data: {
        key: o.name,
        group: o.group,
        name: o.description ?? o.name,
        description: o.description,
        unit: o.unit,
        pointAmount: o.pointAmount,
        status: o.status,
        discount: o.discount,
      },
    })
    existingKeys.add(o.name)
    added++
  }
  log(`[积分消耗项] 补齐 ${added} 条旧库消耗项到新库`)
}

export async function runFullMigration(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  cfg: MigrationConfig,
): Promise<void> {
  const migratedAt = new Date()
  const exceptions = new ExceptionCollector()
  const fk = new FkRegistry()

  log('===== 数据迁移开始 =====')
  await ensureProgressTable(next as any)
  // 补齐文书类积分消耗项到新库（须在 loadConfigRemaps 之前）
  await ensurePointConsumptionItems(legacy, next)
  const remaps = await loadConfigRemaps(legacy, next)
  const placeholderNodeId = await ensurePlaceholderNode(next)
  const nodeNameToId = new Map<string, number>(
    (await (next as any).nodes.findMany({ select: { id: true, name: true } }))
      .map((n: any) => [n.name as string, n.id as number]),
  )
  // 被 case_materials 引用的旧 oss_file id —— 这些是用户上传的案件材料，
  // 其 oss_files.source 须重标记为 caseAnalysis（详见 transformOssFile）
  const materialOssFileIds = new Set<number>(
    (await (legacy as any).caseMaterials.findMany({
      where: { ossFileId: { not: null } },
      select: { ossFileId: true },
    })).map((m: any) => m.ossFileId as number),
  )
  // 旧 analysis_modules：name → type（1=案件分析模块，2=文书生成模块）+ 中文标题
  const moduleRows: { name: string; type: number; title: string }[]
    = await (legacy as any).analysisModules.findMany({ select: { name: true, type: true, title: true } })
  const moduleTypeByName = new Map<string, number>()
  const moduleTitleByName = new Map<string, string>()
  for (const m of moduleRows) {
    if (!moduleTypeByName.has(m.name)) moduleTypeByName.set(m.name, m.type)
    if (m.title && !moduleTitleByName.has(m.name)) moduleTitleByName.set(m.name, m.title)
  }
  // 旧 case_analyses 混装三类数据，按 analysisType 分流到不同目标表
  const PARTY_ANALYSIS_TYPES = new Set(['plaintiff', 'defendant'])
  const classifyAnalysis = (analysisType: string): 'analysis' | 'document' | 'party' => {
    if (PARTY_ANALYSIS_TYPES.has(analysisType)) return 'party'
    // type=1 才是真·案件分析；type=2 文书生成、或模块已下线（不在表中）→ 文书
    return moduleTypeByName.get(analysisType) === 1 ? 'analysis' : 'document'
  }
  // 文书标题：优先用旧 analysis_modules 的中文名；缺失（模块已下线）回退英文 analysisType
  const documentTitleOf = (analysisType: string): string => moduleTitleByName.get(analysisType) ?? analysisType
  // 角色按 code 解析：user=每个用户的基础角色；admin/super_admin=旧 admin 额外绑定
  const roleRows: { id: number; code: string | null }[] = await (next as any).roles.findMany({ select: { id: true, code: true } })
  const roleByCode = new Map<string, number>(
    roleRows.filter(r => r.code != null).map(r => [r.code as string, r.id]),
  )
  const baseRoleId = roleByCode.get('user')
  if (baseRoleId == null) throw new Error('新库 roles 表缺少 code=user 的基础角色，无法迁移 user_roles')
  const adminExtraRoleIds = (['admin', 'super_admin'] as const)
    .map(c => roleByCode.get(c))
    .filter((id): id is number => id != null)
  if (adminExtraRoleIds.length === 0) warn('[user_roles] 新库 roles 缺少 admin/super_admin，旧 admin 将只绑基础角色')
  const migrators = buildMigrators({ legacy, next, remaps, fk, migratedAt, baseRoleId, adminExtraRoleIds, placeholderNodeId, nodeNameToId, materialOssFileIds, classifyAnalysis, documentTitleOf })

  const deps = {
    newDb: next as any,
    exceptions,
    batchSize: cfg.batchSize,
    failureRateThreshold: cfg.failureRateThreshold,
  }

  // 预载新库已有的父表 ID——支持 --resume：上次已迁入的父行不会因本次跳过而从 FkRegistry 丢失
  const N = next as any
  for (const t of ['users', 'cases', 'asrTasks', 'orders', 'userMemberships', 'pointRecords', 'redemptionCodes']) {
    const ids: { id: number }[] = await N[t].findMany({ select: { id: true } })
    fk.record(t, new Set(ids.map(r => r.id)))
  }

  // 阶段 0~5：按 §7 顺序逐表迁移；每张完成后把成功 ID 登记进 FkRegistry 供子表预校验
  for (const spec of migrators) {
    const result = await runMigration(spec as any, deps)
    fk.record(spec.table, result.migratedIds)
    // case_sessions 之后 caseAnalyses 会衍生 legacy 会话（自增 ID），须先重置序列避免与已迁移旧 ID 冲突
    if (spec.table === 'caseSessions') await resetSequence(next as any, 'case_sessions')
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
