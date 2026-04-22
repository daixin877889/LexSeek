/**
 * GET /api/v1/assistant/contract/reviews/:id
 *
 * 获取合同审查详情。
 *
 * 返回字段白名单（不含 userId / deletedAt）：
 * - id, sessionId, status, contractType, partyA, partyB, stance
 * - risks, summary, originalFileId, reviewedFileId, createdAt, updatedAt
 * - currentVersionId, maxVersionNo（多版本协作新增）
 *
 * risks 字段兼容逻辑：
 * - currentVersionId === null：存量未迁移数据，直接读 review.risks JSON（legacy）
 * - currentVersionId 有值：已迁移，从 ContractRisk + ContractAnnotation 表读取
 *
 * 其中 sessionId 供前端订阅 SSE 消息使用。
 *
 * 错误码：
 * - 400：id 无效（非整数或 ≤ 0）
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：审查不存在或已软删
 *
 * 参见 spec §11 - 合同审查
 */

import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { listContractRisksDAO } from '~~/server/services/assistant/contract/contractRisk.dao'
import { listContractAnnotationsByReviewDAO } from '~~/server/services/assistant/contract/contractAnnotation.dao'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event)
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    // 兼容：currentVersionId 为 null/undefined 表示存量未迁移数据，fallback 读 legacy risks JSON
    // 用 == null 同时命中 null 与 undefined（部分 select 场景字段不返回时为 undefined）
    let risksWithAnnotations: unknown[]
    if (review.currentVersionId == null) {
        risksWithAnnotations = (review.risks as unknown[]) ?? []
    } else {
        const [risks, annotations] = await Promise.all([
            listContractRisksDAO(review.id),
            listContractAnnotationsByReviewDAO(review.id), // 已过滤 deletedAt
        ])
        risksWithAnnotations = risks.map(r => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            archivedAt: r.archivedAt?.toISOString() ?? null,
            annotations: annotations
                .filter(a => a.riskId === r.id)
                .map(a => ({
                    ...a,
                    createdAt: a.createdAt.toISOString(),
                })),
        }))
    }

    return resSuccess(event, '获取成功', {
        review: {
            id: review.id,
            sessionId: review.sessionId,
            status: review.status,
            contractType: review.contractType,
            partyA: review.partyA,
            partyB: review.partyB,
            stance: review.stance,
            risks: risksWithAnnotations,
            summary: review.summary,
            playbookSnapshot: review.playbookSnapshot,
            originalFileId: review.originalFileId,
            reviewedFileId: review.reviewedFileId,
            currentVersionId: review.currentVersionId,
            maxVersionNo: review.maxVersionNo,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
        },
    })
})
