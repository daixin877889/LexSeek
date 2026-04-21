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
import type { Risk, ContractReviewStatus, StanceRequest, CreateReviewRequest } from '#shared/types/contract'

const props = defineProps<{
    /** 外部传入时通过 reviewId 恢复审查（页面层从 URL ?reviewId= 读取） */
    reviewId?: number | null
    /**
     * 可选：把本次审查归属到案件。案件详情 Tab 入口会把路由的 caseId 传下来；
     * 独立合同审查页面（/dashboard/assistant/contract）则为空。
     */
    caseId?: number | null
}>()

const {
    review,
    isLoading,
    awaitingStance,
    runStatus,
    onStart,
    mountReview,
    onStance,
    onDownload,
    onExportPdf,
    onEditRisks,
    onRebuildDocx,
    isRebuilding,
    hasUnsavedDocxChanges,
    cancelReview,
    stageStatus,
    totalClauses,
    analyzingClauseIndex,
    focusedRiskId,
    hoveredRiskId,
    pinnedRiskIds,
    highlightedRiskIds,
    focusRisk,
    setHoveredRisk,
    togglePin,
} = useContractReview()

// 外部 reviewId 注入：仅 immediate 触发一次 mountReview；composable 未监听后续变化
watch(
    () => props.reviewId,
    async (id) => {
        if (id) await mountReview(id)
    },
    { immediate: true },
)

/**
 * 状态文案派生顺序：
 * 1. stream runStatus 活跃（reviewing/completed/failed）→ 立即反映最新 SSE 状态
 *    —— 避免 stance confirm 之后 review.status 还是 'awaiting_stance'（要等 stream
 *    completed 触发 refreshReview 才会刷），体感"点了确认没反应"。
 * 2. runStatus 是 awaiting_stance 时不落在文案条上（由 Dialog 承载），
 *    此时 review.status 的 awaiting_stance 也不显示。
 * 3. 其它情况回退到 review.status（例如 rebuilding / 刷新后恢复的终态）。
 */
const statusLabel = computed(() => {
    if (!review.value) return ''
    const rs = runStatus.value
    if (rs === 'reviewing') return 'AI 正在逐条审查合同条款...'
    if (rs === 'completed') return '审查完成'
    if (rs === 'failed') return '审查失败'
    switch (review.value.status) {
        case 'pending': return '准备中...'
        case 'reviewing': return 'AI 正在逐条审查合同条款...'
        case 'awaiting_stance': return ''
        case 'completed': return '审查完成'
        case 'failed': return '审查失败'
        case 'rebuilding': return '正在重新生成批注...'
        default: return ''
    }
})

// 三屏切换：提交屏与结果屏互斥；isLoading 时不闪回提交屏
const showSourceInput = computed(() => !review.value && !isLoading.value)
// busy 条：stream 仍在跑 / review 仍在 pending|reviewing；stance confirm 之后
// review.status 尚未刷新时也应继续显示，防止面板误切到"空闲"观感。
const showBusy = computed(() => {
    if (isLoading.value) return true
    if (runStatus.value === 'reviewing') return true
    const s = review.value?.status
    return s === 'pending' || s === 'reviewing'
})

function handleSubmit(payload: CreateReviewRequest) {
    // 把页面层注入的 caseId 合并到创建 payload，后端校验归属后写入 review.caseId
    const caseId = props.caseId
    if (caseId && caseId > 0) {
        return onStart({ ...payload, caseId })
    }
    return onStart(payload)
}

function handleStanceConfirm(payload: StanceRequest) {
    // confirm 会同时触发子组件的 emit('update:open', false)；
    // 用 isConfirming 遮蔽那一次 dialog 关闭，防止父层误走 cancel 分支
    // 把正在 await 的 stream 置空，导致 onStance 中断、流不续跑。
    isConfirming = true
    onStance(payload).finally(() => {
        isConfirming = false
    })
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
// 正在处理用户点击的"确认"，此期间 dialog 的 open=false 不能走 cancel
let isConfirming = false

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
    if (!open && !isConfirming) handleStanceCancel()
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

// 未定位 risk id 集合（由 ContractDocxPreview decorateRisks 完成后上报）
const notLocatedIds = ref<Set<string>>(new Set())

function handleLocateResult(ids: Set<string>) {
    notLocatedIds.value = ids
}

/**
 * 聚焦 risk 的拦截层：未定位的 risk 不跳转文档（元素不存在），
 * RiskListPanel 侧的 toggle 展开/收起照常执行（由 RiskListPanel 内部维护）。
 */
function handleFocusRisk(id: string) {
    if (notLocatedIds.value.has(id)) return
    focusRisk(id)
}

// 浮动风险速览面板：默认显示，用户关闭后可通过 toolbar 重开
const showFloatingPanel = ref(true)

// Shift+click 快捷键委托（冒泡，不用 capture，避免干扰 dialog/popover 外部关闭）
function handleContainerClick(e: MouseEvent) {
    if (!e.shiftKey) return
    const target = (e.target as HTMLElement).closest('[data-risk-id]')
    if (!target) return
    const id = (target as HTMLElement).dataset.riskId
    if (id) {
        e.preventDefault()
        togglePin(id)
    }
}
</script>

<template>
    <div class="h-full flex flex-col" @click="handleContainerClick">
        <!-- Step 1 提交屏 -->
        <div v-if="showSourceInput" class="flex-1 flex items-center justify-center p-6">
            <div class="w-full max-w-xl">
                <h1 class="text-xl font-semibold mb-3">提交合同</h1>
                <AssistantContractSourceInput @submit="handleSubmit" />
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
            <AssistantContractDocxPreview
                :reviewed-file-id="review?.reviewedFileId ?? null"
                :original-file-id="review?.originalFileId ?? null"
                :risks="review?.risks ?? []"
                :focused-risk-id="focusedRiskId"
                :hovered-risk-id="hoveredRiskId"
                :highlighted-risk-ids="highlightedRiskIds"
                @focus-risk="handleFocusRisk"
                @hover-clause="setHoveredRisk"
                @locate-result="handleLocateResult"
            />
            <div class="border-l flex flex-col min-h-0">
                <AssistantContractReviewProgress
                    :stages="stageStatus"
                    :total-clauses="totalClauses"
                    :analyzing-index="analyzingClauseIndex"
                />
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
                    :focused-risk-id="focusedRiskId"
                    :hovered-risk-id="hoveredRiskId"
                    :pinned-risk-ids="pinnedRiskIds"
                    :not-located-ids="notLocatedIds"
                    @download="onDownload"
                    @rebuild="onRebuildDocx"
                    @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                    @export-pdf="(includeRisks: boolean) => onExportPdf(includeRisks)"
                    @focus-risk="handleFocusRisk"
                    @toggle-pin="togglePin"
                />
            </div>
        </div>

        <!-- 浮动风险速览（仅在结果屏挂载） -->
        <AssistantContractFloatingAnnotationPanel
            v-if="review && !showSourceInput"
            :risks="review?.risks ?? []"
            :visible="showFloatingPanel"
            :active-risk-id="focusedRiskId ?? undefined"
            @focus-risk="handleFocusRisk"
            @update:visible="(v: boolean) => (showFloatingPanel = v)"
        />
    </div>
</template>
