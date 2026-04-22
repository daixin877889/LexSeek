<script setup lang="ts">
/**
 * 合同审查主容器（M4 + Phase A 版本管理集成）
 *
 * 职责：组合 useContractReview + useContractReviewVersion + 多个子组件，承载三屏状态机。
 * - Step 1 提交屏：review == null && !isLoading → 居中 ContractSourceInput
 * - Step 2 立场 Dialog（始终挂载；open 受 awaitingStance 驱动，避免条件挂载动画异常）
 * - Step 3 结果屏：左侧时间线 + 中部 DocxPreview + 右侧 RiskListPanel
 *   - 只读态（历史版本预览）：顶部显示只读横幅；工具栏显示"返回工作区"按钮
 *   - 工作区：工具栏显示"N 处未保存编辑"徽章 + "保存新版本"按钮
 *
 * runStatus 文案内联（不拆 ContractReviewStatus.vue），见 spec §9.2。
 */
import { Loader2Icon, SaveIcon, HistoryIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useMediaQuery, useLocalStorage } from '@vueuse/core'
import type { Risk, RiskDisplay, ContractReviewStatus, StanceRequest, CreateReviewRequest, PlaybookSnapshot, RiskArchivedStatus } from '#shared/types/contract'

// 当前登录用户 id，用于 RiskListPanel 判断"自己创建的批注"（允许删除/修改）
const userStore = useUserStore()
const currentUserId = computed<number | null>(() => userStore.userInfo.id || null)

const props = defineProps<{
    /** 外部传入时通过 reviewId 恢复审查（页面层从 URL ?reviewId= 读取） */
    reviewId?: number | null
    /**
     * 可选：把本次审查归属到案件。案件详情 Tab 入口会把路由的 caseId 传下来；
     * 独立合同审查页面（/dashboard/contract/:id）则为空。
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

// ===== Phase A：版本管理集成 =====
const versioningReviewId = computed(() => review.value?.id ?? 0)
const versioning = useContractReviewVersion(versioningReviewId as Ref<number>)

// review 加载后，初始化版本工作区数据
watch(
    () => review.value?.id,
    async (id) => {
        if (!id) return
        await Promise.all([versioning.refreshWorkspace(), versioning.refreshVersions()])
    },
    { immediate: true },
)

// 保存新版本 dialog 状态
const saveVersionDialogOpen = ref(false)
const isSavingVersion = ref(false)

async function handleSaveVersion(lawyerNote: string | null) {
    isSavingVersion.value = true
    try {
        const ok = await versioning.saveNewVersion(lawyerNote)
        if (ok) {
            saveVersionDialogOpen.value = false
            toast.success('版本已保存')
        } else {
            toast.error('保存失败，请稍后重试')
        }
    } finally {
        isSavingVersion.value = false
    }
}

// 时间线事件
function handleSelectVersion(versionId: number) {
    versioning.enterPreview(versionId)
}
function handleExitPreview() {
    versioning.exitPreview()
}
function handleUpdateVersionNote(versionId: number, note: string | null) {
    versioning.updateVersionNote(versionId, note)
}

/**
 * Phase A：把 ContractRiskEntity[] 映射成 RiskListPanel 能消费的 RiskDisplay[]，
 * 并携带 archivedStatus（RiskDisplay 的扩展字段，供已处置降权渲染使用）。
 *
 * 策略：
 * - 有 workspace.risks（已迁移）时，把 entity 转成 RiskDisplay 结构，entity.id（number）stringified 作为 Risk.id
 * - 否则 fallback 用 review.risks（旧 JSON 字段）
 */
const effectiveRisks = computed<RiskDisplay[]>(() => {
    const entities = versioning.currentView.value.risks
    if (entities.length > 0) {
        return entities.map<RiskDisplay>(e => ({
            id: String(e.id),
            entityId: e.id,
            clauseIndex: e.anchorParagraphIndex ?? 0,
            clauseText: e.anchorQuote,
            level: e.level,
            category: e.category,
            problem: e.problem,
            legalBasis: e.legalBasis ?? undefined,
            analysis: e.analysis ?? '',
            risk: e.problem,
            suggestion: e.suggestion ?? '',
            archivedStatus: e.archivedStatus,
        }))
    }
    return (review.value?.risks ?? []).map<RiskDisplay>(r => ({ ...r }))
})

const versionedAnnotations = computed(() => versioning.currentView.value.annotations)

// 风险处置：Risk.id 是 entity id 的 string 化（只在已迁移数据下有效）
async function handleArchiveRisk(riskStringId: string, status: RiskArchivedStatus | null) {
    const entityId = parseInt(riskStringId, 10)
    if (!Number.isFinite(entityId)) return
    await versioning.updateRiskArchivedStatus(entityId, status)
}

// 批注操作：riskStringId 是 entity id 的 string 化
async function handleAddAnnotation(riskStringId: string, content: string, parentAnnotationId?: number) {
    const entityId = parseInt(riskStringId, 10)
    if (!Number.isFinite(entityId)) return
    await versioning.addLawyerAnnotation(entityId, content, parentAnnotationId)
}
async function handleUpdateAnnotation(annotationId: number, content: string) {
    await versioning.updateAnnotation(annotationId, content)
}
async function handleDeleteAnnotation(annotationId: number) {
    await versioning.deleteAnnotation(annotationId)
}

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
    //
    // 同时 isConfirming 参与 stanceDialogOpen 派生：用户确认后立即关 Dialog
    // （不必等 awaitingStance 随新 stream 变 null）。API 失败时回退以便重试。
    isConfirming.value = true
    onStance(payload).then((ok) => {
        if (!ok) isConfirming.value = false
    }).catch(() => {
        isConfirming.value = false
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
// 正在处理用户点击的"确认"；此状态同时驱动 Dialog 立即关闭 + 遮蔽 cancel 误触发。
// 改为 ref 以便 stanceDialogOpen computed 派生。
const isConfirming = ref(false)

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
    if (!open && !isConfirming.value) handleStanceCancel()
}

/**
 * Dialog open 状态：awaitingStance 真值 + 未在确认中。
 *
 * 为什么不直接用 !!awaitingStance：后端 stance API 返回后，前端 stream.submit
 * 重订阅，但底层 LangGraph streamValues 里的 __interrupt__ 要等**下一个** state
 * 事件才会被覆盖为 null。这中间有 1~3 秒空窗，awaitingStance 仍然 truthy，
 * Dialog 继续显示给用户"卡住"的观感。用 isConfirming 短路这段窗口。
 */
const stanceDialogOpen = computed(() => !!awaitingStance.value && !isConfirming.value)

// awaitingStance 真正变 null 后复位 isConfirming，保证同一 review 再次
// 触发 awaiting_stance（罕见：服务端二次中断）时 Dialog 能正常重开。
watch(awaitingStance, (v) => {
    if (!v) isConfirming.value = false
})

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

/**
 * 结果屏左右分栏。对齐文书编辑器工作区（`dashboard/document/drafts/[id].vue`）：
 * - 右侧（风险清单）占比 = 文书编辑器左侧表单占比
 * - <1024px 走堆叠（预览上 + 风险下），避免无限横滚
 * - 比例按断点分两档并持久化到 localStorage，避免窄/宽屏互相覆盖偏好
 */
const isSplit = useMediaQuery('(min-width: 1024px)')
const isWide = useMediaQuery('(min-width: 1440px)')
const rightSizeStandard = useLocalStorage<number>('contract-review-split-right-standard', 40)
const rightSizeWide = useLocalStorage<number>('contract-review-split-right-wide', 32)
const activeRightSize = computed(() => (isWide.value ? rightSizeWide.value : rightSizeStandard.value))
function handlePanelResize(sizes: number[]) {
    const right = sizes[1]
    if (typeof right !== 'number' || !Number.isFinite(right)) return
    if (isWide.value) rightSizeWide.value = right
    else rightSizeStandard.value = right
}

/**
 * 断死循环：DocxPreview 的 watch(props.risks) 每次都会 emit locateResult；
 * 若每次无条件写 notLocatedIds，Panel 重渲 → props.risks 引用变（模板里
 * `review?.risks ?? []` 等表达式在 re-render 时可能创建新引用）→ 再触发
 * decorateRisks → 死循环。此处按内容等价性短路，内容相同就不写入。
 */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a === b) return true
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
}

function handleLocateResult(ids: Set<string>) {
    if (setsEqual(ids, notLocatedIds.value)) return
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

        <!-- Step 2 立场 Dialog：始终挂载，open 由 stanceDialogOpen 派生 -->
        <AssistantContractStanceSelectionDialog
            :open="stanceDialogOpen"
            :party-a="awaitingStance?.partyA ?? null"
            :party-b="awaitingStance?.partyB ?? null"
            :contract-type="awaitingStance?.contractType ?? null"
            @confirm="handleStanceConfirm"
            @cancel="handleStanceCancel"
            @update:open="handleDialogOpenChange"
        />

        <!-- Step 3 结果屏 -->
        <div v-if="review && !showSourceInput" class="flex-1 min-h-0 flex flex-col">
            <!-- 只读横幅：历史版本预览时显示 -->
            <div
                v-if="versioning.isReadOnly.value"
                class="flex items-center gap-2 px-4 py-2 border-b bg-muted text-muted-foreground text-sm shrink-0"
            >
                <HistoryIcon class="size-4 shrink-0" />
                <span class="font-medium text-foreground">只读模式 — 正在查看历史版本，无法编辑</span>
                <button
                    class="ml-auto text-xs underline hover:opacity-80 text-primary"
                    @click="handleExitPreview"
                >
                    返回工作区
                </button>
            </div>

            <!-- 工作区版本操作栏：非只读且有版本时显示 -->
            <div
                v-else-if="versioning.versions.value.length > 0"
                class="flex items-center gap-2 px-4 py-1.5 border-b bg-card shrink-0"
            >
                <span
                    v-if="versioning.hasUnsavedEdits.value"
                    class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                >
                    <span class="size-1.5 rounded-full bg-primary shrink-0" />
                    有未保存的编辑
                </span>
                <span class="flex-1" />
                <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-xs"
                    :disabled="!versioning.hasUnsavedEdits.value"
                    @click="saveVersionDialogOpen = true"
                >
                    <SaveIcon class="size-3 mr-1" />
                    保存新版本
                </Button>
            </div>

            <!-- 主体：时间线 + 内容区 -->
            <div class="flex-1 min-h-0 flex flex-row">
                <!-- 左侧版本时间线：有版本记录时才显示 -->
                <AssistantContractVersionTimeline
                    v-if="versioning.versions.value.length > 0"
                    :versions="versioning.versions.value"
                    :current-version-id="versioning.workspace.value.currentVersionId"
                    :preview-version-id="versioning.previewVersionId.value"
                    @select-version="handleSelectVersion"
                    @exit-preview="handleExitPreview"
                    @update-note="handleUpdateVersionNote"
                />

                <!-- 右侧内容区 -->
                <div class="flex-1 min-h-0 flex flex-col">
                    <!-- 分栏（>=1024px）：对齐文书编辑器工作区。右侧风险面板比例 = 文书编辑器左侧表单比例 -->
                    <ResizablePanelGroup
                        v-if="isSplit"
                        :key="isWide ? 'wide' : 'standard'"
                        direction="horizontal"
                        class="h-full"
                        @layout="handlePanelResize"
                    >
                        <ResizablePanel :default-size="100 - activeRightSize" :min-size="25">
                            <div class="h-full min-h-0 overflow-hidden rounded-lg border bg-muted/40 p-4 mr-1">
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
                            </div>
                        </ResizablePanel>

                        <ResizableHandle with-handle class="bg-transparent" />

                        <ResizablePanel :default-size="activeRightSize" :min-size="25">
                            <div class="h-full min-h-0 flex flex-col overflow-hidden rounded-lg border bg-card ml-1">
                                <AssistantContractReviewProgress
                                    :stages="stageStatus"
                                    :total-clauses="totalClauses"
                                    :analyzing-index="analyzingClauseIndex"
                                />
                                <div
                                    v-if="showBusy"
                                    class="flex items-center gap-2 px-3 py-2 border-b border-primary/30 bg-primary/10 dark:bg-primary/15 text-sm font-medium text-primary"
                                >
                                    <Loader2Icon class="size-4 animate-spin shrink-0" />
                                    <span class="animate-pulse">{{ statusLabel }}</span>
                                </div>
                                <AssistantContractRiskListPanel
                                    :risks="effectiveRisks"
                                    :annotations="versionedAnnotations"
                                    :read-only="versioning.isReadOnly.value"
                                    :current-user-id="currentUserId"
                                    :status="(review?.status ?? 'pending') as ContractReviewStatus"
                                    :reviewed-file-id="review?.reviewedFileId ?? null"
                                    :summary="review?.summary ?? null"
                                    :is-rebuilding="isRebuilding"
                                    :has-unsaved-docx-changes="hasUnsavedDocxChanges"
                                    :focused-risk-id="focusedRiskId"
                                    :hovered-risk-id="hoveredRiskId"
                                    :pinned-risk-ids="pinnedRiskIds"
                                    :not-located-ids="notLocatedIds"
                                    :playbook-snapshot="(review?.playbookSnapshot ?? null) as PlaybookSnapshot | null"
                                    @download="onDownload"
                                    @rebuild="onRebuildDocx"
                                    @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                                    @export-pdf="(includeRisks: boolean) => onExportPdf(includeRisks)"
                                    @focus-risk="handleFocusRisk"
                                    @toggle-pin="togglePin"
                                    @archive="handleArchiveRisk"
                                    @add-annotation="handleAddAnnotation"
                                    @update-annotation="handleUpdateAnnotation"
                                    @delete-annotation="handleDeleteAnnotation"
                                />
                            </div>
                        </ResizablePanel>
                    </ResizablePanelGroup>

                    <!-- 窄屏（<1024px）：上下堆叠，避免无限横滚 -->
                    <div v-else class="flex-1 min-h-0 flex flex-col gap-2">
                        <div class="flex-1 min-h-0 overflow-hidden rounded-lg border bg-muted/40 p-4">
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
                        </div>
                        <div class="flex-1 min-h-0 flex flex-col overflow-hidden rounded-lg border bg-card">
                            <AssistantContractReviewProgress
                                :stages="stageStatus"
                                :total-clauses="totalClauses"
                                :analyzing-index="analyzingClauseIndex"
                            />
                            <div
                                v-if="showBusy"
                                class="flex items-center gap-2 px-3 py-2 border-b border-primary/30 bg-primary/10 dark:bg-primary/15 text-sm font-medium text-primary"
                            >
                                <Loader2Icon class="size-4 animate-spin shrink-0" />
                                <span class="animate-pulse">{{ statusLabel }}</span>
                            </div>
                            <AssistantContractRiskListPanel
                                :risks="effectiveRisks"
                                :annotations="versionedAnnotations"
                                :read-only="versioning.isReadOnly.value"
                                :current-user-id="currentUserId"
                                :status="(review?.status ?? 'pending') as ContractReviewStatus"
                                :reviewed-file-id="review?.reviewedFileId ?? null"
                                :summary="review?.summary ?? null"
                                :is-rebuilding="isRebuilding"
                                :has-unsaved-docx-changes="hasUnsavedDocxChanges"
                                :focused-risk-id="focusedRiskId"
                                :hovered-risk-id="hoveredRiskId"
                                :pinned-risk-ids="pinnedRiskIds"
                                :not-located-ids="notLocatedIds"
                                :playbook-snapshot="(review?.playbookSnapshot ?? null) as PlaybookSnapshot | null"
                                @download="onDownload"
                                @rebuild="onRebuildDocx"
                                @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                                @export-pdf="(includeRisks: boolean) => onExportPdf(includeRisks)"
                                @focus-risk="handleFocusRisk"
                                @toggle-pin="togglePin"
                                @archive="handleArchiveRisk"
                                @add-annotation="handleAddAnnotation"
                                @update-annotation="handleUpdateAnnotation"
                                @delete-annotation="handleDeleteAnnotation"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 保存新版本 Dialog -->
        <AssistantContractSaveVersionDialog
            :open="saveVersionDialogOpen"
            :submitting="isSavingVersion"
            @update:open="saveVersionDialogOpen = $event"
            @confirm="handleSaveVersion"
        />

    </div>
</template>
