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
import { updateContractRiskDAO } from './contractRisk.dao'

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
 * 转换好后传入 anchorParagraphIndex；本服务不做转换。
 */
export interface PersistAiRiskRow {
    /** AI 产出的 Risk（来自 #shared/types/contract，注意 risk.id 是前端 string，不写 DB） */
    risk: Risk
    /** 默认 'ai'；调用方需要 'global_review' / 'external_new' 时显式传入 */
    source?: RiskSource
    /**
     * 显式覆盖 anchorQuote。
     * - 首次审查（contractReviewMainAgent）：不传，使用 risk.clauseText
     * - 增量审查（uploadClientVersion Step 4a）：传入新条款原文（clause.text），
     *   避免 LLM 自填的 clauseText 与新条款字面差异导致后续 diff/锚点匹配失真
     */
    anchorQuote?: string
    /** 已转换好的非空段落序号（commentInjector 期望空间）；null 表示无锚点 */
    anchorParagraphIndex?: number | null
    /** Phase B：锚点首次迁移前的原文 */
    originalAnchorQuote?: string | null
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
 * - anchorQuote：row.anchorQuote ?? risk.clauseText
 * - anchorParagraphIndex：row.anchorParagraphIndex ?? null
 * - originalAnchorQuote / orphaned：仅在 row 显式提供时写入
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

    const data: Prisma.contractRisksUncheckedCreateInput[] = rows.map((row) => {
        const r = row.risk
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
            suggestion: r.suggestion ?? null,
            anchorQuote: row.anchorQuote ?? r.clauseText,
            anchorParagraphIndex: row.anchorParagraphIndex ?? null,
        }
        if (row.originalAnchorQuote !== undefined) item.originalAnchorQuote = row.originalAnchorQuote
        if (row.orphaned !== undefined) item.orphaned = row.orphaned
        return item
    })

    return client.contractRisks.createManyAndReturn({ data })
}
