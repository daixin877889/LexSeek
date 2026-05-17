/**
 * ContractRisk Service
 *
 * 薄业务封装：owner 校验统一由 reviewGuard.ts 的 guard 家族完成，
 * service 层不再做归属校验，只负责接收经过校验的 riskId 做业务动作。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { Prisma, contractRisks } from '~~/generated/prisma/client'
import type { Risk, RiskArchivedStatus, RiskLevel, RiskSource, StancePreference } from '#shared/types/contract'
import { DEFAULT_AI_RISK_STANCE } from '#shared/types/contract'
import { updateContractRiskDAO, createContractRiskDAO } from './contractRisk.dao'
import { splitSentences } from './utils/splitSentences'
import { resolveQuoteAnchor } from './utils/resolveQuoteAnchor'

/**
 * 更新风险处置状态。
 * 归属校验由 handler 层通过 loadOwnedReviewByRiskId 完成，
 * service 只接收经过校验的 riskId 做业务动作。
 */
export async function archiveContractRiskService(params: {
    riskId: number
    archivedStatus: RiskArchivedStatus | null
}) {
    return updateContractRiskDAO(params.riskId, { archivedStatus: params.archivedStatus })
}

/**
 * AI 风险 → contractRisks 落库的输入行（CORE-R2）。
 *
 * 调用方负责把 segmentClauses 的 clauseIndex 通过 buildClauseToParagraphMap
 * 转换好后传入 clauseParagraphIndex；本服务不做转换。
 */
export interface PersistAiRiskRow {
    /** AI 产出的 Risk（来自 #shared/types/contract，注意 risk.id 是前端 string，不写 DB） */
    risk: Risk
    /** 默认 'ai'；调用方需要 'global_review' / 'external_new' 时显式传入 */
    source?: RiskSource
    /**
     * 显式覆盖 clauseText（NOT NULL，必有值）。
     * - 首次审查（contractReviewMainAgent）：不传，使用 risk.clauseText
     * - 增量审查（uploadClientVersion Step 4a）：传入新条款原文（clause.text），
     *   避免 LLM 自填的 clauseText 与新条款字面差异导致后续 diff/锚点匹配失真
     */
    clauseText?: string
    /** 已转换好的非空段落序号（commentInjector 期望空间）；null 表示无锚点 */
    clauseParagraphIndex?: number | null
    /** Phase B：锚点首次迁移前的原文 */
    originalClauseText?: string | null
    /** Phase B：当前版本无法定位锚点（孤立批注区） */
    orphaned?: boolean
}

/**
 * 把一批 AI 产出的 Risk 落库到 contractRisks 表（CORE-R2）。
 *
 * 统一两处旧 inline 写法的字段映射：
 * - server/services/workflow/agents/contractReviewMainAgent.ts（首次审查 V1）
 * - server/services/assistant/contract/uploadClientVersion.service.ts（Phase B 增量审查 Step 4a）
 *
 * 字段映射规则：
 * - source：默认 'ai'，调用方按需覆盖
 * - code：risk.matchedPointCode ?? null
 * - category / level / problem：直接取 risk 对应字段
 * - legalBasis / analysis / suggestion：?? null，DB 列允许 null
 * - stance：参数 stance ?? DEFAULT_AI_RISK_STANCE
 * - clauseText：row.clauseText ?? risk.clauseText（NOT NULL）
 * - clauseParagraphIndex：row.clauseParagraphIndex ?? null
 * - originalClauseText / orphaned：仅在 row 显式提供时写入
 * - clauseIndex / problematicQuote / quoteCharStart / quoteCharEnd / quoteMatchSource：
 *   PR 3 主路径接入 splitSentences + resolveQuoteAnchor，按三档 fallback 解析后落库
 *
 * 说明：
 * - risk.id 是前端字符串 UUID，contractRisks.id 是 DB 自增主键，两者不互写
 * - 用 createManyAndReturn 一次批插（Prisma 7+ 在 PostgreSQL 上保证返回行顺序与
 *   data 数组顺序一致），调用方仍可按 index 配对生成 contractAnnotations
 *
 * @param input.tx 可选事务句柄（uploadClientVersion 走 prisma.$transaction 时复用）
 */
export async function persistAiRisksAsContractRows(input: {
    reviewId: number
    rows: PersistAiRiskRow[]
    /** 默认 DEFAULT_AI_RISK_STANCE ('balanced')；增量审查可传 review.stance 透传 */
    stance?: StancePreference
    tx?: Prisma.TransactionClient
}): Promise<contractRisks[]> {
    const { reviewId, rows, tx } = input
    if (rows.length === 0) return []
    const stance = input.stance ?? DEFAULT_AI_RISK_STANCE
    const client: Prisma.TransactionClient | typeof prisma = tx ?? prisma

    // 同一条款多 risk（PR 207 后单 clause 可命中 2-5 条 risk）共享 splitSentences 结果，
    // 避免重复字符级状态机扫描（典型 500-2000 字条款单次 2-5ms × N risks）。
    const sentencesCache = new Map<string, ReturnType<typeof splitSentences>>()
    const data: Prisma.contractRisksUncheckedCreateInput[] = rows.map((row) => {
        const r = row.risk
        /**
         * 双锚点 · 层 1：完整条款。优先 row.clauseText（增量审查传新条款原文），
         * 否则用 r.clauseText（首次审查 LLM 自填）。
         */
        const clauseText = row.clauseText ?? r.clauseText

        /**
         * 双锚点 · 层 2：精准 quote 解析（spec §5.5）。
         * - 切句标 [Sn] ID（与 LLM prompt 视图对齐）
         * - resolveQuoteAnchor 三档 fallback：sentence_id → fuzzy → fallback
         * - 调用方零改动；anchor 解析逻辑收敛在 service 内部
         */
        let sentences = sentencesCache.get(clauseText)
        if (!sentences) {
            sentences = splitSentences(clauseText)
            sentencesCache.set(clauseText, sentences)
        }
        const anchor = resolveQuoteAnchor({
            clauseText,
            sentences,
            aiOutput: {
                problemSentenceIds: r.problemSentenceIds,
                problematicQuote: r.problematicQuote,
            },
        })

        const item: Prisma.contractRisksUncheckedCreateInput = {
            reviewId,
            source: row.source ?? 'ai',
            code: r.matchedPointCode ?? null,
            category: r.category,
            level: r.level as RiskLevel,
            stance,
            problem: r.problem,
            legalBasis: r.legalBasis ?? null,
            analysis: r.analysis ?? null,
            // M12：持久化 AI 生成的「立场专属法律风险」分析
            risk: r.risk ?? null,
            suggestion: r.suggestion ?? null,
            suggestedClauseText: r.suggestedClauseText ?? null,
            // 双锚点 · 层 1
            clauseText,
            clauseParagraphIndex: row.clauseParagraphIndex ?? null,
            // clauseIndex 由 PR 3 起填值；clauseCharStart/End 由 Phase B 锚点迁移路径填，首次审查不显式列出 = 数据库 NULL
            clauseIndex: r.clauseIndex,
            // 双锚点 · 层 2（PR 3 主路径填值）
            problematicQuote: anchor.problematicQuote,
            quoteCharStart: anchor.charStart,
            quoteCharEnd: anchor.charEnd,
            quoteMatchSource: anchor.matchSource,
        }
        if (row.originalClauseText !== undefined) item.originalClauseText = row.originalClauseText
        if (row.orphaned !== undefined) item.orphaned = row.orphaned
        return item
    })

    return client.contractRisks.createManyAndReturn({ data })
}

/**
 * 律师手动新增单条风险（contract-add-risk-hover）。
 *
 * source 固定 'manual'；无精确句子锚点（problematicQuote 等留 null）；
 * clauseIndex 取与 clauseParagraphIndex 相同的值，使其在 RiskListPanel 按
 * clauseParagraphIndex 排序时落在正确的段落位置。
 */
export async function addManualRiskService(input: {
    reviewId: number
    clauseText: string
    clauseParagraphIndex: number
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string | null
    analysis?: string | null
    suggestion?: string | null
    suggestedClauseText?: string | null
}): Promise<contractRisks> {
    return createContractRiskDAO({
        reviewId: input.reviewId,
        source: 'manual',
        category: input.category,
        level: input.level,
        stance: DEFAULT_AI_RISK_STANCE,
        problem: input.problem,
        legalBasis: input.legalBasis ?? null,
        analysis: input.analysis ?? null,
        suggestion: input.suggestion ?? null,
        suggestedClauseText: input.suggestedClauseText ?? null,
        clauseText: input.clauseText,
        clauseParagraphIndex: input.clauseParagraphIndex,
        clauseIndex: input.clauseParagraphIndex,
    })
}
