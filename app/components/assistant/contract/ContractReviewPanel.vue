<script setup lang="ts">
/**
 * 合同审查主容器（M4 + Phase A 版本管理集成）
 *
 * 职责：组合 useContractReview + useContractReviewVersion + 多个子组件，承载三屏状态机。
 * - Step 1 立场 Dialog（始终挂载；open 受 awaitingStance 驱动，避免条件挂载动画异常）
 * - Step 2 结果屏：左侧时间线 + 中部 DocxPreview + 右侧 RiskListPanel
 *   - 只读态（历史版本预览）：顶部显示只读横幅；工具栏显示"返回工作区"按钮
 *   - 工作区：工具栏显示"N 处未保存编辑"徽章 + "保存新版本"按钮
 *
 * runStatus 文案内联（不拆 ContractReviewStatus.vue），见 spec §9.2。
 */
import { Loader2Icon, SaveIcon, HistoryIcon, UploadIcon, TrendingUpIcon, XIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useMediaQuery, useLocalStorage } from '@vueuse/core'
import type { Risk, RiskDisplay, RiskDisplayPhaseB, ContractReviewStatus, StanceRequest, PlaybookSnapshot, RiskArchivedStatus, ReviewWithParsedRisks } from '#shared/types/contract'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import AssistantContractDocxPreview from '~/components/assistant/contract/ContractDocxPreview.vue'
import AssistantContractSaveVersionDialog from '~/components/assistant/contract/ContractSaveVersionDialog.vue'
import AssistantContractUploadNewVersionDialog from '~/components/assistant/contract/ContractUploadNewVersionDialog.vue'
import AssistantContractVersionTimeline from '~/components/assistant/contract/ContractVersionTimeline.vue'
import AssistantContractReviewProgress from '~/components/assistant/contract/ReviewProgress.vue'
import AssistantContractRiskListPanel from '~/components/assistant/contract/RiskListPanel.vue'
import AssistantContractStanceSelectionDialog from '~/components/assistant/contract/StanceSelectionDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useContractAgent } from '~/composables/agents'
import { usePanelMessageStreamContext } from '~/composables/agent-platform/usePanelMessageStreamContext'
import { useContractReviewStages } from '~/composables/contract/useContractReviewStages'
import { useContractReviewRisksEditing } from '~/composables/contract/useContractReviewRisksEditing'
import { useContractReviewLifecycle } from '~/composables/contract/useContractReviewLifecycle'
import { useContractReviewExport } from '~/composables/useContractReviewExport'
import { useContractReviewVersion } from '~/composables/useContractReviewVersion'
import { useContractRiskHighlight } from '~/composables/useContractRiskHighlight'
import { useUserStore } from '~/store/user'
import { triggerBrowserDownloadBlob, triggerBrowserDownloadUrl } from '~/utils/browserDownload'

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

// === 顶层共享 ref（sub-composable 之间共用）===
const reviewId = ref<number | null>(null)
const review = ref<ReviewWithParsedRisks | null>(null)
const hasUnsavedDocxChanges = ref(false)
const sessionIdRef = ref<string | null>(null)

// === 业务态 sub-composable ===
const stages = useContractReviewStages()
const risksEditing = useContractReviewRisksEditing({ reviewId, review, hasUnsavedDocxChanges })
const lifecycle = useContractReviewLifecycle({
    reviewId,
    review,
    hasUnsavedDocxChanges,
    stages,
    risksEditing,
})

const stageStatus = stages.stageStatus
const totalClauses = stages.totalClauses
const analyzingClauseIndex = stages.analyzingClauseIndex
const onEditRisks = risksEditing.onEditRisks

// PDF 导出 + 批注版 docx 下载（独立 composable，未拆）
const { isExportingPdf, onExportPdf, onDownload } = useContractReviewExport(reviewId)

// === 工厂：单 session（sessionId 来自 mountReview / onStart）===
const contractAgent = useContractAgent(sessionIdRef, {
    onCustomEvent: lifecycle.applyCustomEvent,
    onStreamSettled: async (status) => {
        // 流末回拉，对齐旧 useContractReview 的 status === completed/failed 行为
        if (status === 'failed') {
            toast.error('审查未能完成，请刷新页面或稍后重试')
        }
        await lifecycle.refreshReview()
    },
})

const isLoading = contractAgent.isLoading
const interruptData = contractAgent.interruptData

const { resolveInterrupt, isCurrentInterruptToolCard } = usePanelMessageStreamContext({
    interruptData,
    resumeInterrupt: (value) => contractAgent.resumeInterrupt(value),
    sessionRef: () => props.reviewId,
})

// 立场选择走专属 StanceSelectionDialog；isToolCard=true 工具卡走消息流内联，
// 其余非工具卡 interrupt（如 insufficient_points）才用 InterruptDispatcher Dialog
const shouldShowInterruptDialog = computed(() =>
    !!interruptData.value && !awaitingStance.value && !isCurrentInterruptToolCard.value,
)

// === awaitingStance / runStatus 派生（旧 useContractReview 行为）===
type AwaitingStancePayload = { partyA?: string; partyB?: string; contractType?: string }
const awaitingStance = computed<AwaitingStancePayload | null>(() => {
    const d = interruptData.value as Record<string, unknown> | null
    if (!d || d.type !== 'awaiting_stance') return null
    return {
        partyA: typeof d.partyA === 'string' ? d.partyA : undefined,
        partyB: typeof d.partyB === 'string' ? d.partyB : undefined,
        contractType: typeof d.contractType === 'string' ? d.contractType : undefined,
    }
})

type ContractRunStatus = 'idle' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'
const runStatus = computed<ContractRunStatus>(() => {
    if (awaitingStance.value) return 'awaiting_stance'
    const s = contractAgent.runStatus.value
    if (s === 'completed') return 'completed'
    if (s === 'failed') return 'failed'
    if (s === 'pending' || s === 'running' || s === 'interrupted') return 'reviewing'
    return 'idle'
})

// === mountReview / onStance / cancelReview 包装 ===
async function mountReview(id: number) {
    const r = await lifecycle.loadReview(id)
    if (!r) return
    sessionIdRef.value = r.sessionId
    await contractAgent.switchSession(r.sessionId)
    // 续订 stream 历史（switchSession 已自动调 reconnect/loadHistory）
}

async function onStance(payload: StanceRequest): Promise<boolean> {
    if (!reviewId.value) return false
    const ok = await lifecycle.submitStance(payload)
    if (!ok) return false
    // 服务端已处理 INTERRUPTED → COMPLETED 释放 + enqueue 新 run；
    // 前端只需重订阅 SSE：直接重新 switchSession 到当前 sessionId
    if (sessionIdRef.value) {
        try {
            await contractAgent.switchSession(sessionIdRef.value)
            return true
        } catch (err) {
            console.warn('立场提交后续订失败', err)
            toast.error('连接中断，请重试')
            return false
        }
    }
    return true
}

async function cancelReview() {
    await contractAgent.stopGeneration()
    lifecycle.cancelReview()
    sessionIdRef.value = null
}

// 风险高亮三态 + 定位状态集中到 useContractRiskHighlight
// （原本 focusedRiskId / hoveredRiskId / pinnedRiskIds / notLocatedIds / hasLocated
// 分散在 useContractReview + ContractReviewPanel 本地，整合后由 composable 接管）
const {
    focusedRiskId,
    hoveredRiskId,
    pinnedRiskIds,
    highlightedRiskIds,
    notLocatedIds,
    hasLocated,
    focusRisk,
    setHoveredRisk,
    togglePin,
    markLocated,
    reset: resetRiskFocus,
} = useContractRiskHighlight()

// 外部 reviewId 注入：composable 未监听后续变化，全靠这里桥接
// UI-H5：id 由 number 切换到 null（路由 SSR 切换 / 父 unmount 残留 watch）
// 时主动 cancelReview，否则旧 review 状态残留页面让用户看到 stale 数据。
watch(
    () => props.reviewId,
    async (id, prev) => {
        if (id) {
            await mountReview(id)
        } else if (prev) {
            await cancelReview()
        }
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

// 上传新版本 dialog 状态
const uploadVersionDialogOpen = ref(false)

/** 审查处于忙碌态（进行中）时禁止上传新版本 */
const isBusyForUpload = computed(() => {
    const s = review.value?.status
    return s === 'pending' || s === 'reviewing' || s === 'awaiting_stance' || s === 'rebuilding'
})

async function handleUploadComplete(payload: { newVersionId: number; summary: string }) {
    uploadVersionDialogOpen.value = false
    // toast 由 Dialog 的 uploadResult watcher 负责（bug #16：对话框提前关闭也能看到提示）
    versioning.lastUploadResult.value = { newVersionId: payload.newVersionId, summary: payload.summary }
    await Promise.all([versioning.refreshWorkspace(), versioning.refreshVersions()])
}

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
// select-version：点非 currentVersion 的节点 → 进入只读预览
// exit-preview：点 currentVersion 节点（由 timeline 组件分流）→ 回到工作区
function handleSelectVersion(versionId: number) {
    if (versionId === versioning.workspace.value.currentVersionId) {
        versioning.exitPreview()
    } else {
        versioning.enterPreview(versionId)
    }
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
const effectiveRisks = computed<RiskDisplayPhaseB[]>(() => {
    const entities = versioning.currentView.value.risks
    /**
     * 把 entity row 映射成 RiskDisplay。两条产生 entity 数据的路径：
     * - versioning.workspace（Phase A 后的工作区数据）→ entities 数组
     * - review.value.risks（GET /reviews/:id 的 entity 转换数组，在 currentVersionId 不为空时返回）
     * 两边 shape 一致，统一用本函数映射，不能直接 spread——否则 entity 字段名（clauseText / problem / id:number）
     * 跟 RiskDisplay 期望（clauseText / risk / id:string）错位，导致 RiskClauseDiff 收到 clauseText=undefined
     * 触发 dmp.diff_main(undefined) Throw 让整个 Vue 渲染崩溃 + 风险卡无法点击。
     */
    function mapEntityToDisplay(e: any): RiskDisplayPhaseB {
        return {
            id: String(e.id),
            entityId: typeof e.id === 'number' ? e.id : undefined,
            clauseIndex: e.clauseParagraphIndex ?? 0,
            clauseText: e.clauseText,
            clauseParagraphIndex: e.clauseParagraphIndex,
            level: e.level,
            category: e.category,
            problem: e.problem,
            legalBasis: e.legalBasis ?? undefined,
            analysis: e.analysis ?? '',
            risk: e.problem,
            suggestion: e.suggestion ?? '',
            suggestedClauseText: e.suggestedClauseText ?? undefined,
            // Playbook 命中：entity 字段名是 code（contract_risks.code），
            // 前端 useContractPlaybookMatch / RiskCard 读 matchedPointCode；漏映射会让"清单对照"
            // 永远 0/N 命中（即便 LLM 实际写了 code）
            matchedPointCode: e.code ?? undefined,
            archivedStatus: e.archivedStatus,
            problematicQuote: e.problematicQuote ?? undefined,
            quoteCharStart: e.quoteCharStart ?? null,
            quoteCharEnd: e.quoteCharEnd ?? null,
        }
    }

    if (entities.length > 0) {
        return entities.map<RiskDisplayPhaseB>(mapEntityToDisplay)
    }

    // fallback：review.value.risks 同样可能是 entity-shape（GET endpoint 在 currentVersionId
    // 非空时直接返回 contractRisks 表的 row spread）；用 typeof id === 'number' 探测 entity
    // 走映射，旧 JSON shape（id 是 string）保留 spread 行为
    return (review.value?.risks ?? []).map<RiskDisplayPhaseB>((r: any) => {
        if (typeof r?.id === 'number') return mapEntityToDisplay(r)
        return { ...r }
    })
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
async function handleRestoreAnnotation(annotationId: number) {
    await versioning.restoreAnnotationPush(annotationId)
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
    // UI-M1：立场提交后 1-3 秒 interruptData 仍未变，runStatus 还是
    // awaiting_stance，文案条会闪到"无文案"再切到"审查中"。短路这段窗口。
    if (isConfirming.value) return 'AI 正在逐条审查合同条款...'
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

// busy 条：stream 仍在跑 / review 仍在 pending|reviewing；stance confirm 之后
// review.status 尚未刷新时也应继续显示，防止面板误切到"空闲"观感。
const showBusy = computed(() => {
    if (isLoading.value) return true
    if (isConfirming.value) return true // UI-M1
    if (runStatus.value === 'reviewing') return true
    const s = review.value?.status
    return s === 'pending' || s === 'reviewing'
})

function handleStanceConfirm(payload: StanceRequest) {
    // confirm 会同时触发子组件的 emit('update:open', false)；
    // 用 isConfirming 遮蔽那一次 dialog 关闭，防止父层误走 cancel 分支
    // 把正在 await 的 stream 置空，导致 onStance 中断、流不续跑。
    //
    // 同时 isConfirming 参与 stanceDialogOpen 派生：用户确认后立即关 Dialog
    // （不必等 awaitingStance 随新 stream 变 null）。API 失败时回退以便重试。
    isConfirming.value = true
    // UI-M2：用 finally 同步收尾，then/catch 双分支表达不够清晰；
    // 成功时仍保持 isConfirming=true 不复位（由 awaitingStance 变 null 的 watch 复位）。
    onStance(payload)
        .then((ok) => {
            if (!ok) isConfirming.value = false
        })
        .catch(() => { isConfirming.value = false })
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

/** bug #4：历史版本预览态下对应的版本号，用于下载按钮文案区分工作区与历史版本 */
const previewVersionNumber = computed<number | null>(() => {
    const vid = versioning.previewVersionId.value
    if (vid === null) return null
    const v = versioning.versions.value.find(x => x.id === vid)
    return v?.versionNumber ?? null
})

/**
 * 下载按钮的路由：
 *   - 预览历史版本 → /reviews/versions/:versionId/download（按快照重建）
 *   - 工作区（含 review.currentVersion）→ /reviews/:id/download（走实时 rebuild）
 * 两条路径都返回 { downloadUrl, filename }，前端只负责触发浏览器下载。
 */
const isDownloading = ref(false)

async function handleDownload() {
    if (isDownloading.value) return
    isDownloading.value = true
    try {
        const previewVid = versioning.previewVersionId.value
        if (previewVid === null) {
            await onDownload()
            return
        }
        const resp = await useApiFetch<{ downloadUrl: string; filename: string }>(
            `/api/v1/assistant/contract/reviews/versions/download/${previewVid}`,
            { showError: false } as any,
        )
        if (!resp?.downloadUrl) {
            toast.error('历史版本下载失败，请稍后重试')
            return
        }
        // 走 Blob 下载，文件名由前端强绑定（见 useContractReview.onDownload 同样修正）
        try {
            const httpResp = await fetch(resp.downloadUrl)
            if (!httpResp.ok) throw new Error(`HTTP ${httpResp.status}`)
            triggerBrowserDownloadBlob(await httpResp.blob(), resp.filename)
        } catch {
            triggerBrowserDownloadUrl(resp.downloadUrl, resp.filename)
        }
    } finally {
        isDownloading.value = false
    }
}

// notLocatedIds / hasLocated 由 useContractRiskHighlight 提供，下面 watcher 触发 reset

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

// 切文档（原件 / 批注版）或切版本预览时，重置定位状态；DocxPreview 会在新一次
// renderAsync 完成后再通过 markLocated 把 hasLocated 置回 true。
watch(
    [
        () => review.value?.reviewedFileId,
        () => review.value?.originalFileId,
        () => versioning.previewVersionId.value,
    ],
    () => {
        resetRiskFocus()
    },
)

// UI-M3：risks 流式 append 时（reviewedFileId 不变但 effectiveRisks.length 变多）
// DocxPreview 还没 decorate 完，notLocatedIds 处于"上一帧"快照。短暂置 hasLocated=false
// 让 RiskListPanel 不把新 risk 误标"已定位"再立即跳成"未定位"造成视觉闪烁。
// 仅置 hasLocated=false（不清 notLocatedIds），避免在新一帧 markLocated 之前丢失上一帧定位结果。
watch(() => effectiveRisks.value.length, (newLen, prevLen) => {
    if (newLen > (prevLen ?? 0)) {
        hasLocated.value = false
    }
})

// Shift+click 快捷键委托（冒泡，不用 capture，避免干扰 dialog/popover 外部关闭）
// UI-M7：Dialog/Popover 内部的 [data-risk-id] 元素不应被 shift+click 钉住，
// 否则用户在编辑/导出 dialog 里 shift+click 会意外固定首屏卡片。
function handleContainerClick(e: MouseEvent) {
    if (!e.shiftKey) return
    const targetEl = e.target as HTMLElement | null
    if (!targetEl) return
    if (targetEl.closest('[role="dialog"], [data-state="open"]')) return
    const target = targetEl.closest('[data-risk-id]')
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
        <!-- Step 1 立场 Dialog：始终挂载，open 由 stanceDialogOpen 派生 -->
        <AssistantContractStanceSelectionDialog
            :open="stanceDialogOpen"
            :party-a="awaitingStance?.partyA ?? null"
            :party-b="awaitingStance?.partyB ?? null"
            :contract-type="awaitingStance?.contractType ?? null"
            @confirm="handleStanceConfirm"
            @cancel="handleStanceCancel"
            @update:open="handleDialogOpenChange"
        />

        <Dialog v-if="shouldShowInterruptDialog" :open="true" @update:open="() => {}">
            <DialogContent
                class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[70]"
                overlay-class="z-[70]"
                :show-close-button="false"
                @pointer-down-outside.prevent
                @escape-key-down.prevent
                @open-auto-focus.prevent
            >
                <DialogHeader class="sr-only">
                    <DialogTitle>需要您的确认</DialogTitle>
                    <DialogDescription>请处理审查中断</DialogDescription>
                </DialogHeader>
                <div class="p-6">
                    <InterruptDispatcher
                        :interrupt="interruptData as any"
                        @submit="resolveInterrupt"
                        @cancel="() => resolveInterrupt(null)"
                    />
                </div>
            </DialogContent>
        </Dialog>

        <!-- Step 2 结果屏 -->
        <div v-if="review" class="flex-1 min-h-0 flex flex-col">
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
                    :disabled="isBusyForUpload"
                    :title="isBusyForUpload ? '审查进行中，请等待完成后再上传' : ''"
                    @click="uploadVersionDialogOpen = true"
                >
                    <UploadIcon class="size-3 mr-1" />
                    上传新版本
                </Button>
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

            <!-- 本轮变化横幅：上传新版本完成后显示，可手动关闭 -->
            <div
                v-if="versioning.lastUploadResult.value"
                class="flex items-center gap-2 px-4 py-2.5 border-b bg-primary/5 border-primary/20 text-sm shrink-0"
            >
                <TrendingUpIcon class="size-4 shrink-0 text-primary" />
                <span class="font-medium text-foreground">本轮变化</span>
                <span class="text-xs text-muted-foreground flex-1 truncate">{{ versioning.lastUploadResult.value.summary }}</span>
                <button
                    data-testid="dismiss-upload-banner"
                    class="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="关闭本轮变化横幅"
                    @click="versioning.dismissUploadBanner()"
                >
                    <XIcon class="size-4" />
                </button>
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
                                    :risks="effectiveRisks"
                                    :focused-risk-id="focusedRiskId"
                                    :hovered-risk-id="hoveredRiskId"
                                    :pinned-risk-ids="pinnedRiskIds"
                                    @focus-risk="focusRisk"
                                    @hover-clause="setHoveredRisk"
                                    @locate-result="markLocated"
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
                                    :is-downloading="isDownloading"
                                    :is-exporting-pdf="isExportingPdf"
                                    :focused-risk-id="focusedRiskId"
                                    :hovered-risk-id="hoveredRiskId"
                                    :pinned-risk-ids="pinnedRiskIds"
                                    :not-located-ids="notLocatedIds"
                                :has-located="hasLocated"
                                    :playbook-snapshot="(review?.playbookSnapshot ?? null) as PlaybookSnapshot | null"
                                    :preview-version-number="previewVersionNumber"
                                    @download="handleDownload"
                                    @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                                    @export-pdf="(includeRisks: boolean) => onExportPdf(includeRisks)"
                                    @focus-risk="focusRisk"
                                    @toggle-pin="togglePin"
                                    @archive="handleArchiveRisk"
                                    @add-annotation="handleAddAnnotation"
                                    @update-annotation="handleUpdateAnnotation"
                                    @delete-annotation="handleDeleteAnnotation"
                                    @restore-annotation="handleRestoreAnnotation"
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
                                :risks="effectiveRisks"
                                :focused-risk-id="focusedRiskId"
                                :hovered-risk-id="hoveredRiskId"
                                :pinned-risk-ids="pinnedRiskIds"
                                @focus-risk="focusRisk"
                                @hover-clause="setHoveredRisk"
                                @locate-result="markLocated"
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
                                :is-downloading="isDownloading"
                                :is-exporting-pdf="isExportingPdf"
                                :focused-risk-id="focusedRiskId"
                                :hovered-risk-id="hoveredRiskId"
                                :pinned-risk-ids="pinnedRiskIds"
                                :not-located-ids="notLocatedIds"
                                :has-located="hasLocated"
                                :playbook-snapshot="(review?.playbookSnapshot ?? null) as PlaybookSnapshot | null"
                                @download="handleDownload"
                                @edit-risks="(risks: Risk[]) => onEditRisks(risks)"
                                @export-pdf="(includeRisks: boolean) => onExportPdf(includeRisks)"
                                @focus-risk="focusRisk"
                                @toggle-pin="togglePin"
                                @archive="handleArchiveRisk"
                                @add-annotation="handleAddAnnotation"
                                @update-annotation="handleUpdateAnnotation"
                                @delete-annotation="handleDeleteAnnotation"
                                @restore-annotation="handleRestoreAnnotation"
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

        <!-- 上传新版本 Dialog（UI-C1：通过 props 透传 versioning.uploadNewVersion，避免重复 new 实例） -->
        <AssistantContractUploadNewVersionDialog
            v-if="review"
            :open="uploadVersionDialogOpen"
            :review-id="review.id"
            :upload-new-version="versioning.uploadNewVersion"
            @update:open="uploadVersionDialogOpen = $event"
            @complete="handleUploadComplete"
        />

    </div>
</template>
