/**
 * 存量 ContractReview.risks JSON 迁移工具
 *
 * 职责：把历史 `contract_reviews.risks` JSON 字段迁移到新的
 * ContractRisk / ContractAnnotation 表，并为每个 review 生成 v1 initial_upload 快照。
 *
 * 幂等原则：
 * - 单条：`review.currentVersionId != null` 则已迁移，跳过
 * - 单条守卫：`legacy.length === 0` 说明 risks JSON 为空（审查失败/异常），跳过
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { RiskLevel, Risk } from '#shared/types/contract'
import { DEFAULT_AI_RISK_STANCE } from '#shared/types/contract'
import { createContractRiskDAO } from './contractRisk.dao'
import { createContractAnnotationDAO } from './contractAnnotation.dao'
import { saveContractReviewVersionService } from './contractReviewVersion.service'
import { renderRiskAsAnnotationText } from './contractRiskRender'

/**
 * 迁移单条 review 的 legacy risks JSON 到 ContractRisk/Annotation 表 + 生成 v1 快照
 *
 * @returns { migrated: true, risksCreated: N } 迁移完成
 * @returns { migrated: false, risksCreated: 0 } 已迁移或守卫跳过
 */
export async function migrateLegacyRisksService(
    reviewId: number,
): Promise<{ migrated: boolean; risksCreated: number }> {
    const review = await prisma.contractReviews.findUnique({
        where: { id: reviewId },
        select: {
            id: true,
            userId: true,
            risks: true,
            currentVersionId: true,
        },
    })
    if (!review) return { migrated: false, risksCreated: 0 }
    // 已迁移（currentVersionId 不为空）
    if (review.currentVersionId != null) return { migrated: false, risksCreated: 0 }

    const legacy = (review.risks as Array<Record<string, unknown>>) ?? []
    // 守卫：risks JSON 为空则跳过（审查失败/异常行，不生成 v1 快照）
    if (legacy.length === 0) return { migrated: false, risksCreated: 0 }

    let created = 0
    for (const lr of legacy) {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            code: (lr.matchedPointCode as string | undefined) ?? null,
            category: (lr.category as string | undefined) ?? '未分类',
            level: ((lr.level as string | undefined) ?? 'medium') as RiskLevel,
            stance: DEFAULT_AI_RISK_STANCE,
            problem: (lr.problem as string | undefined) ?? '',
            legalBasis: (lr.legalBasis as string | undefined) ?? null,
            analysis: ((lr.analysis ?? lr.risk) as string | undefined) ?? null,
            suggestion: (lr.suggestion as string | undefined) ?? null,
            // 存量 Risk 的完整条款原文：优先 clauseText，fallback risk 本身的 quote 字段
            clauseText: ((lr.clauseText ?? lr.quote) as string | undefined) ?? '',
            clauseParagraphIndex: (lr.clauseIndex as number | undefined) ?? null,
        })
        await createContractAnnotationDAO({
            reviewId,
            riskId: risk.id,
            authorType: 'ai',
            authorName: 'AI',
            content: renderRiskAsAnnotationText(lr),
        })
        created++
    }

    // 创建 v1 initial_upload 快照（存量迁移 docxText 传空串；Phase B 再补回填脚本）
    await saveContractReviewVersionService({
        reviewId,
        systemLabel: 'initial_upload',
        createdById: review.userId,
        docxText: '', // 存量迁移不强制回填正文，Phase B 专项补正
    })

    return { migrated: true, risksCreated: created }
}

/**
 * 批量迁移所有 currentVersionId = null 的 review
 *
 * 线性处理（避免并发大量 DB 写），适合一次性脚本。
 */
export async function migrateAllLegacyRisksService(): Promise<{ processed: number; migrated: number }> {
    const reviews = await prisma.contractReviews.findMany({
        where: { currentVersionId: null },
        select: { id: true },
    })
    let migrated = 0
    for (const r of reviews) {
        const res = await migrateLegacyRisksService(r.id)
        if (res.migrated) migrated++
    }
    return { processed: reviews.length, migrated }
}
