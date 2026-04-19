<script setup lang="ts">
/**
 * 合同审查主容器（M4）
 *
 * 职责：组合 useContractReview + 6 个子组件，承载三屏状态机。
 * - Step 1 提交屏：review == null && !isLoading → 居中 ContractSourceInput
 * - Step 2 立场 Dialog（始终挂载；open 受 awaitingStance 驱动，避免条件挂载动画异常）
 * - Step 3 结果屏：review != null → 左 ContractDocxPreview + 右 busy 条 + RiskListPanel
 *
 * runStatus 文案内联（不拆 ContractReviewStatus.vue），见 spec §9.2。
 */
import { Loader2Icon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { Risk, ContractReviewStatus, StanceRequest } from '#shared/types/contract'

const props = defineProps<{
    /** 外部传入时通过 reviewId 恢复审查（页面层从 URL ?reviewId= 读取） */
    reviewId?: number | null
}>()

const {
    review,
    isLoading,
    awaitingStance,
    onStart,
    mountReview,
    onStance,
    onDownload,
    onEditRisks,
    onRebuildDocx,
    isRebuilding,
    hasUnsavedDocxChanges,
    cancelReview,
} = useContractReview()

// 外部 reviewId 注入：仅 immediate 触发一次 mountReview；composable 未监听后续变化
watch(
    () => props.reviewId,
    async (id) => {
        if (id) await mountReview(id)
    },
    { immediate: true },
)

const statusLabel = computed(() => {
    if (!review.value) return ''
    switch (review.value.status) {
        case 'pending': return '准备中...'
        case 'reviewing': return 'AI 正在逐条审查合同条款...'
        case 'awaiting_stance': return '等待您确认审查立场'
        case 'completed': return '审查完成'
        case 'failed': return '审查失败'
        default: return ''
    }
})

// 三屏切换：提交屏与结果屏互斥；isLoading 时不闪回提交屏
const showSourceInput = computed(() => !review.value && !isLoading.value)
const showBusy = computed(() => {
    if (isLoading.value) return true
    const s = review.value?.status
    return s === 'pending' || s === 'reviewing'
})

function handleStanceConfirm(payload: StanceRequest) {
    onStance(payload)
}

/**
 * 立场 Dialog 取消 = 放弃整个审查。
 *
 * 原因：M4 立场是必选路径（审查流程无法跳过）。若仅 emit update:open=false，
 * 父层 computed `!!awaitingStance` 会立刻再次为 true → Dialog 重开，用户被卡死。
 * 因此取消语义映射为 cancelReview：停 stream + 清 review → UI 自然回到提交屏。
 *
 * 取消路径幂等：对话框点击取消会同时触发 @cancel 和 @update:open(false)，
 * 通过 isCancelling 去重避免重复调用 cancelReview。
 */
let isCancelling = false

async function handleStanceCancel() {
    if (isCancelling) return
    isCancelling = true
    try {
        await cancelReview()
    } finally {
        isCancelling = false
    }
}

function handleDialogOpenChange(open: boolean) {
    if (!open) handleStanceCancel()
}

/**
 * 非用户触发路径（例如多标签页 / 刷新后 GET 回填）首次把 review.status 从 completed
 * 切到 rebuilding 时，给用户弹个 toast。
 *
 * 注：用户点击「重新生成」的本地同步路径走 useContractReview.onRebuildDocx，自带
 * toast.info；且 rebuild-docx API 同步返回（服务端内部完成状态切换），客户端不会
 * 观察到 rebuilding 中间态，因此此 watch 在该路径下不会触发。
 */
watch(isRebuilding, (rebuilding, wasRebuilding) => {
    if (rebuilding && !wasRebuilding) {
        toast.info('批注正在重新生成，请稍候...')
    }
})
</script>

<template>
    <div class="h-full flex flex-col">
        <!-- Step 1 提交屏 -->
        <div v-if="showSourceInput" class="flex-1 flex items-center justify-center p-6">
            <div class="w-full max-w-xl">
                <h1 class="text-xl font-semibold mb-3">提交合同</h1>
                <AssistantContractContractSourceInput @submit="onStart" />
            </div>
        </div>

        <!-- Step 2 立场 Dialog：始终挂载，open 由 awaitingStance 驱动 -->
        <AssistantContractStanceSelectionDialog
            :open="!!awaitingStance"
            :party-a="awaitingStance?.partyA ?? null"
            :party-b="awaitingStance?.partyB ?? null"
            :contract-type="awaitingStance?.contractType ?? null"
            @confirm="handleStanceConfirm"
            @cancel="handleStanceCancel"
            @update:open="handleDialogOpenChange"
        />

        <!-- Step 3 结果屏 -->
        <div
            v-if="review && !showSourceInput"
            class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_400px]"
        >
            <AssistantContractContractDocxPreview
                :reviewed-file-id="review?.reviewedFileId ?? null"
                :original-file-id="review?.originalFileId ?? null"
            />
            <div class="border-l flex flex-col min-h-0">
                <div
                    v-if="showBusy"
                    class="flex items-center gap-2 p-3 border-b text-sm text-muted-foreground"
                >
                    <Loader2Icon class="size-4 animate-spin" />
                    <span>{{ statusLabel }}</span>
                </div>
                <AssistantContractRiskListPanel
                    :risks="review?.risks ?? []"
                    :status="(review?.status ?? 'pending') as ContractReviewStatus"
                    :reviewed-file-id="review?.reviewedFileId ?? null"
                    :summary="review?.summary ?? null"
                    :is-rebuilding="isRebuilding"
                    :has-unsaved-docx-changes="hasUnsavedDocxChanges"
                    @download="onDownload"
                    @rebuild="onRebuildDocx"
                    @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                />
            </div>
        </div>
    </div>
</template>
