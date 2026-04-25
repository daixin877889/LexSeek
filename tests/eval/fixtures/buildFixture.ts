/**
 * Eval fixture builder —— 3 案件 + 旧分析 + 自动 seed user。
 *
 * 设计要点（参考 plan §A2.4）：
 *   - caseMemories 表 embedding 是 Unsupported("vector")，prisma.create 不能用
 *     向量列 → 走 raw SQL `INSERT INTO case_memories ...` + `to_tsvector('chinese', ...)`
 *     回填 tsv（BM25 召回需要）。
 *   - caseMaterials 用 prisma.create（无 Unsupported 字段，自增 Int 主键），必填
 *     `name + type:Int (1=文本/2=文档/3=图片/4=音频)`。
 *   - caseAnalyses 必填 `caseId + sessionId(FK case_sessions.sessionId) + nodeId(FK
 *     nodes.id) + analysisType`。复用 seedData 的 nodeId=1 (caseInfoCheck)。
 *     summary 可为 null（旧分析对照组）。
 *   - caseSessions 用 prisma.create，必填 sessionId(unique)，scope='case'。
 *   - cases 用 `userId`（非 ownerUserId）+ `caseTypeId=1`（seedData 已含「民商事案件」）。
 *   - users 必填 `name + phone`，无 nickname。upsert 后 setval(sequence) 推进
 *     pg 序列，避免 autoincrement 撞 id=1。
 *   - 双保险：cleanFirst=true 时 DATABASE_URL 必须含 `ls_eval` 才允许 TRUNCATE，
 *     防止误清测试库 / 开发库。
 *   - TRUNCATE 表用 snake_case（实际表名），保留 users / case_types / models /
 *     nodes（seedData 数据）。
 */
import { prisma } from '~~/server/utils/db'
import { mulberry32, generateUuidV4 } from '../utils/prng'

/** 复用 seedData.sql 的 nodes id=1（caseInfoCheck），所有 caseAnalyses 都挂这个 node。 */
const NODE_ID_CASE_INFO_CHECK = 1
/** 复用 seedData.sql 的 case_types id=1（民商事案件）。 */
const CASE_TYPE_ID_CIVIL = 1

const TABLES_TO_CLEAN = [
  'case_analysis_embeddings',
  'case_analyses',
  'case_memories',
  'case_material_embeddings',
  'case_materials',
  'case_sessions',
  'agent_runs',
  'cases',
] as const

export interface FixtureCaseA {
  id: number
  ownerId: number
  /** 8 份材料（自增 Int） */
  materialIds: number[]
  /** 15 条记忆（uuid，案件作用域） */
  memoryIds: string[]
  /** 3 类 active 分析（自增 Int） */
  analysisIds: number[]
  /** 3 类 historical 分析（version=1, isActive=false） */
  analysisHistoricalIds: number[]
  /** 1 条旧分析（summary IS NULL） */
  analysisLegacyId: number
  /** 3 个 case 会话的 sessionId（uuid） */
  sessions: string[]
}

export interface FixtureCaseB {
  id: number
  materialIds: number[]
  memoryIds: string[]
  analysisIds: number[]
}

export interface FixtureCaseC {
  id: number
  ownerId: number
  materialId: number
  memoryId: string
}

export interface FixtureResult {
  caseA: FixtureCaseA
  caseB: FixtureCaseB
  caseC: FixtureCaseC
}

export interface BuildOpts {
  cleanFirst: boolean
  deterministicSeed: number
  ownerUserId: number
}

export async function buildFixture(opts: BuildOpts): Promise<FixtureResult> {
  if (opts.cleanFirst) {
    // 双保险：DATABASE_URL 不含 ls_eval 拒绝清表
    if (!(process.env.DATABASE_URL ?? '').includes('ls_eval')) {
      throw new Error('[fixture] 拒绝清表：DATABASE_URL 不含 ls_eval')
    }
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABLES_TO_CLEAN.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    )
  }

  await ensureEvalUser(opts.ownerUserId)

  const rng = mulberry32(opts.deterministicSeed)
  const caseA = await buildCaseA(opts.ownerUserId, rng)
  const caseB = await buildCaseB(opts.ownerUserId, rng)
  const caseC = await buildCaseC(opts.ownerUserId, rng)
  return { caseA, caseB, caseC }
}

async function ensureEvalUser(userId: number): Promise<void> {
  await prisma.users.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      name: 'eval-user',
      phone: '13800000000',
    },
  })
  // sequence 推进，防止下次 autoincrement insert 撞已存在的 id
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1))`,
  )

  // 给测试用户开会员（pointConsumptionMiddleware 会拦截非会员的 LLM 调用 → __interrupt__ insufficient_points）
  // 复用 seedData 已有的 membershipLevels id=1（基础版）/ 2（专业版）/ 3（旗舰版），用旗舰版避免任何额度限制
  const FLAGSHIP_LEVEL_ID = 3
  const existing = await prisma.userMemberships.findFirst({
    where: { userId, status: 1 },
  })
  if (!existing) {
    const now = new Date()
    const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000) // 1 年后到期
    await prisma.userMemberships.create({
      data: {
        userId,
        levelId: FLAGSHIP_LEVEL_ID,
        startDate: now,
        endDate: farFuture,
        autoRenew: false,
        status: 1,
        sourceType: 5, // 5=试用
      },
    })
  }

  // 加 1M 积分（pointConsumptionMiddleware 检查 remaining > 0 才放行）
  // pointRecords 真实字段：userId / pointAmount / used / remaining / sourceType / effectiveAt / expiredAt
  const existingPoint = await prisma.pointRecords.findFirst({ where: { userId } })
  if (!existingPoint) {
    const now = new Date()
    const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    await prisma.pointRecords.create({
      data: {
        userId,
        pointAmount: 1_000_000,
        used: 0,
        remaining: 1_000_000,
        sourceType: 5, // 5=试用赠送
        effectiveAt: now,
        expiredAt: farFuture,
      },
    })
  }
}

// ============== caseA ==============

async function buildCaseA(ownerUserId: number, rng: () => number): Promise<FixtureCaseA> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-fixture】民商事合同纠纷（二审）',
      caseTypeId: CASE_TYPE_ID_CIVIL,
      status: 4, // SECOND_TRIAL（仅 fixture 标识，业务侧 status 1/2/3，扩位用作 ARCHIVED 同款思路）
      courtName: '广州市中级人民法院',
      firstInstanceCaseNo: '(2024)粤0103民初1234号',
      secondInstanceCaseNo: '(2025)粤01民终5678号',
      firstInstanceJudge: '张三',
      secondInstanceJudge: '李四',
      userId: ownerUserId,
    },
  })

  const sessions: string[] = []
  for (let i = 0; i < 3; i++) {
    sessions.push(await seedSession(created.id, ownerUserId, rng))
  }

  const materialIds = await seedMaterials(created.id)
  const memoryIds = await seedMemories(created.id, rng)

  const analysisIds: number[] = []
  const analysisHistoricalIds: number[] = []
  const types = ['init_analysis', 'evidence_analysis', 'risk_analysis']
  for (let i = 0; i < types.length; i++) {
    const { activeId, historicalId } = await seedAnalysisWithVersions(
      created.id,
      sessions[i % sessions.length]!,
      types[i]!,
    )
    analysisIds.push(activeId)
    analysisHistoricalIds.push(historicalId)
  }

  const analysisLegacyId = await seedLegacyAnalysis(created.id, sessions[0]!)

  return {
    id: created.id,
    ownerId: ownerUserId,
    materialIds,
    memoryIds,
    analysisIds,
    analysisHistoricalIds,
    analysisLegacyId,
    sessions,
  }
}

async function seedMaterials(caseId: number): Promise<number[]> {
  // type: 1=文本，2=文档，3=图片，4=音频
  const items: Array<{ name: string; type: number }> = [
    { name: '甲乙双方主合同.docx', type: 2 },
    { name: '补充协议.pdf', type: 2 },
    { name: '银行回单（首付款）.pdf', type: 2 },
    { name: '微信聊天记录.pdf', type: 2 },
    { name: '物流签收单.png', type: 3 },
    { name: '邮件往来.pdf', type: 2 },
    { name: '一审庭审笔录.pdf', type: 2 },
    { name: '调解记录.pdf', type: 2 },
  ]
  const ids: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const created = await prisma.caseMaterials.create({
      data: {
        caseId,
        name: item.name,
        type: item.type,
        summary: `第 ${i + 1} 份材料预生成 100 字摘要：${item.name} 关键事实。`,
        status: 3, // 已完成
      },
    })
    ids.push(created.id)
  }
  return ids
}

async function seedMemories(caseId: number, rng: () => number): Promise<string[]> {
  const items = [
    { kind: 'fact', subjectKey: 'fact.contract.signed_at', text: '甲乙双方于 2024-03-15 签订主合同' },
    { kind: 'fact', subjectKey: 'fact.payment.first', text: '甲方已支付首付款 100 万元' },
    { kind: 'fact', subjectKey: 'fact.delivery.overdue', text: '乙方逾期交货 45 天' },
    { kind: 'fact', subjectKey: 'fact.dispute.amount', text: '争议金额为 280 万元' },
    { kind: 'fact', subjectKey: 'fact.evidence.wechat', text: '存在微信聊天记录证明乙方承认逾期' },
    { kind: 'preference', subjectKey: 'preference.contact.method', text: '当事人偏好电话沟通' },
    { kind: 'preference', subjectKey: 'preference.strategy.attitude', text: '当事人倾向积极调解' },
    { kind: 'preference', subjectKey: 'preference.timeline.urgency', text: '当事人希望 2 个月内结案' },
    { kind: 'preference', subjectKey: 'preference.disclosure.detail', text: '不愿公开具体合同金额' },
    { kind: 'preference', subjectKey: 'preference.report.format', text: '希望分析报告以表格输出' },
    { kind: 'topic', subjectKey: 'topic.legal.basis', text: '讨论过《民法典》合同编关于违约金的条款' },
    { kind: 'topic', subjectKey: 'topic.evidence.assessment', text: '已评估微信记录的证据效力' },
    { kind: 'topic', subjectKey: 'topic.risk.financial', text: '评估了乙方的偿付能力风险' },
    { kind: 'topic', subjectKey: 'topic.precedent.search', text: '检索了类案三起，均判决支持原告' },
    { kind: 'topic', subjectKey: 'topic.strategy.mediation', text: '讨论过和解方案的可行性' },
  ]
  const ids: string[] = []
  for (const item of items) {
    const id = generateUuidV4(rng)
    const metadata = {
      id,
      caseId,
      kind: item.kind,
      subjectKey: item.subjectKey,
      confidence: 0.8 + rng() * 0.15,
      source: 'fixture',
      invalidatedAt: null,
      createdAt: new Date().toISOString(),
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO case_memories (id, text, metadata) VALUES ($1::uuid, $2, $3::jsonb)`,
      id,
      item.text,
      JSON.stringify(metadata),
    )
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE id = $1::uuid`,
      id,
    )
    ids.push(id)
  }
  return ids
}

async function seedAnalysisWithVersions(
  caseId: number,
  sessionId: string,
  analysisType: string,
): Promise<{ activeId: number; historicalId: number }> {
  const historical = await prisma.caseAnalyses.create({
    data: {
      caseId,
      sessionId,
      nodeId: NODE_ID_CASE_INFO_CHECK,
      analysisType,
      analysisResult: `${analysisType} v1 历史结论：倾向 A 方案。`.repeat(8),
      summary: `${analysisType} v1 摘要：A 方案，证据强度中。`,
      version: 1,
      isActive: false,
      status: 2,
    },
  })
  const active = await prisma.caseAnalyses.create({
    data: {
      caseId,
      sessionId,
      nodeId: NODE_ID_CASE_INFO_CHECK,
      analysisType,
      analysisResult: `${analysisType} v2 当前结论：倾向 B 方案，证据强度高。`.repeat(8),
      summary: `${analysisType} v2 摘要：B 方案，证据强度高。`,
      version: 2,
      isActive: true,
      status: 2,
    },
  })
  return { activeId: active.id, historicalId: historical.id }
}

async function seedLegacyAnalysis(caseId: number, sessionId: string): Promise<number> {
  const created = await prisma.caseAnalyses.create({
    data: {
      caseId,
      sessionId,
      nodeId: NODE_ID_CASE_INFO_CHECK,
      analysisType: 'legacy_analysis',
      analysisResult: 'M4 上线前的旧分析报告，无 summary。'.repeat(5),
      summary: null,
      version: 1,
      isActive: true,
      status: 2,
    },
  })
  return created.id
}

async function seedSession(caseId: number, userId: number, rng: () => number): Promise<string> {
  const sessionId = generateUuidV4(rng)
  await prisma.caseSessions.create({
    data: {
      sessionId,
      caseId,
      userId,
      scope: 'case',
      type: 1,
      status: 1,
    },
  })
  return sessionId
}

// ============== caseB（诱饵） ==============

async function buildCaseB(ownerUserId: number, rng: () => number): Promise<FixtureCaseB> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-诱饵】另一案件',
      caseTypeId: CASE_TYPE_ID_CIVIL,
      status: 1,
      userId: ownerUserId,
    },
  })

  const session = await seedSession(created.id, ownerUserId, rng)

  const materialIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const c = await prisma.caseMaterials.create({
      data: {
        caseId: created.id,
        name: `decoy-${i}.pdf`,
        type: 2,
        summary: `诱饵材料 ${i}（出现在主案件 prompt 即为泄漏）`,
        status: 3,
      },
    })
    materialIds.push(c.id)
  }

  const memoryIds: string[] = []
  const decoys = [
    { kind: 'fact', subjectKey: 'fact.contract.signed_at', text: '诱饵：合同签订于 2023-01-01' },
    { kind: 'preference', subjectKey: 'preference.contact.method', text: '诱饵：偏好邮件' },
    { kind: 'topic', subjectKey: 'topic.legal.basis', text: '诱饵：讨论过《公司法》' },
  ]
  for (const m of decoys) {
    const id = generateUuidV4(rng)
    const metadata = {
      id,
      caseId: created.id,
      kind: m.kind,
      subjectKey: m.subjectKey,
      confidence: 0.9,
      source: 'fixture',
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO case_memories (id, text, metadata) VALUES ($1::uuid, $2, $3::jsonb)`,
      id,
      m.text,
      JSON.stringify(metadata),
    )
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE id = $1::uuid`,
      id,
    )
    memoryIds.push(id)
  }

  const analysisIds: number[] = []
  for (const t of ['init_analysis', 'risk_analysis']) {
    const c = await prisma.caseAnalyses.create({
      data: {
        caseId: created.id,
        sessionId: session,
        nodeId: NODE_ID_CASE_INFO_CHECK,
        analysisType: t,
        analysisResult: `诱饵 ${t} 内容`,
        summary: `诱饵 ${t} 摘要`,
        version: 1,
        isActive: true,
        status: 2,
      },
    })
    analysisIds.push(c.id)
  }

  return { id: created.id, materialIds, memoryIds, analysisIds }
}

// ============== caseC（ARCHIVED） ==============

async function buildCaseC(ownerUserId: number, rng: () => number): Promise<FixtureCaseC> {
  const created = await prisma.cases.create({
    data: {
      title: '【eval-archived】已归档案件',
      caseTypeId: CASE_TYPE_ID_CIVIL,
      status: 999, // ARCHIVED 哨兵值，验证 fixture 不会把"非常规 status"过滤掉
      userId: ownerUserId,
    },
  })

  const material = await prisma.caseMaterials.create({
    data: {
      caseId: created.id,
      name: 'archived.pdf',
      type: 2,
      summary: '已归档',
      status: 3,
    },
  })

  const memoryId = generateUuidV4(rng)
  const metadata = {
    id: memoryId,
    caseId: created.id,
    kind: 'fact',
    subjectKey: 'fact.archived.test',
    confidence: 0.9,
    source: 'fixture',
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO case_memories (id, text, metadata) VALUES ($1::uuid, $2, $3::jsonb)`,
    memoryId,
    '已归档案件记忆',
    JSON.stringify(metadata),
  )
  await prisma.$executeRawUnsafe(
    `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE id = $1::uuid`,
    memoryId,
  )

  return { id: created.id, ownerId: ownerUserId, materialId: material.id, memoryId }
}
