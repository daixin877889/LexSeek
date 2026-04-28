/**
 * 合同审查风险编辑 - 子 composable（阶段 7 拆分自 useContractReview）
 *
 * 范围：onEditRisks 乐观更新 + debounce 500ms PATCH + 失败回滚 + lastServerRisks 快照
 *
 * 客户端先乐观写入，再 debounce 提交后端；提交失败回滚到 lastServerRisks 快照。
 */

import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type { Risk, ReviewWithParsedRisks } from '#shared/types/contract'
import { useApiFetch } from '~/composables/useApiFetch'

export interface UseContractReviewRisksEditingDeps {
    reviewId: Ref<number | null>
    review: Ref<ReviewWithParsedRisks | null>
    hasUnsavedDocxChanges: Ref<boolean>
}

export function useContractReviewRisksEditing(deps: UseContractReviewRisksEditingDeps) {
    let lastServerRisks: Risk[] | null = null
    let lastServerUnsaved: boolean | null = null

    /** 重置内部快照（mountReview / onStart 时调用） */
    function resetSnapshot() {
        lastServerRisks = null
        lastServerUnsaved = false
    }

    /** 服务端最新 risks 同步（refreshReview / mountReview 后调用） */
    function syncFromServer(risks: Risk[] | null | undefined, hasUnsaved: boolean | null | undefined) {
        lastServerRisks = risks ?? []
        if (typeof hasUnsaved === 'boolean') {
            lastServerUnsaved = hasUnsaved
        }
    }

    const patchRisks = useDebounceFn(async (risks: Risk[]) => {
        if (!deps.reviewId.value) return
        const risksSnapshot = lastServerRisks ?? (deps.review.value?.risks ?? [])
        const unsavedSnapshot = lastServerUnsaved ?? false
        const resp = await useApiFetch<{ reviewId: number }>(
            `/api/v1/assistant/contract/reviews/risk-list/${deps.reviewId.value}`,
            { method: 'PATCH', body: { risks }, showError: false },
        )
        if (!resp) {
            // 失败回滚（risks + hasUnsavedDocxChanges 同步还原）
            if (deps.review.value) {
                deps.review.value = { ...deps.review.value, risks: risksSnapshot }
            }
            deps.hasUnsavedDocxChanges.value = unsavedSnapshot
            toast.error('保存风险清单失败')
            return
        }
        lastServerRisks = risks
        lastServerUnsaved = true
    }, 500)

    /** 乐观更新 + debounce 提交 */
    function onEditRisks(risks: Risk[]) {
        if (!deps.reviewId.value) return
        if (deps.review.value) {
            deps.review.value = { ...deps.review.value, risks }
        }
        deps.hasUnsavedDocxChanges.value = true
        patchRisks(risks)
    }

    return {
        onEditRisks,
        resetSnapshot,
        syncFromServer,
    }
}
