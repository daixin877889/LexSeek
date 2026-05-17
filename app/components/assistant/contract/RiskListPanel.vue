<script setup lang="ts">
/**
 * 右侧风险清单侧栏（重做：标签切换 + 速览条 + 抽屉式详情）
 *
 * 重做后结构：
 * - 顶部 2 段标签：风险清单 / 审查总览
 * - 「风险清单」标签：风险分速览条 + 风险卡滚动区（外部新增 / 主清单 / 已处置折叠 /
 *   原文已修改 / 客户已移除 五个分组）
 * - 「审查总览」标签：整屏 OverviewPanel
 * - 风险卡不再就地展开；点卡片 → focusRisk，由 RiskDetailPanel 抽屉承载详情与操作
 * - readOnly 态：处置 / 编辑 / 回复在抽屉内禁用
 */
import {
    DownloadIcon, ChevronDownIcon, Loader2Icon, FileTextIcon,
    TriangleAlert, UserIcon, EyeOffIcon, RotateCcwIcon,
} from 'lucide-vue-next'
import { useLocalStorage } from '@vueuse/core'
import type { ContractOverview, Risk, RiskDisplayPhaseB, ContractReviewStatus, PlaybookSnapshot, ContractAnnotationEntity, RiskArchivedStatus, ContractExportMode } from '#shared/types/contract'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { AcceptableValue } from 'reka-ui'
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '~/components/ui/dropdown-menu'
import AssistantContractExportPdfDialog from '~/components/assistant/contract/ExportPdfDialog.vue'
import AssistantContractOverviewPanel from '~/components/assistant/contract/OverviewPanel.vue'
import AssistantContractRiskCard from '~/components/assistant/contract/RiskCard.vue'
import AssistantContractRiskDetailPanel from '~/components/assistant/contract/RiskDetailPanel.vue'
import AssistantContractRiskEditDialog from '~/components/assistant/contract/RiskEditDialog.vue'
import { useContractOverview } from '~/composables/useContractOverview'

const props = defineProps<{
    risks: RiskDisplayPhaseB[]
    /** Phase A：工作区或历史快照的批注列表 */
    annotations?: ContractAnnotationEntity[]
    /** Phase A：只读模式（历史版本预览时为 true） */
    readOnly?: boolean
    /** Phase A：当前登录用户 id，用于判断是否可删批注 */
    currentUserId?: number | null
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    isDownloading?: boolean
    isExportingPdf?: boolean
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
    /**
     * DocxPreview 是否已完成首次定位上报。
     * 默认 true 仅为兼容旧调用；父组件传入时可避免 docx 渲染期间把所有风险误判为"已定位"，
     * 随后又突变为"未定位"的视觉闪烁。
     */
    hasLocated?: boolean
    /**
     * 历史版本预览态下的版本号（null = 工作区）。仅用于区分下载按钮的文案与 tooltip，
     * 避免用户误把下载误解为"下载最新版"。
     */
    previewVersionNumber?: number | null
    playbookSnapshot?: PlaybookSnapshot | null
}>()

const emit = defineEmits<{
    download: [mode: ContractExportMode]
    editRisks: [risks: Risk[]]
    exportPdf: [includeRisks: boolean]
    /** null = 关闭详情抽屉（清空焦点） */
    focusRisk: [riskId: string | null]
    togglePin: [riskId: string]
    /** Phase A：处置风险 */
    archive: [riskId: string, status: RiskArchivedStatus | null]
    /** Phase A：新增批注 */
    addAnnotation: [riskId: string, content: string, parentAnnotationId?: number]
    /** Phase A：编辑批注内容 */
    updateAnnotation: [annotationId: number, content: string]
    /** Phase A：软删批注 */
    deleteAnnotation: [annotationId: number]
    /** Phase B：恢复被客户移除的批注 */
    'restore-annotation': [annotationId: number]
    /** Phase B：跳转到孤立风险的原始语境版本 */
    'jump-to-original': [riskId: string]
    /** 预览 hover「＋」新增风险：原文 + 段落序号 + 弹框收集的风险内容 */
    createRisk: [payload: { clauseText: string; clauseParagraphIndex: number; risk: Risk }]
}>()

const containerRef = ref<HTMLElement | null>(null)

/** 顶部标签：风险清单 / 审查总览（组件内本地状态，不持久化） */
const riskTab = ref<'list' | 'overview'>('list')

// 速览条：风险分 + 高/中/低计数
const overviewRisksRef = computed(() => props.risks)
const { counts: riskCounts, score: riskScore } = useContractOverview(overviewRisksRef)
const totalRiskCount = computed(() => riskCounts.value.high + riskCounts.value.medium + riskCounts.value.low)

watch(() => props.focusedRiskId, (id) => {
    if (!id) return
    nextTick(() => {
        // UI-M4：CSS.escape 包裹防 id 含特殊字符（双引号 / 反斜杠等）破坏 selector
        const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
        const el = containerRef.value?.querySelector(`[data-risk-id="${safeId}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})

// 流式冒出：追踪新增的 risk id，3 秒后自动移除
const justAddedIds = ref<Set<string>>(new Set())
// UI-H1：保存活跃的 setTimeout 句柄，组件卸载时清理避免内存泄漏
const justAddedTimers = ref<Set<ReturnType<typeof setTimeout>>>(new Set())

watch(
    () => props.risks,
    (newRisks, oldRisks) => {
        const oldIds = new Set((oldRisks ?? []).map(r => r.id))
        const newlyAdded = newRisks.filter(r => !oldIds.has(r.id)).map(r => r.id)
        if (newlyAdded.length === 0) return
        newlyAdded.forEach(id => justAddedIds.value.add(id))
        const timer = setTimeout(() => {
            newlyAdded.forEach(id => justAddedIds.value.delete(id))
            justAddedIds.value = new Set(justAddedIds.value)
            justAddedTimers.value.delete(timer)
        }, 3000)
        justAddedTimers.value.add(timer)
    },
    { deep: false },
)

onBeforeUnmount(() => {
    justAddedTimers.value.forEach(t => clearTimeout(t))
    justAddedTimers.value.clear()
})

const isCompleted = computed(() => props.status === 'completed')
const canDownload = computed(() => isCompleted.value && props.reviewedFileId !== null)
// completed 与 failed 均为可编辑终态（见 REVIEW_EDITABLE_STATUSES）
const editable = computed(() => REVIEW_EDITABLE_STATUSES.includes(props.status))

// 编辑对话框状态
const editDialogOpen = ref(false)
const editingRisk = ref<Risk | null>(null)
/** 新增模式下由预览段落 hover「＋」预填的原文与段落序号 */
const createPrefill = ref<{ clauseText: string; clauseParagraphIndex: number } | null>(null)

/** 由父组件（预览 hover「＋」）调用：以预填打开新增弹框 */
function openCreateWithPrefill(payload: { clauseText: string; clauseParagraphIndex: number }) {
    if (!editable.value) return
    editingRisk.value = null
    createPrefill.value = payload
    editDialogOpen.value = true
}
defineExpose({ openCreateWithPrefill })

function openEdit(risk: Risk) {
    if (!editable.value) return
    editingRisk.value = risk
    editDialogOpen.value = true
}
function handleEditConfirm(payload: Risk) {
    if (createPrefill.value && !props.risks.some(r => r.id === payload.id)) {
        emit('createRisk', { ...createPrefill.value, risk: payload })
        createPrefill.value = null
        return
    }
    const newRisks = props.risks.map(r => (r.id === payload.id ? payload : r))
    emit('editRisks', newRisks)
}

// 删除二次确认
const deleteDialogOpen = ref(false)
const deletingRiskId = ref<string | null>(null)
function openDelete(id: string) {
    if (!editable.value) return
    deletingRiskId.value = id
    deleteDialogOpen.value = true
}
function confirmDelete() {
    if (!deletingRiskId.value) return
    const newRisks = props.risks.filter(r => r.id !== deletingRiskId.value)
    emit('editRisks', newRisks)
    deleteDialogOpen.value = false
    deletingRiskId.value = null
}

// 导出 PDF 对话框
const exportPdfDialogOpen = ref(false)
function openExportPdf() {
    if (!canDownload.value) return
    exportPdfDialogOpen.value = true
}
function handleExportPdfConfirm(includeRisks: boolean) {
    emit('exportPdf', includeRisks)
}

// ===== Phase A：批注 + 已处置 =====

/** 隐藏已处置开关（持久化到 localStorage） */
const hideArchived = useLocalStorage('contract-hide-archived-risks', false)

/**
 * 风险卡布局偏好（持久化到 localStorage:contract-review-risk-card-layout）
 * - 'stacked'：四段式（默认）
 * - 'inline-diff'：行内差异
 * 重做后由 RiskDetailPanel 抽屉内的段控切换，此处仅持有受控值。
 */
const cardLayout = useLocalStorage<'stacked' | 'inline-diff'>(
    'contract-review-risk-card-layout',
    'stacked' as const,
)

function getArchivedStatus(r: RiskDisplayPhaseB): RiskArchivedStatus | null | undefined {
    return r.archivedStatus
}

/** 已处置风险总数（用于开关显示，不含孤立分组） */
const archivedCount = computed(() =>
    props.risks.filter(r => !!getArchivedStatus(r) && !r.orphaned).length
)

// ===== Phase B：分组计算属性 =====

/** 外部新增风险组（source=external_new），未处置在前，已处置在后 */
const externalNewRisks = computed(() => {
    const all = props.risks.filter(r => r.source === 'external_new')
    const unarchived = all.filter(r => !getArchivedStatus(r)).sort((a, b) => a.clauseIndex - b.clauseIndex)
    if (hideArchived.value) return unarchived
    const archived = all.filter(r => !!getArchivedStatus(r)).sort((a, b) => a.clauseIndex - b.clauseIndex)
    return [...unarchived, ...archived]
})

/** 主风险清单（非外部新增、非孤立），未处置在前，已处置在后 */
const mainSortKey = (r: RiskDisplayPhaseB) => r.clauseParagraphIndex ?? Number.MAX_SAFE_INTEGER
const mainRisks = computed(() => {
    const all = props.risks.filter(r => r.source !== 'external_new' && !r.orphaned)
    const unarchived = all.filter(r => !getArchivedStatus(r)).sort((a, b) => mainSortKey(a) - mainSortKey(b))
    if (hideArchived.value) return unarchived
    const archived = all.filter(r => !!getArchivedStatus(r)).sort((a, b) => mainSortKey(a) - mainSortKey(b))
    return [...unarchived, ...archived]
})

/** 孤立批注区（原文已修改，无法定位） */
const orphanedRisks = computed(() =>
    props.risks
        .filter(r => r.orphaned === true)
        .sort((a, b) => a.clauseIndex - b.clauseIndex)
)

/** 客户已移除的批注 */
const removedAnnotations = computed(() =>
    (props.annotations ?? []).filter(a => a.removedByClient)
)

/** 是否有任何内容可显示 */
const hasAnyContent = computed(() =>
    externalNewRisks.value.length > 0 ||
    mainRisks.value.length > 0 ||
    orphanedRisks.value.length > 0 ||
    removedAnnotations.value.length > 0
)

/** 客户已移除分组展开状态（默认折叠） */
const removedExpanded = ref(false)

/** 恢复推送确认对话框 */
const restoreDialogOpen = ref(false)
const pendingRestoreAnnotationId = ref<number | null>(null)

function openRestoreDialog(annotationId: number) {
    pendingRestoreAnnotationId.value = annotationId
    restoreDialogOpen.value = true
}

function confirmRestore() {
    if (pendingRestoreAnnotationId.value === null) return
    emit('restore-annotation', pendingRestoreAnnotationId.value)
    restoreDialogOpen.value = false
    pendingRestoreAnnotationId.value = null
}

/** 获取某个 risk 关联的批注（按创建时间升序） */
function annotationsForRisk(riskStringId: string): ContractAnnotationEntity[] {
    const entityId = parseInt(riskStringId, 10)
    if (!Number.isFinite(entityId)) return []
    return (props.annotations ?? [])
        .filter(a => a.riskId === entityId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

// ===== 详情抽屉：焦点风险 + 上一条 / 下一条导航 =====

/** 风险卡展示顺序（与模板分组渲染顺序一致），用于抽屉上一条 / 下一条 */
const displayRisks = computed(() => [
    ...externalNewRisks.value,
    ...mainRisks.value,
    ...orphanedRisks.value,
])
const focusedIndex = computed(() =>
    displayRisks.value.findIndex(r => r.id === props.focusedRiskId)
)
const focusedRisk = computed(() =>
    focusedIndex.value >= 0 ? displayRisks.value[focusedIndex.value]! : null
)

function goPrevRisk() {
    const i = focusedIndex.value
    if (i > 0) emit('focusRisk', displayRisks.value[i - 1]!.id)
}
function goNextRisk() {
    const i = focusedIndex.value
    if (i >= 0 && i < displayRisks.value.length - 1) emit('focusRisk', displayRisks.value[i + 1]!.id)
}

function handleArchive(riskStringId: string, status: RiskArchivedStatus | null) {
    if (props.readOnly) return
    emit('archive', riskStringId, status)
}

// ===== 导出模式 toggle（批注 / 修订 / 两者并存）=====

/**
 * 模式偏好持久化到 localStorage:contract-review-export-mode。
 * 默认 'comment' 保持向后兼容（旧用户体感不变）。
 */
const exportMode = useLocalStorage<ContractExportMode>('contract-review-export-mode', 'comment')

function handleSelectMode(value: AcceptableValue) {
    const next = value as ContractExportMode
    exportMode.value = next
    emit('download', next)
}

const exportModeLabel = computed(() => ({
    comment: '批注模式',
    redline: '修订模式',
    both: '两者并存',
} satisfies Record<ContractExportMode, string>)[exportMode.value])

const downloadButtonLabel = computed(() => {
    if (props.isDownloading) return '下载中...'
    if (props.previewVersionNumber !== null && props.previewVersionNumber !== undefined) {
        return `下载 v${props.previewVersionNumber} 历史版本`
    }
    return '下载批注 Word'
})

const downloadButtonTitle = computed(() => {
    return props.previewVersionNumber !== null && props.previewVersionNumber !== undefined
        ? `下载 v${props.previewVersionNumber} 历史版本（${exportModeLabel.value}）`
        : `下载当前工作区（${exportModeLabel.value}）`
})

function formatRemovedTime(value: string | Date): string {
    return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
    <div class="relative flex flex-col h-full min-h-0">
        <!-- 顶部标签：风险清单 / 审查总览 -->
        <div class="shrink-0 px-2.5 py-2 border-b">
            <div class="flex p-[3px] rounded-lg bg-muted border">
                <button
                    type="button"
                    class="flex-1 py-1.5 rounded-md text-xs transition-colors"
                    :class="riskTab === 'list'
                        ? 'bg-card font-semibold text-foreground'
                        : 'font-medium text-muted-foreground'"
                    @click="riskTab = 'list'"
                >风险清单 {{ totalRiskCount }}</button>
                <button
                    type="button"
                    class="flex-1 py-1.5 rounded-md text-xs transition-colors"
                    :class="riskTab === 'overview'
                        ? 'bg-card font-semibold text-foreground'
                        : 'font-medium text-muted-foreground'"
                    @click="riskTab = 'overview'"
                >审查总览</button>
            </div>
        </div>

        <!-- 审查总览标签 -->
        <ScrollArea v-if="riskTab === 'overview'" class="flex-1 min-h-0">
            <AssistantContractOverviewPanel
                :risks="risks"
                :summary="summary"
                :playbook-snapshot="playbookSnapshot ?? null"
                @focus-risk="(id: string) => emit('focusRisk', id)"
            />
        </ScrollArea>

        <!-- 风险清单标签 -->
        <template v-else>
            <!-- 风险分速览条 -->
            <div class="shrink-0 flex items-center gap-2.5 px-3 py-1.5 border-b bg-muted/30">
                <span class="inline-flex items-baseline gap-0.5">
                    <span class="text-[15px] font-bold text-red-700 dark:text-red-300">{{ riskScore }}</span>
                    <span class="text-[10px] text-muted-foreground">/100 风险分</span>
                </span>
                <span class="w-px h-3.5 bg-border" />
                <span class="inline-flex items-center gap-1 text-[11.5px] text-red-700 dark:text-red-300">
                    <span class="size-1.5 rounded-full bg-red-500" />高 {{ riskCounts.high }}
                </span>
                <span class="inline-flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-300">
                    <span class="size-1.5 rounded-full bg-orange-500" />中 {{ riskCounts.medium }}
                </span>
                <span class="inline-flex items-center gap-1 text-[11.5px] text-slate-600 dark:text-slate-300">
                    <span class="size-1.5 rounded-full bg-slate-400" />低 {{ riskCounts.low }}
                </span>
            </div>

            <ScrollArea class="flex-1 min-h-0">
                <div ref="containerRef" class="p-3 space-y-2">
                    <!-- 隐藏已处置开关 -->
                    <div v-if="archivedCount > 0" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                            :checked="hideArchived"
                            @update:checked="hideArchived = $event"
                        />
                        <span class="flex items-center gap-0.5">
                            <EyeOffIcon class="size-3" />
                            隐藏已处置（{{ archivedCount }}）
                        </span>
                    </div>

                    <!-- 只读模式提示 -->
                    <div v-if="readOnly" class="text-xs text-center text-muted-foreground py-1">
                        只读模式，编辑操作已禁用
                    </div>

                    <div v-if="!hasAnyContent" class="p-6 text-sm text-muted-foreground text-center">暂无风险条目</div>

                    <!-- ===== 外部新增分组（顶部） ===== -->
                    <template v-if="externalNewRisks.length">
                        <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground pt-1">
                            <UserIcon class="size-3" />
                            外部新增（{{ externalNewRisks.length }}）
                        </div>
                        <AssistantContractRiskCard
                            v-for="r in externalNewRisks"
                            :key="r.id"
                            :risk="r"
                            :is-focused="focusedRiskId === r.id"
                            :is-pinned="pinnedRiskIds.has(r.id)"
                            :is-hovered="hoveredRiskId === r.id"
                            :is-just-added="justAddedIds.has(r.id)"
                            :archived-status="getArchivedStatus(r)"
                            :not-located="hasLocated !== false && notLocatedIds.has(r.id)"
                            :playbook-snapshot="playbookSnapshot ?? null"
                            @focus="(id: string) => emit('focusRisk', id)"
                            @toggle-pin="(id: string) => emit('togglePin', id)"
                        />
                    </template>

                    <!-- ===== 主风险清单 ===== -->
                    <AssistantContractRiskCard
                        v-for="r in mainRisks"
                        :key="r.id"
                        :risk="r"
                        :is-focused="focusedRiskId === r.id"
                        :is-pinned="pinnedRiskIds.has(r.id)"
                        :is-hovered="hoveredRiskId === r.id"
                        :is-just-added="justAddedIds.has(r.id)"
                        :archived-status="getArchivedStatus(r)"
                        :not-located="hasLocated !== false && notLocatedIds.has(r.id)"
                        :playbook-snapshot="playbookSnapshot ?? null"
                        @focus="(id: string) => emit('focusRisk', id)"
                        @toggle-pin="(id: string) => emit('togglePin', id)"
                    />

                    <!-- 已处置折叠区（仅 hideArchived=true 且确有已处置时显示）-->
                    <button
                        v-if="hideArchived && archivedCount > 0"
                        type="button"
                        class="w-full text-xs text-muted-foreground hover:text-primary hover:bg-muted/60 border border-dashed rounded-md py-1.5 transition-colors"
                        @click="hideArchived = false"
                    >
                        已处置（{{ archivedCount }}）· 点击展开
                    </button>

                    <!-- ===== 孤立批注区（原文已修改，无法定位） ===== -->
                    <template v-if="orphanedRisks.length">
                        <div class="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 pt-1">
                            <TriangleAlert class="size-3" />
                            原文已修改 · 无法定位（{{ orphanedRisks.length }}）
                        </div>
                        <AssistantContractRiskCard
                            v-for="r in orphanedRisks"
                            :key="r.id"
                            :risk="r"
                            :is-orphaned="true"
                            :is-focused="focusedRiskId === r.id"
                            @focus="(id: string) => emit('focusRisk', id)"
                        />
                    </template>

                    <!-- ===== 客户已移除分组（底部，默认折叠） ===== -->
                    <template v-if="removedAnnotations.length">
                        <button
                            type="button"
                            class="w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-muted/60 border border-dashed rounded-md py-1.5 px-2 transition-colors"
                            @click="removedExpanded = !removedExpanded"
                        >
                            <ChevronDownIcon class="size-3 transition-transform" :class="{ 'rotate-180': removedExpanded }" />
                            客户已移除（{{ removedAnnotations.length }}）· 点击展开
                        </button>

                        <div v-if="removedExpanded" class="space-y-2 pl-2 border-l-2 border-muted">
                            <div
                                v-for="ann in removedAnnotations"
                                :key="ann.id"
                                class="flex gap-2 text-xs items-start"
                            >
                                <div class="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted text-muted-foreground">
                                    <UserIcon class="size-3" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-1">
                                        <span class="font-medium">{{ ann.authorName }}</span>
                                        <span class="text-muted-foreground text-[10px]">{{ formatRemovedTime(ann.createdAt) }}</span>
                                    </div>
                                    <div class="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-words line-through opacity-60">{{ ann.content }}</div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class="shrink-0 text-xs"
                                    :disabled="readOnly"
                                    @click="openRestoreDialog(ann.id)"
                                >
                                    <RotateCcwIcon class="size-3 mr-1" />恢复推送
                                </Button>
                            </div>
                        </div>
                    </template>
                </div>
            </ScrollArea>
        </template>

        <!-- 底部操作栏 -->
        <div class="shrink-0 p-3 border-t bg-card">
            <div class="flex gap-2">
                <Button class="flex-1" variant="outline" :disabled="!canDownload || isExportingPdf" @click="openExportPdf">
                    <Loader2Icon v-if="isExportingPdf" class="size-4 mr-1 animate-spin" />
                    <FileTextIcon v-else class="size-4 mr-1" />
                    {{ isExportingPdf ? '生成中...' : '导出评审报告' }}
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                        <Button
                            class="flex-1 bg-gradient-brand-button text-white"
                            :disabled="!canDownload || isDownloading"
                            data-testid="download-trigger"
                            :title="downloadButtonTitle"
                        >
                            <Loader2Icon v-if="isDownloading" class="size-4 mr-1 animate-spin" />
                            <DownloadIcon v-else class="size-4 mr-1" />
                            {{ downloadButtonLabel }}
                            <ChevronDownIcon class="size-3 ml-1 opacity-70" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-56">
                        <DropdownMenuLabel>导出模式</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            :model-value="exportMode"
                            @update:model-value="handleSelectMode"
                        >
                            <DropdownMenuRadioItem value="comment" data-testid="download-mode-comment">
                                批注模式
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="redline" data-testid="download-mode-redline">
                                修订模式（Track Changes）
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="both" data-testid="download-mode-both">
                                两者并存
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>

        <!-- 风险详情抽屉（focusedRiskId 命中某条风险时覆盖整个面板） -->
        <AssistantContractRiskDetailPanel
            v-if="focusedRisk"
            :risk="focusedRisk"
            :annotations="annotationsForRisk(focusedRisk.id)"
            :index="focusedIndex"
            :total="displayRisks.length"
            :read-only="readOnly ?? false"
            :editable="editable"
            :current-user-id="currentUserId"
            :is-pinned="pinnedRiskIds.has(focusedRisk.id)"
            :playbook-snapshot="playbookSnapshot ?? null"
            :layout="cardLayout"
            @close="emit('focusRisk', null)"
            @prev="goPrevRisk"
            @next="goNextRisk"
            @toggle-pin="(id: string) => emit('togglePin', id)"
            @edit-risk="openEdit"
            @delete-risk="(r: Risk) => openDelete(r.id)"
            @archive="handleArchive"
            @add-annotation="(id: string, content: string) => emit('addAnnotation', id, content)"
            @delete-annotation="(annId: number) => emit('deleteAnnotation', annId)"
            @jump-to-original="(id: string) => emit('jump-to-original', id)"
            @update:layout="cardLayout = $event"
        />

        <AssistantContractRiskEditDialog
            v-model:open="editDialogOpen"
            :risk="editingRisk"
            :prefill="createPrefill"
            @confirm="handleEditConfirm"
        />

        <AssistantContractExportPdfDialog v-model:open="exportPdfDialogOpen" @confirm="handleExportPdfConfirm" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除该风险？</AlertDialogTitle>
                    <AlertDialogDescription>删除后下次下载批注 Word 将自动同步，不会再写入该条批注。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction class="bg-destructive text-destructive-foreground" @click="confirmDelete">删除</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <!-- 恢复推送确认对话框 -->
        <AlertDialog v-model:open="restoreDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认恢复推送？</AlertDialogTitle>
                    <AlertDialogDescription>客户已明确删除过这条，再次推送可能引起反感。确认恢复吗？</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmRestore">确认恢复</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
</template>
