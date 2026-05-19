import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import type { FkRegistry } from '../fkRegistry'
import type { ConfigRemaps } from '../idRemapLoader'
import type { MigratorSpec } from '../runner'
import { mapCaseAnalysis } from '../transforms/caseAnalysis'
import { mapFreeformDraft } from '../transforms/document'
import { mapCaseMaterial, mapTextContentRecord } from '../transforms/caseMaterial'
import { transformCase, transformCaseSession } from '../transforms/case'
import { transformUserBenefit } from '../transforms/benefit'
import { transformAsrRecord, transformAsrTask, transformDocRecognition, transformImageRecognition } from '../transforms/recognition'
import { transformMembershipUpgradeRecord, transformUserMembership } from '../transforms/membership'
import { mapOrder, mapPaymentTransaction } from '../transforms/payment'
import { transformOssFile } from '../transforms/file'
import { transformPointConsumptionRecord, transformPointRecord } from '../transforms/point'
import { transformRedemptionCode, transformRedemptionRecord } from '../transforms/redemption'
import { transformSystemConfig } from '../transforms/system'
import { deriveUserRoles, transformUser } from '../transforms/user'

export interface MigrationCtx {
  legacy: LegacyPrismaClient
  next: NewPrismaClient
  remaps: ConfigRemaps
  fk: FkRegistry
  migratedAt: Date
  /** 每个用户都绑定的基础角色 id（roles.code='user'） */
  baseRoleId: number
  /** 旧 role='admin' 额外绑定的管理类角色 id（roles.code='admin'/'super_admin'） */
  adminExtraRoleIds: number[]
  /** analysisType 在新 nodes 无对应时的占位节点 id */
  placeholderNodeId: number
  /** 新 nodes 的 name → id 映射 */
  nodeNameToId: Map<string, number>
  /** 被 case_materials 引用的旧 oss_file id 集合（用于 oss_files.source 重标记为 caseAnalysis） */
  materialOssFileIds: Set<number>
  /** 旧 case_analyses 分类：analysis-真分析 / document-文书生成 / party-当事人提取 */
  classifyAnalysis: (analysisType: string) => 'analysis' | 'document' | 'party'
  /** 文书 analysisType → 中文标题（旧 analysis_modules.title） */
  documentTitleOf: (analysisType: string) => string
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 按 id 升序分批读取的通用 readBatch */
function pagedRead(delegate: any) {
  return (afterId: number, limit: number): Promise<any[]> =>
    delegate.findMany({ where: { id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit })
}

/** A 类无外键无重映射表的简单迁移器 */
function simpleSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => ({ unit: transform(o) }),
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}

/** 带业务外键预校验的迁移器 */
function fkSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any,
  refs: (o: any) => [string, number][], fk: FkRegistry): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll(refs(o))
      if (fkErr) return { skip: fkErr }
      return { unit: transform(o) }
    },
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}

/** 带外键预校验 + 转换可能返回 null（重映射失败）的迁移器 */
function remapSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any,
  refs: (o: any) => [string, number][], fk: FkRegistry, nullReason: string): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll(refs(o))
      if (fkErr) return { skip: fkErr }
      const row = transform(o)
      return row ? { unit: row } : { skip: nullReason }
    },
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}

/** 旧 case_analyses.sessionId 为空时，为该 case 取/建一个 legacy 会话，返回 sessionId */
async function ensureLegacySession(next: NewPrismaClient, caseId: number, userId: number | null): Promise<string> {
  const sessionId = `legacy-case-${caseId}`
  const exists = await next.caseSessions.findUnique({ where: { sessionId }, select: { sessionId: true } })
  if (!exists) {
    await next.caseSessions.create({
      data: { sessionId, scope: 'case', userId, caseId, status: 2, type: 1 },
    })
  }
  return sessionId
}

/**
 * 构建全部迁移器。返回按设计文档 §7 阶段顺序排列的数组；
 * orchestrator 直接顺序执行即满足外键依赖。
 */
export function buildMigrators(ctx: MigrationCtx): MigratorSpec<unknown, unknown>[] {
  const { legacy, next, remaps, fk, migratedAt, baseRoleId, adminExtraRoleIds, placeholderNodeId, nodeNameToId, materialOssFileIds, classifyAnalysis, documentTitleOf } = ctx
  const specs: MigratorSpec<unknown, unknown>[] = []
  const L = legacy as any
  const N = next as any

  // —— 阶段 0：system_configs ——
  specs.push(simpleSpec('systemConfigs', L.systemConfigs, N.systemConfigs, (o: any) => transformSystemConfig(o)))

  // —— 阶段 1：users（写入后衍生 user_roles）——
  specs.push({
    table: 'users',
    readBatch: pagedRead(L.users),
    oldId: (o: any) => o.id,
    transform: async (o: any) => ({ unit: { user: transformUser(o), roles: deriveUserRoles(o, baseRoleId, adminExtraRoleIds) } }),
    writeBatch: async (units: any[]) => {
      await N.users.createMany({ data: units.map((u: any) => u.user), skipDuplicates: true })
      const roles = units.flatMap((u: any) => u.roles)
      if (roles.length > 0) await N.userRoles.createMany({ data: roles, skipDuplicates: true })
    },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 2：oss_files / asr_tasks / asr_records / doc / image ——
  specs.push(simpleSpec('ossFiles', L.ossFiles, N.ossFiles, (o: any) => transformOssFile(o, materialOssFileIds)))
  specs.push(simpleSpec('asrTasks', L.asrTasks, N.asrTasks, (o: any) => transformAsrTask(o, migratedAt)))
  specs.push(fkSpec('asrRecords', L.asrRecords, N.asrRecords,
    (o: any) => transformAsrRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ...(o.asrTasksId != null ? [['asrTasks', o.asrTasksId]] : [])] as [string, number][],
    fk))
  specs.push(fkSpec('docRecognitionRecords', L.docRecognitionRecords, N.docRecognitionRecords,
    (o: any) => transformDocRecognition(o, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk))
  specs.push(fkSpec('imageRecognitionRecords', L.imageRecognitionRecords, N.imageRecognitionRecords,
    (o: any) => transformImageRecognition(o, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk))

  // —— 阶段 3：cases / case_sessions / case_materials(+text_content) / case_analyses ——
  specs.push({
    table: 'cases',
    readBatch: pagedRead(L.cases),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['users', o.userId]])
      if (fkErr) return { skip: fkErr }
      const newCaseTypeId = remaps.caseTypes.get(o.caseTypeId) ?? null
      const row = transformCase(o, newCaseTypeId)
      return row ? { unit: row } : { skip: `caseTypeId ${o.caseTypeId} 无法重映射` }
    },
    writeBatch: async (units: any[]) => { await N.cases.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseSessions',
    readBatch: (afterId: number, limit: number) => L.caseSessions.findMany({
      where: { id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit,
      include: { cases: { select: { userId: true } } },
    }),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      return { unit: transformCaseSession(o, o.cases?.userId ?? null) }
    },
    writeBatch: async (units: any[]) => { await N.caseSessions.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseMaterials',
    readBatch: pagedRead(L.caseMaterials),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      if (o.type === 5) return { skip: '旧 type=5（视频）新库无对应类型' }
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      return { unit: { material: mapCaseMaterial(o), text: mapTextContentRecord(o) } }
    },
    writeBatch: async (units: any[]) => {
      await N.caseMaterials.createMany({ data: units.map((u: any) => u.material), skipDuplicates: true })
      const texts = units.map((u: any) => u.text).filter((t: any) => t != null)
      // text_content_records 自增 ID，按 materialId 去重保证幂等
      for (const t of texts) {
        const exists = await N.textContentRecords.findFirst({ where: { materialId: t.materialId } })
        if (!exists) await N.textContentRecords.create({ data: t })
      }
    },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseAnalyses',
    readBatch: pagedRead(L.caseAnalyses),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      // 文书生成类 → documentDrafts 自由文书；当事人提取类 → 丢弃。本表只收真·案件分析
      if (classifyAnalysis(o.analysisType) !== 'analysis') return { ignore: true }
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      // analysisType 匹配新 nodes；旧分析模块在新库已下线的 → 挂占位节点
      const nodeId = nodeNameToId.get(o.analysisType) ?? placeholderNodeId
      const sessionId: string = o.sessionId ?? await ensureLegacySession(next, o.caseId, o.userId)
      return { unit: mapCaseAnalysis(o, nodeId, sessionId, migratedAt) }
    },
    writeBatch: async (units: any[]) => { await N.caseAnalyses.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 3：历史文书生成记录 → documentDrafts 自由文书草稿 ——
  // 与 caseAnalyses 同读 legacy.caseAnalyses，按 classifyAnalysis 各取所需子集（互不重叠）
  specs.push({
    table: 'documentDrafts',
    readBatch: pagedRead(L.caseAnalyses),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      if (classifyAnalysis(o.analysisType) !== 'document') return { ignore: true }
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      return { unit: mapFreeformDraft(o, migratedAt, documentTitleOf(o.analysisType)) }
    },
    writeBatch: async (units: any[]) => { await N.documentDrafts.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 4：会员与交易 ——
  specs.push(remapSpec('userMemberships', L.userMemberships, N.userMemberships,
    (o: any) => transformUserMembership(o, remaps.membershipLevels.get(o.levelId) ?? null, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk, 'levelId 无法重映射'))

  specs.push({
    table: 'orders',
    readBatch: pagedRead(L.paymentOrders),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['users', o.userId]])
      if (fkErr) return { skip: fkErr }
      let newProductId: number | null = o.productId != null ? (remaps.products.get(o.productId) ?? null) : null
      if (newProductId === null && o.levelId != null) {
        const newLevelId = remaps.membershipLevels.get(o.levelId)
        if (newLevelId != null) {
          const p = await N.products.findFirst({ where: { levelId: newLevelId, type: 1, deletedAt: null }, select: { id: true } })
          newProductId = p?.id ?? null
        }
      }
      const isUpgrade = (await L.membershipUpgradeRecords.count({ where: { paymentOrderId: o.id } })) > 0
      const row = mapOrder(o, newProductId, isUpgrade, migratedAt)
      return row ? { unit: row } : { skip: `productId 无法确定（productId=${o.productId} levelId=${o.levelId}）` }
    },
    writeBatch: async (units: any[]) => { await N.orders.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push(fkSpec('paymentTransactions', L.paymentTransactions, N.paymentTransactions,
    (o: any) => mapPaymentTransaction(o),
    (o: any) => [['orders', o.orderId]] as [string, number][], fk))

  specs.push(remapSpec('membershipUpgradeRecords', L.membershipUpgradeRecords, N.membershipUpgradeRecords,
    (o: any) => transformMembershipUpgradeRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ['userMemberships', o.fromMembershipId], ['userMemberships', o.toMembershipId], ['orders', o.paymentOrderId]] as [string, number][],
    fk, '关键外键为 null（失败/未完成的升级）'))

  specs.push(fkSpec('pointRecords', L.pointRecords, N.pointRecords,
    (o: any) => transformPointRecord(o),
    (o: any) => [['users', o.userId], ...(o.userMembershipId != null ? [['userMemberships', o.userMembershipId]] : [])] as [string, number][], fk))

  specs.push(remapSpec('pointConsumptionRecords', L.pointConsumptionRecords, N.pointConsumptionRecords,
    (o: any) => transformPointConsumptionRecord(o, remaps.pointConsumptionItems.get(o.itemId) ?? null),
    (o: any) => [['users', o.userId], ['pointRecords', o.pointRecordId]] as [string, number][], fk, 'itemId 无法重映射'))

  // user_benefits 约 76% 引用新项目已删除的限额类 benefit（预期跳过），放宽熔断阈值
  specs.push({
    ...remapSpec('userBenefits', L.userBenefits, N.userBenefits,
      (o: any) => transformUserBenefit(o, remaps.benefits.get(o.benefitId) ?? null, migratedAt),
      (o: any) => [['users', o.userId]] as [string, number][], fk, 'benefitId 无法重映射'),
    failureRateThreshold: 0.95,
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 5：兑换 ——
  specs.push(remapSpec('redemptionCodes', L.redemptionCodes, N.redemptionCodes,
    (o: any) => transformRedemptionCode(o, remaps.membershipLevels.get(o.levelId) ?? null, migratedAt),
    () => [] as [string, number][], fk, 'levelId 无法重映射'))

  specs.push(fkSpec('redemptionRecords', L.redemptionRecords, N.redemptionRecords,
    (o: any) => transformRedemptionRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ['redemptionCodes', o.codeId]] as [string, number][], fk))

  return specs
}
