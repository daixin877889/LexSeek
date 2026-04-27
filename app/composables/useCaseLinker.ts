/**
 * 案件关联 composable（阶段 5 · Task 12/13 共用）
 *
 * 用途：把"打开关联 Dialog → 用户选完案件 → PATCH 接口 → toast → 通知父页刷新"
 *      的流程统一封装。文书页（DraftSourceBar）和合同工作台（ReviewSourceBar）
 *      共用同一份逻辑，仅 PATCH 路径不同。
 *
 * 接入位置：父 page 在 setup 中调用 `useCaseLinker({ variant, entityId, onLinked })`，
 *      把返回的 `dialogOpen` 双向绑给 CaseLinkerDialog（Task 9 frontend-cards 提供），
 *      把 `linkCase` 当 onConfirm 传入；SourceBar 的 emit('link') / emit('change')
 *      都直接调用 `openLinker()`。
 *
 * 后端契约（admin-api 子组 Task 6/7 已就位）：
 * - PATCH `/api/v1/assistant/document/drafts/:id`  body: `{ caseId?: number | null }`
 * - PATCH `/api/v1/assistant/contract/reviews/:id` body: `{ caseId?: number | null }`
 *   - caseId=null → 解除关联
 *   - caseId 非 null → 校验归属 + 案件非已归档后写入
 *   - 错误：403 不归属 / 409 已归档（useApiFetch 自动 toast）
 */
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'

/** 实体类型决定 PATCH 路径 */
export type CaseLinkerVariant = 'document' | 'contract'

export interface UseCaseLinkerOptions {
    /** 'document' = 文书草稿；'contract' = 合同审查 */
    variant: CaseLinkerVariant
    /** 当前实体 id（draftId / reviewId）；null 时 linkCase 拒绝执行 */
    entityId: Ref<number | null>
    /**
     * PATCH 成功后的回调。父页通常用来：
     * - 重新拉详情（如 mountDraft / mountReview）以拿到最新 caseId / 案件标题
     * - 或局部更新 caseId / caseTitle 状态
     */
    onLinked?: (caseId: number | null) => void | Promise<void>
}

export function useCaseLinker(options: UseCaseLinkerOptions) {
    const dialogOpen = ref(false)
    const submitting = ref(false)

    function openLinker() {
        if (submitting.value) return
        dialogOpen.value = true
    }

    function closeLinker() {
        dialogOpen.value = false
    }

    /**
     * 提交关联/解绑请求。caseId=null 表示解除关联。
     * 给 CaseLinkerDialog 当 onConfirm 用。
     */
    async function linkCase(caseId: number | null): Promise<void> {
        const id = options.entityId.value
        if (!Number.isFinite(id) || (id ?? 0) <= 0) {
            toast.error('当前记录尚未加载完成，请稍后重试')
            return
        }
        if (submitting.value) return
        submitting.value = true
        try {
            const path = options.variant === 'document'
                ? `/api/v1/assistant/document/drafts/${id}`
                : `/api/v1/assistant/contract/reviews/${id}`
            const res = await useApiFetch(path, {
                method: 'PATCH',
                body: { caseId },
            })
            // useApiFetch 失败时返回 null（错误 toast 已弹），保持 dialog 打开让用户改
            if (res === null) return
            toast.success(caseId == null ? '已解除案件关联' : '已关联到案件')
            await options.onLinked?.(caseId)
            dialogOpen.value = false
        } finally {
            submitting.value = false
        }
    }

    return {
        /** 双向绑给 CaseLinkerDialog 的 v-model:open */
        dialogOpen,
        /** 提交中（用于按钮禁用 / loading 提示） */
        submitting,
        /** SourceBar emit('link') / emit('change') 的处理函数 */
        openLinker,
        /** 取消时主动关闭（一般不需要，Dialog 自己管 v-model） */
        closeLinker,
        /** CaseLinkerDialog 的 onConfirm */
        linkCase,
    }
}
