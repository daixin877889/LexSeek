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
    // LangGraph PostgresSaver 表（checkpoints / checkpoint_blobs / checkpoint_writes /
    // checkpoint_migrations）在多次跑批间累积旧 thread 消息，会让 LLM 在新 fixture
    // 上"记得"上次的对话（出现"再次核查"等行为，跳过工具调用），让 toolCallAccuracy
    // 数据不可重复。eval 跑批前必须清掉，每个 sessionId 都是真新 thread。
    await prisma.$executeRawUnsafe(
      `DO $$
       BEGIN
         IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'langgraph') THEN
           EXECUTE 'TRUNCATE TABLE
             langgraph.checkpoints,
             langgraph.checkpoint_blobs,
             langgraph.checkpoint_writes,
             langgraph.checkpoint_migrations
             RESTART IDENTITY CASCADE';
         END IF;
       END $$`,
    )

    // 强制修复 caseMain 节点的工具列表（产品 seedData 默认值缺 case_memory /
    // case_analysis 系列工具，导致 LLM 答"工具列表里没有 write_case_memory"）。
    // 真实工具注册表见 server/services/workflow/tools/index.ts。
    await prisma.$executeRawUnsafe(
      `UPDATE nodes
          SET tools = '["process_materials", "search_case_materials", "search_law",
                        "search_case_memory", "write_case_memory", "update_case_memory",
                        "search_case_analysis"]'::jsonb
        WHERE name = 'caseMain'`,
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

  const materialIds = await seedMaterials(created.id, ownerUserId)
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

async function seedMaterials(caseId: number, ownerUserId: number): Promise<number[]> {
  // type: 1=文本，2=文档，3=图片，4=音频
  // chunks: 每份材料预制 2-4 条真实分段，写入 case_material_embeddings 表
  // （embedding 列留 NULL，依赖 BM25/tsv 召回；retrieveWithReranking 已修 keyword 兜底）
  const items: Array<{ name: string; type: number; summary: string; chunks: string[] }> = [
    {
      name: '甲乙双方主合同.docx',
      type: 2,
      summary: '甲方天利达与乙方北方贸易于 2024-03-15 签订的主合同，总金额 380 万元',
      chunks: [
        '甲方：天利达科技集团有限公司',
        '乙方：北方贸易有限公司',
        '主合同签订日期：2024-03-15。本合同自双方盖章之日起生效。',
        '合同总金额 380 万元人民币（含税），分三期支付：首付款、中期款、尾款',
      ],
    },
    {
      name: '补充协议.pdf',
      type: 2,
      summary: '关于交付期限延长 30 天的补充协议',
      chunks: [
        '补充协议：双方同意将原合同约定的交付期限自 2024-09-30 延长至 2024-10-30',
        '延长 30 天的成本由乙方自行承担，不影响合同总金额',
      ],
    },
    {
      name: '银行回单（首付款）.pdf',
      type: 2,
      summary: '甲方支付首付款 100 万元的银行回单',
      chunks: [
        '银行回单：付款方甲方天利达科技集团，收款方乙方北方贸易',
        '付款金额：100 万元人民币（壹佰万元整）',
        '付款日期：2024-03-20，转账方式：银联企业转账',
        '本次为合同首付款，对应主合同第三条第一款的支付义务',
      ],
    },
    {
      name: '微信聊天记录.pdf',
      type: 2,
      summary: '甲乙双方就交付逾期的微信沟通记录',
      chunks: [
        '微信聊天记录：2024-11-10 乙方承认逾期交货 45 天，承诺补偿',
        '甲方反复催促交付，乙方多次推迟，最终 2024-11-15 才完成全部交付',
      ],
    },
    {
      name: '物流签收单.png',
      type: 3,
      summary: '物流签收单，证明实际交付完成时间',
      chunks: [
        '物流签收单核心信息：发货方乙方北方贸易，收货方甲方天利达科技',
        '签收人：张某（甲方采购部），签收日期：2024-11-15',
        '签收单上注明本批货物较合同约定 45 天后交付',
      ],
    },
    {
      name: '邮件往来.pdf',
      type: 2,
      summary: '甲乙双方关于争议金额的邮件往来',
      chunks: [
        '甲方邮件主张：因乙方逾期交付造成损失，要求赔偿争议金额 280 万元',
        '乙方邮件回复：仅认可部分赔偿，不接受 280 万元主张',
      ],
    },
    {
      name: '一审庭审笔录.pdf',
      type: 2,
      summary: '一审庭审笔录关键节录',
      chunks: [
        '一审庭审笔录：审判长张三主持，原告甲方代理人陈述事实经过',
        '一审审理结果：甲方主张获部分支持，案号 (2024)粤0103民初1234号',
      ],
    },
    {
      name: '调解记录.pdf',
      type: 2,
      summary: '法院主持调解的过程记录',
      chunks: [
        '调解记录：双方对争议金额 280 万元的具体分担方式仍有分歧',
        '当事人偏好通过调解方式解决，希望快速结案',
      ],
    },
  ]
  const ids: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const created = await prisma.caseMaterials.create({
      data: {
        caseId,
        name: item.name,
        type: item.type,
        summary: item.summary,
        status: 3, // 已完成
      },
    })
    ids.push(created.id)
    // 写 chunks 到 case_material_embeddings：embedding 列留 NULL，BM25 走 tsv 兜底
    // metadata.userId 必填 —— searchMaterialsByCaseOrDraftService 用 userId 做 metadataFilter
    // 不加会被全部过滤掉（recall 永远空）
    for (let j = 0; j < item.chunks.length; j++) {
      const chunkText = item.chunks[j]!
      const metadata = {
        caseId,
        userId: String(ownerUserId),
        sourceId: String(created.id),
        sourceName: item.name,
        chunkIndex: j,
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO case_material_embeddings (text, metadata)
         VALUES ($1, $2::jsonb)`,
        chunkText,
        JSON.stringify(metadata),
      )
    }
    // 一次性回填 tsv（BM25 召回需要）
    await prisma.$executeRawUnsafe(
      `UPDATE case_material_embeddings
          SET tsv = to_tsvector('chinese', COALESCE(text, ''))
        WHERE (metadata->>'sourceId')::int = $1
          AND tsv IS NULL`,
      created.id,
    )
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
    { kind: 'dialogue_note', subjectKey: 'topic.legal.basis', text: '讨论过《民法典》合同编关于违约金的条款' },
    { kind: 'dialogue_note', subjectKey: 'topic.evidence.assessment', text: '已评估微信记录的证据效力' },
    { kind: 'dialogue_note', subjectKey: 'topic.risk.financial', text: '评估了乙方的偿付能力风险' },
    { kind: 'dialogue_note', subjectKey: 'topic.precedent.search', text: '检索了类案三起，均判决支持原告' },
    { kind: 'dialogue_note', subjectKey: 'topic.strategy.mediation', text: '讨论过和解方案的可行性' },
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
    { kind: 'dialogue_note', subjectKey: 'topic.legal.basis', text: '诱饵：讨论过《公司法》' },
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
