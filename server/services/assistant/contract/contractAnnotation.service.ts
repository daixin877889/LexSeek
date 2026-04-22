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
