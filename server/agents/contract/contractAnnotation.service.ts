/**
 * ContractAnnotation Service
 *
 * 业务规则：
 * - 创建：任何律师对自己名下的 review 都可以在任意 risk 下新增 lawyer 批注（归属校验由 handler 完成）
 * - 修改/软删：只能修改/软删自己创建的 lawyer 批注（此业务规则在 service 层强制）
 *
 * owner 校验统一由 reviewGuard.ts 的 guard 家族完成，service 不引用不存在的 getContractReviewOwnerIdDAO。
 * 错误返回用 { error: '...' as const } / { ok: true } 模式，handler 层转 resError。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { AnnotationAuthorType } from '#shared/types/contract'
import {
    createContractAnnotationDAO,
    updateContractAnnotationDAO,
    softDeleteContractAnnotationDAO,
    getContractAnnotationByIdDAO,
    restoreAnnotationPushDAO,
} from './contractAnnotation.dao'
import { getContractRiskByIdDAO } from './contractRisk.dao'

export async function createLawyerAnnotationService(params: {
    reviewId: number
    riskId: number
    content: string
    parentAnnotationId?: number | null
    user: { id: number; name: string }
}) {
    // risk-review 关联校验：确保 risk 属于该 review（handler 已校验 review 归属）
    const risk = await getContractRiskByIdDAO(params.riskId)
    if (!risk || risk.reviewId !== params.reviewId) {
        return { error: 'risk_not_found' as const }
    }

    // ANN-H1：parentAnnotationId 必须属于同一 review，否则攻击者可构造跨 review
    // 回复链探测他人 annotation id / 串扰对话气泡。FK onDelete: SetNull 不限同源，
    // 必须在 service 层强制。
    if (params.parentAnnotationId != null) {
        const parent = await getContractAnnotationByIdDAO(params.parentAnnotationId)
        if (!parent || parent.deletedAt || parent.reviewId !== params.reviewId) {
            return { error: 'parent_invalid' as const }
        }
    }

    const ann = await createContractAnnotationDAO({
        reviewId: params.reviewId,
        riskId: params.riskId,
        parentAnnotationId: params.parentAnnotationId ?? null,
        authorType: 'lawyer' as AnnotationAuthorType,
        authorName: params.user.name,
        authorUserId: params.user.id,
        content: params.content,
    })
    return { annotation: ann }
}

export async function updateAnnotationContentService(params: {
    annotationId: number
    ownerUserId: number
    content: string
}) {
    const ann = await getContractAnnotationByIdDAO(params.annotationId)
    if (!ann || ann.deletedAt) return { error: 'not_found' as const }
    if (ann.authorType !== 'lawyer' || ann.authorUserId !== params.ownerUserId) {
        return { error: 'not_own' as const }
    }
    const updated = await updateContractAnnotationDAO(params.annotationId, { content: params.content })
    return { annotation: updated }
}

/**
 * 软删（决策 11：批注永不物理删除）
 * 律师只能软删自己的 lawyer 批注；AI 批注不可删。
 */
export async function softDeleteAnnotationService(params: {
    annotationId: number
    ownerUserId: number
}): Promise<{ ok: true } | { error: 'not_found' | 'not_own' }> {
    const ann = await getContractAnnotationByIdDAO(params.annotationId)
    if (!ann || ann.deletedAt) return { error: 'not_found' }
    if (ann.authorType !== 'lawyer' || ann.authorUserId !== params.ownerUserId) {
        return { error: 'not_own' }
    }
    await softDeleteContractAnnotationDAO(params.annotationId)
    return { ok: true }
}

/**
 * VER-R3：判断一条 annotation 是否应被导出到 docx 批注。
 *
 * 规则（任一不满足返回 false）：
 *  - annotation 未软删（deletedAt 为 null）
 *  - annotation 未被客户标记 suppressInExport=true（spec §12.6）
 *  - 关联 risk 必须存在
 *  - risk.anchorParagraphIndex 必须有值（孤立批注无法注入）
 *  - risk.orphaned 不能为 true（客户改稿后锚点已失效）
 *
 * 调用方：rebuild service / reviewResultPersistence middleware /
 *         downloadContractReviewVersionService 三处共用。
 */
export interface ExportableAnnotationLike {
    deletedAt?: Date | string | null
    suppressInExport?: boolean
}
export interface ExportableRiskLike {
    anchorParagraphIndex?: number | null
    orphaned?: boolean | null
}
export function isAnnotationExportable(
    annotation: ExportableAnnotationLike,
    risk: ExportableRiskLike | null | undefined,
): boolean {
    if (annotation.deletedAt) return false
    if (annotation.suppressInExport) return false
    if (!risk) return false
    if (risk.anchorParagraphIndex === null || risk.anchorParagraphIndex === undefined) return false
    if (risk.orphaned === true) return false
    return true
}

/**
 * 数据库批注列表（含 a.risk 关联）按导出谓词过滤，并对被剔除项打统一告警日志。
 *
 * 用于 rebuild service / reviewResultPersistence middleware 等"DB 行 + 关联 risk"形态。
 * downloadContractReviewVersionService 用 snapshot.annotations + Map 查 risk 的形态不同，不走此 helper。
 */
export function filterExportableDbAnnotations<
    T extends ExportableAnnotationLike & {
        id: number
        riskId: number
        risk: ExportableRiskLike & { anchorParagraphIndex?: number | null; orphaned?: boolean | null }
    },
>(annotations: T[], reviewId: number): T[] {
    return annotations.filter(a => {
        const ok = isAnnotationExportable(a, a.risk)
        if (!ok) {
            logger.warn('[contract export] 跳过不可导出的批注（孤立 / suppressed / 软删）', {
                reviewId, annotationId: a.id, riskId: a.riskId,
                anchorParagraphIndex: a.risk.anchorParagraphIndex,
                orphaned: a.risk.orphaned,
            })
        }
        return ok
    })
}

/**
 * 恢复推送（spec §12.6 / §4.3）
 *
 * 律师手动覆盖客户删除意图：仅清 suppressInExport，保留 removedByClient=true 作为历史证据。
 * - 仅对 `removedByClient=true` 的批注有效；其他情况返回 `not_removed` 由 handler 转 409
 * - 软删（deletedAt != null）的批注不能恢复（律师已主动撤回的内容优先于客户删除历史）
 * - 与 authorType 无关：ai / lawyer / external 任何一种被客户删除的批注都允许律师恢复推送
 * - review 归属已由 reviewGuard 保证，这里不再校验
 */
export async function restoreAnnotationPushService(params: {
    annotationId: number
}): Promise<{ ok: true; suppressInExport: boolean } | { error: 'not_found' | 'not_removed' }> {
    const ann = await getContractAnnotationByIdDAO(params.annotationId)
    if (!ann || ann.deletedAt) return { error: 'not_found' }
    if (!ann.removedByClient) return { error: 'not_removed' }
    // 幂等：已经恢复过（suppressInExport=false）直接返回成功
    if (!ann.suppressInExport) return { ok: true, suppressInExport: false }
    const updated = await restoreAnnotationPushDAO(params.annotationId)
    return { ok: true, suppressInExport: updated.suppressInExport }
}
