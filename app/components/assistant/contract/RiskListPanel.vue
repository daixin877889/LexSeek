<script setup lang="ts">
/**
 * 右侧风险清单侧栏（M5 CRUD + Phase A 版本管理 + Phase B 三分组）
 *
 * Phase A 扩展：
 * - 批注对话线（AI 系统注释 + 律师批注气泡，按时间从旧到新排列）
 * - 已处置风险降权（opacity-60 + 处置徽章）
 * - "隐藏已处置"持久化开关
 * - readOnly 态：处置按钮、回复框、删除按钮全部 disabled
 *
 * Phase B 扩展：
 * - 外部新增分组（顶部，source=external_new）
 * - 孤立批注区（原文已修改，orphaned=true）
 * - 客户已移除分组（底部，annotation.removedByClient=true，默认折叠）
 */
import {
    DownloadIcon, ChevronDownIcon, Loader2Icon, PlusIcon, PencilIcon, Trash2Icon,
    FileTextIcon, Pin, TriangleAlert, ClipboardList, CheckCircle2Icon, XCircleIcon,
    SendIcon, MessageCircleIcon, UserIcon, BotIcon, EyeOffIcon, RotateCcwIcon,
    SparklesIcon,
} from 'lucide-vue-next'
import { useLocalStorage } from '@vueuse/core'
import type { ContractOverview, Risk, RiskDisplay, ContractReviewStatus, PlaybookSnapshot, ContractAnnotationEntity, RiskArchivedStatus, RiskSource } from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'

// Phase B 本地类型扩展（不修改 shared/types/contract.ts）
type RiskDisplayPhaseB = RiskDisplay & {
    source?: RiskSource
    orphaned?: boolean
    originalAnchorQuote?: string | null
}

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
    isRebuilding: boolean
    hasUnsavedDocxChanges: boolean
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
    download: []
    rebuild: []
    editRisks: [risks: Risk[]]
    exportPdf: [includeRisks: boolean]
    focusRisk: [riskId: string]
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
}>()

const containerRef = ref<HTMLElement | null>(null)

const expandedId = ref<string | null>(null)

watch(() => props.focusedRiskId, (id) => {
    if (!id) return
    nextTick(() => {
        const el = containerRef.value?.querySelector(`[data-risk-id="${id}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})

// 流式冒出：追踪新增的 risk id，3 秒后自动移除
const justAddedIds = ref<Set<string>>(new Set())

watch(
    () => props.risks,
    (newRisks, oldRisks) => {
        const oldIds = new Set((oldRisks ?? []).map(r => r.id))
        const newlyAdded = newRisks.filter(r => !oldIds.has(r.id)).map(r => r.id)
        if (newlyAdded.length === 0) return
        newlyAdded.forEach(id => justAddedIds.value.add(id))
        setTimeout(() => {
            newlyAdded.forEach(id => justAddedIds.value.delete(id))
            justAddedIds.value = new Set(justAddedIds.value)
        }, 3000)
    },
    { deep: false },
)

function toggle(id: string) {
    expandedId.value = expandedId.value === id ? null : id
}

const isCompleted = computed(() => props.status === 'completed')
const canDownload = computed(() => isCompleted.value && props.reviewedFileId !== null)
const canRebuild = computed(() => props.hasUnsavedDocxChanges && !props.isRebuilding && isCompleted.value)
const editable = computed(() => !props.isRebuilding && isCompleted.value)

// 编辑对话框状态
const editDialogOpen = ref(false)
const editingRisk = ref<Risk | null>(null)

function openCreate() {
    if (!editable.value) return
    editingRisk.value = null
    editDialogOpen.value = true
}
function openEdit(risk: Risk) {
    if (!editable.value) return
    editingRisk.value = risk
    editDialogOpen.value = true
}
function handleEditConfirm(payload: Risk) {
    const idx = props.risks.findIndex(r => r.id === payload.id)
    const newRisks = idx >= 0
        ? props.risks.map(r => (r.id === payload.id ? payload : r))
        : [...props.risks, payload]
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

const LEVEL_CLASS: Record<Risk['level'], string> = {
    high: 'bg-red-500 text-white',
    medium: 'bg-orange-500 text-white',
    low: 'bg-gray-400 text-white',
}

function pointByCode(code: string) {
    return props.playbookSnapshot?.points.find(p => p.code === code) ?? null
}

function titleForRisk(r: Risk): string | null {
    if (!r.matchedPointCode) return null
    return pointByCode(r.matchedPointCode)?.title ?? null
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

/** 已处置状态文案 */
const ARCHIVED_STATUS_LABEL: Record<RiskArchivedStatus, string> = {
    handled: '已处理',
    ignored: '已忽略',
}

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
const mainRisks = computed(() => {
    const all = props.risks.filter(r => r.source !== 'external_new' && !r.orphaned)
    const unarchived = all.filter(r => !getArchivedStatus(r)).sort((a, b) => a.clauseIndex - b.clauseIndex)
    if (hideArchived.value) return unarchived
    const archived = all.filter(r => !!getArchivedStatus(r)).sort((a, b) => a.clauseIndex - b.clauseIndex)
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

/** 获取某个 risk 的外部批注（authorType=external），直接过滤不需要排序 */
function externalAnnotationsForRisk(riskStringId: string): ContractAnnotationEntity[] {
    const entityId = parseInt(riskStringId, 10)
    if (!Number.isFinite(entityId)) return []
    return (props.annotations ?? []).filter(a => a.riskId === entityId && a.authorType === 'external')
}

/** 每个 risk 的回复输入框内容 */
const replyContents = ref<Record<string, string>>({})

function handleAddAnnotation(riskStringId: string) {
    const content = (replyContents.value[riskStringId] ?? '').trim()
    if (!content) return
    emit('addAnnotation', riskStringId, content)
    replyContents.value[riskStringId] = ''
}

function handleArchive(riskStringId: string, status: RiskArchivedStatus | null) {
    if (props.readOnly) return
    emit('archive', riskStringId, status)
}
</script>

<template>
    <div class="flex flex-col h-full min-h-0">
        <div v-if="isRebuilding" class="p-3 border-b bg-muted/30 text-sm text-muted-foreground flex items-center gap-2 shrink-0">
            <Loader2Icon class="size-4 animate-spin" />
            <span>批注正在重新生成...</span>
        </div>

        <ScrollArea class="flex-1 min-h-0">
            <AssistantContractOverviewPanel
                :risks="risks"
                :summary="summary"
                :playbook-snapshot="playbookSnapshot ?? null"
                @focus-risk="(id: string) => emit('focusRisk', id)"
            />
            <div ref="containerRef" class="p-3 space-y-2">
                <!-- 顶部操作行：新增风险 + 隐藏已处置开关 -->
                <div class="flex items-center gap-2">
                    <Button variant="outline" class="flex-1" :disabled="!editable || readOnly" @click="openCreate">
                        <PlusIcon class="size-4 mr-1" />新增风险
                    </Button>
                    <div v-if="archivedCount > 0" class="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                        <Switch
                            :checked="hideArchived"
                            @update:checked="hideArchived = $event"
                        />
                        <span class="flex items-center gap-0.5">
                            <EyeOffIcon class="size-3" />
                            隐藏已处置（{{ archivedCount }}）
                        </span>
                    </div>
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

                    <Card
                        v-for="r in externalNewRisks"
                        :key="r.id"
                        :data-risk-id="r.id"
                        :data-just-added="justAddedIds.has(r.id) ? 'true' : 'false'"
                        title="客户在新版本中新增的批注 / 条款变更，点击跳转到原文对应位置"
                        class="cursor-pointer relative transition-all border-l-4 border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-950/30"
                        :class="{
                            'opacity-60 grayscale-[0.2]': !!getArchivedStatus(r),
                            'ring-1 ring-yellow-300 dark:ring-yellow-700': justAddedIds.has(r.id),
                            'bg-yellow-100 dark:bg-yellow-950/40': focusedRiskId === r.id,
                            'bg-orange-100 dark:bg-orange-950/50': pinnedRiskIds.has(r.id) && focusedRiskId !== r.id,
                        }"
                        @click="toggle(r.id); emit('focusRisk', r.id)"
                    >
                        <CardHeader class="py-2 px-3">
                            <div class="flex items-center gap-2">
                                <span class="inline-block px-2 py-0.5 rounded text-xs shrink-0" :class="LEVEL_CLASS[r.level]">{{ RISK_LEVEL_LABEL[r.level] }}</span>
                                <span class="text-sm font-medium truncate">{{ r.category }}</span>
                                <!-- 已处置徽章 -->
                                <Badge
                                    v-if="getArchivedStatus(r)"
                                    variant="secondary"
                                    class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5"
                                >
                                    <CheckCircle2Icon class="size-2.5" />
                                    {{ ARCHIVED_STATUS_LABEL[getArchivedStatus(r)!] }}
                                </Badge>
                                <!-- AI 已重审徽章 -->
                                <Badge
                                    v-if="r.originalAnchorQuote"
                                    variant="secondary"
                                    class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5 bg-primary/10 text-primary"
                                >
                                    <SparklesIcon class="size-2.5" />
                                    AI 已重审
                                </Badge>
                                <!-- 外部批注来源标签 -->
                                <template v-for="ann in externalAnnotationsForRisk(r.id)" :key="ann.id">
                                    <Badge variant="secondary" class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5">
                                        <UserIcon class="size-2.5" />
                                        {{ ann.authorName }}外部批注
                                    </Badge>
                                </template>
                                <button
                                    class="ml-auto text-xs px-1.5 py-0.5 rounded hover:bg-muted flex items-center gap-1 shrink-0"
                                    :class="{ 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-200': pinnedRiskIds.has(r.id) }"
                                    :aria-label="pinnedRiskIds.has(r.id) ? '取消钉住' : '钉住'"
                                    @click.stop="emit('togglePin', r.id)"
                                >
                                    <Pin class="size-3" />
                                    <span v-if="pinnedRiskIds.has(r.id)">已钉</span>
                                </button>
                                <ChevronDownIcon class="size-4 transition-transform shrink-0 text-muted-foreground" :class="{ 'rotate-180': expandedId === r.id }" />
                            </div>
                            <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ r.problem }}</div>
                        </CardHeader>
                        <CardContent v-if="expandedId === r.id" class="py-2 px-3 text-sm space-y-3" @click.stop>
                            <AssistantContractRiskClauseDiff :clause-text="r.clauseText" :suggested-clause-text="r.suggestedClauseText" />
                            <div v-if="r.legalBasis"><div class="text-xs text-muted-foreground">法律依据</div><div>{{ r.legalBasis }}</div></div>
                            <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ r.analysis }}</div></div>
                            <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ r.risk }}</div></div>
                            <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ r.suggestion }}</div></div>

                            <div class="flex gap-2 pt-2 border-t flex-wrap">
                                <Button size="sm" variant="outline" :disabled="!editable || readOnly" @click="openEdit(r)">
                                    <PencilIcon class="size-3 mr-1" />编辑
                                </Button>
                                <Button size="sm" variant="outline" class="text-destructive" :disabled="!editable || readOnly" @click="openDelete(r.id)">
                                    <Trash2Icon class="size-3 mr-1" />删除
                                </Button>
                                <template v-if="isCompleted && !readOnly && annotations !== undefined">
                                    <Button
                                        v-if="!getArchivedStatus(r)"
                                        size="sm"
                                        variant="outline"
                                        class="text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                                        @click="handleArchive(r.id, 'handled')"
                                    >
                                        <CheckCircle2Icon class="size-3 mr-1" />标记已处理
                                    </Button>
                                    <Button
                                        v-if="!getArchivedStatus(r)"
                                        size="sm"
                                        variant="outline"
                                        class="text-muted-foreground"
                                        @click="handleArchive(r.id, 'ignored')"
                                    >
                                        <XCircleIcon class="size-3 mr-1" />标记忽略
                                    </Button>
                                    <Button v-if="getArchivedStatus(r)" size="sm" variant="outline" @click="handleArchive(r.id, null)">
                                        撤销处置
                                    </Button>
                                </template>
                            </div>

                            <!-- 批注对话线 -->
                            <div class="pt-2 border-t space-y-2">
                                <div class="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <MessageCircleIcon class="size-3" />
                                    批注（{{ annotationsForRisk(r.id).length }}）
                                </div>
                                <div v-for="ann in annotationsForRisk(r.id)" :key="ann.id" class="flex gap-2 text-xs">
                                    <div
                                        class="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                                        :class="ann.authorType === 'ai' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                                    >
                                        <BotIcon v-if="ann.authorType === 'ai'" class="size-3" />
                                        <UserIcon v-else class="size-3" />
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-1">
                                            <span class="font-medium">{{ ann.authorType === 'ai' ? 'AI' : ann.authorName }}</span>
                                            <span class="text-muted-foreground text-[10px]">{{ new Date(ann.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                                            <button
                                                v-if="!readOnly && ann.authorType === 'lawyer' && ann.authorUserId === currentUserId"
                                                class="ml-auto text-muted-foreground hover:text-destructive"
                                                aria-label="删除批注"
                                                @click="emit('deleteAnnotation', ann.id)"
                                            >
                                                <Trash2Icon class="size-3" />
                                            </button>
                                        </div>
                                        <div class="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{{ ann.content }}</div>
                                    </div>
                                </div>
                                <div v-if="!readOnly && isCompleted" class="flex gap-2 mt-2">
                                    <Textarea
                                        v-model="replyContents[r.id]"
                                        placeholder="添加批注..."
                                        :rows="2"
                                        :maxlength="500"
                                        class="text-xs flex-1"
                                        :disabled="readOnly"
                                        @keydown.enter.ctrl.prevent="handleAddAnnotation(r.id)"
                                    />
                                    <Button
                                        size="icon"
                                        class="size-8 shrink-0 self-end"
                                        :disabled="readOnly || !(replyContents[r.id]?.trim())"
                                        aria-label="发送批注"
                                        @click="handleAddAnnotation(r.id)"
                                    >
                                        <SendIcon class="size-3.5" />
                                    </Button>
                                </div>
                                <div v-else-if="readOnly" class="text-xs text-muted-foreground italic">只读模式，无法添加批注</div>
                            </div>
                        </CardContent>
                    </Card>
                </template>

                <!-- ===== 主风险清单 ===== -->
                <Card
                    v-for="r in mainRisks"
                    :key="r.id"
                    :data-risk-id="r.id"
                    :data-just-added="justAddedIds.has(r.id) ? 'true' : 'false'"
                    class="cursor-pointer relative transition-all"
                    :class="{
                        'opacity-60 grayscale-[0.2]': !!getArchivedStatus(r),
                        'bg-yellow-50 dark:bg-yellow-950/40 ring-1 ring-yellow-300 dark:ring-yellow-700': justAddedIds.has(r.id),
                        'bg-yellow-50 dark:bg-yellow-950/40 border-l-4 border-red-500 dark:border-red-400': focusedRiskId === r.id,
                        'bg-orange-50 dark:bg-orange-950/40 border-l-4 border-orange-500 dark:border-orange-400': pinnedRiskIds.has(r.id) && focusedRiskId !== r.id,
                        'bg-yellow-50 dark:bg-yellow-950/30': hoveredRiskId === r.id && focusedRiskId !== r.id && !pinnedRiskIds.has(r.id),
                    }"
                    @click="toggle(r.id); emit('focusRisk', r.id)"
                >
                    <span v-if="justAddedIds.has(r.id)" class="absolute top-1 left-1 bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 text-[10px] px-1.5 rounded">刚刚</span>
                    <CardHeader class="py-2 px-3">
                        <div class="flex items-center gap-2">
                            <span class="inline-block px-2 py-0.5 rounded text-xs shrink-0" :class="LEVEL_CLASS[r.level]">{{ RISK_LEVEL_LABEL[r.level] }}</span>
                            <span class="text-sm font-medium truncate">{{ r.category }}</span>
                            <!-- 已处置徽章 -->
                            <Badge
                                v-if="getArchivedStatus(r)"
                                variant="secondary"
                                class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5"
                            >
                                <CheckCircle2Icon class="size-2.5" />
                                {{ ARCHIVED_STATUS_LABEL[getArchivedStatus(r)!] }}
                            </Badge>
                            <!-- AI 已重审徽章：经历过锚点迁移的风险条目 -->
                            <Badge
                                v-if="r.originalAnchorQuote"
                                variant="secondary"
                                class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5 bg-primary/10 text-primary"
                            >
                                <SparklesIcon class="size-2.5" />
                                AI 已重审
                            </Badge>
                            <TooltipProvider v-if="titleForRisk(r)">
                                <Tooltip>
                                    <TooltipTrigger as-child>
                                        <Badge
                                            variant="secondary"
                                            class="text-[10px] px-1.5 py-0 font-normal shrink-0 gap-0.5 flex items-center cursor-help"
                                            @click.stop
                                        >
                                            <ClipboardList class="size-2.5" />
                                            {{ titleForRisk(r) }}
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent class="max-w-xs text-xs space-y-1">
                                        <div class="font-semibold">{{ titleForRisk(r) }}</div>
                                        <div v-if="pointByCode(r.matchedPointCode!)?.checkContent">
                                            <span class="text-muted-foreground">检查：</span>{{ pointByCode(r.matchedPointCode!)?.checkContent }}
                                        </div>
                                        <div v-if="pointByCode(r.matchedPointCode!)?.legalBasis">
                                            <span class="text-muted-foreground">法律依据：</span>{{ pointByCode(r.matchedPointCode!)?.legalBasis }}
                                        </div>
                                        <div v-if="pointByCode(r.matchedPointCode!)?.suggestion">
                                            <span class="text-muted-foreground">建议：</span>{{ pointByCode(r.matchedPointCode!)?.suggestion }}
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <span
                                v-if="hasLocated !== false && notLocatedIds.has(r.id)"
                                class="text-[10px] px-1.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-0.5 shrink-0"
                            >
                                <TriangleAlert class="size-2.5" />
                                未定位
                            </span>
                            <button
                                class="ml-auto text-xs px-1.5 py-0.5 rounded hover:bg-muted flex items-center gap-1 shrink-0"
                                :class="{ 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-200': pinnedRiskIds.has(r.id) }"
                                :aria-label="pinnedRiskIds.has(r.id) ? '取消钉住' : '钉住'"
                                @click.stop="emit('togglePin', r.id)"
                            >
                                <Pin class="size-3" />
                                <span v-if="pinnedRiskIds.has(r.id)">已钉</span>
                            </button>
                            <ChevronDownIcon class="size-4 transition-transform shrink-0 text-muted-foreground" :class="{ 'rotate-180': expandedId === r.id }" />
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ r.problem }}</div>
                    </CardHeader>
                    <CardContent v-if="expandedId === r.id" class="py-2 px-3 text-sm space-y-3" @click.stop>
                        <AssistantContractRiskClauseDiff :clause-text="r.clauseText" :suggested-clause-text="r.suggestedClauseText" />
                        <div v-if="r.legalBasis"><div class="text-xs text-muted-foreground">法律依据</div><div>{{ r.legalBasis }}</div></div>
                        <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ r.analysis }}</div></div>
                        <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ r.risk }}</div></div>
                        <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ r.suggestion }}</div></div>

                        <div class="flex gap-2 pt-2 border-t flex-wrap">
                            <Button size="sm" variant="outline" :disabled="!editable || readOnly" @click="openEdit(r)">
                                <PencilIcon class="size-3 mr-1" />编辑
                            </Button>
                            <Button size="sm" variant="outline" class="text-destructive" :disabled="!editable || readOnly" @click="openDelete(r.id)">
                                <Trash2Icon class="size-3 mr-1" />删除
                            </Button>
                            <template v-if="isCompleted && !readOnly && annotations !== undefined">
                                <Button
                                    v-if="!getArchivedStatus(r)"
                                    size="sm"
                                    variant="outline"
                                    class="text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                                    @click="handleArchive(r.id, 'handled')"
                                >
                                    <CheckCircle2Icon class="size-3 mr-1" />标记已处理
                                </Button>
                                <Button
                                    v-if="!getArchivedStatus(r)"
                                    size="sm"
                                    variant="outline"
                                    class="text-muted-foreground"
                                    @click="handleArchive(r.id, 'ignored')"
                                >
                                    <XCircleIcon class="size-3 mr-1" />标记忽略
                                </Button>
                                <Button
                                    v-if="getArchivedStatus(r)"
                                    size="sm"
                                    variant="outline"
                                    @click="handleArchive(r.id, null)"
                                >
                                    撤销处置
                                </Button>
                            </template>
                        </div>

                        <!-- 批注对话线 -->
                        <div class="pt-2 border-t space-y-2">
                            <div class="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <MessageCircleIcon class="size-3" />
                                批注（{{ annotationsForRisk(r.id).length }}）
                            </div>

                            <div v-for="ann in annotationsForRisk(r.id)" :key="ann.id" class="flex gap-2 text-xs">
                                <div
                                    class="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                                    :class="ann.authorType === 'ai' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                                >
                                    <BotIcon v-if="ann.authorType === 'ai'" class="size-3" />
                                    <UserIcon v-else class="size-3" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-1">
                                        <span class="font-medium">{{ ann.authorType === 'ai' ? 'AI' : ann.authorName }}</span>
                                        <span class="text-muted-foreground text-[10px]">{{ new Date(ann.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                                        <button
                                            v-if="!readOnly && ann.authorType === 'lawyer' && ann.authorUserId === currentUserId"
                                            class="ml-auto text-muted-foreground hover:text-destructive"
                                            aria-label="删除批注"
                                            @click="emit('deleteAnnotation', ann.id)"
                                        >
                                            <Trash2Icon class="size-3" />
                                        </button>
                                    </div>
                                    <div class="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{{ ann.content }}</div>
                                </div>
                            </div>

                            <div v-if="!readOnly && isCompleted" class="flex gap-2 mt-2">
                                <Textarea
                                    v-model="replyContents[r.id]"
                                    placeholder="添加批注..."
                                    :rows="2"
                                    :maxlength="500"
                                    class="text-xs flex-1"
                                    :disabled="readOnly"
                                    @keydown.enter.ctrl.prevent="handleAddAnnotation(r.id)"
                                />
                                <Button
                                    size="icon"
                                    class="size-8 shrink-0 self-end"
                                    :disabled="readOnly || !(replyContents[r.id]?.trim())"
                                    aria-label="发送批注"
                                    @click="handleAddAnnotation(r.id)"
                                >
                                    <SendIcon class="size-3.5" />
                                </Button>
                            </div>
                            <div v-else-if="readOnly" class="text-xs text-muted-foreground italic">只读模式，无法添加批注</div>
                        </div>
                    </CardContent>
                </Card>

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

                    <Card
                        v-for="r in orphanedRisks"
                        :key="r.id"
                        :data-risk-id="r.id"
                        class="cursor-pointer relative transition-all border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
                        @click="toggle(r.id); emit('focusRisk', r.id)"
                    >
                        <CardHeader class="py-2 px-3">
                            <div class="flex items-center gap-2">
                                <span class="inline-block px-2 py-0.5 rounded text-xs shrink-0" :class="LEVEL_CLASS[r.level]">{{ RISK_LEVEL_LABEL[r.level] }}</span>
                                <span class="text-sm font-medium truncate">{{ r.category }}</span>
                                <Badge variant="secondary" class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                                    <TriangleAlert class="size-2.5" />
                                    原文已修改
                                </Badge>
                                <ChevronDownIcon class="ml-auto size-4 transition-transform shrink-0 text-muted-foreground" :class="{ 'rotate-180': expandedId === r.id }" />
                            </div>
                            <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ r.problem }}</div>
                        </CardHeader>
                        <CardContent v-if="expandedId === r.id" class="py-2 px-3 text-sm space-y-3" @click.stop>
                            <!-- 原锚点提示 -->
                            <div v-if="r.originalAnchorQuote" class="rounded-md bg-muted p-2 text-xs text-muted-foreground space-y-1">
                                <div class="font-medium flex items-center gap-1">
                                    <TriangleAlert class="size-3 text-amber-500" />
                                    原锚点引文
                                </div>
                                <div class="italic line-clamp-3">{{ r.originalAnchorQuote }}</div>
                            </div>

                            <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ r.analysis }}</div></div>
                            <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ r.risk }}</div></div>
                            <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ r.suggestion }}</div></div>

                            <!-- 历史批注链 -->
                            <div class="pt-2 border-t space-y-2">
                                <div class="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <MessageCircleIcon class="size-3" />
                                    历史讨论（{{ annotationsForRisk(r.id).length }}）
                                </div>
                                <div v-for="ann in annotationsForRisk(r.id)" :key="ann.id" class="flex gap-2 text-xs">
                                    <div
                                        class="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                                        :class="ann.authorType === 'ai' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                                    >
                                        <BotIcon v-if="ann.authorType === 'ai'" class="size-3" />
                                        <UserIcon v-else class="size-3" />
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-1">
                                            <span class="font-medium">{{ ann.authorType === 'ai' ? 'AI' : ann.authorName }}</span>
                                            <span class="text-muted-foreground text-[10px]">{{ new Date(ann.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                                        </div>
                                        <div class="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{{ ann.content }}</div>
                                    </div>
                                </div>
                            </div>

                            <!-- 查看原始语境按钮 -->
                            <div class="pt-2 border-t">
                                <Button size="sm" variant="outline" @click="emit('jump-to-original', r.id)">
                                    查看原始语境
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
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
                                    <span class="text-muted-foreground text-[10px]">{{ new Date(ann.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
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

        <!-- 底部操作栏 -->
        <div class="p-3 border-t space-y-2 shrink-0 bg-card">
            <Button
                v-if="hasUnsavedDocxChanges || isRebuilding"
                class="w-full"
                variant="secondary"
                :disabled="!canRebuild"
                @click="emit('rebuild')"
            >
                <Loader2Icon v-if="isRebuilding" class="size-4 mr-1 animate-spin" />
                {{ isRebuilding ? '批注生成中...' : '重新生成批注 Word' }}
            </Button>
            <div class="flex gap-2">
                <Button class="flex-1" variant="outline" :disabled="!canDownload" @click="openExportPdf">
                    <FileTextIcon class="size-4 mr-1" />导出评审报告
                </Button>
                <Button
                    class="flex-1"
                    :disabled="!canDownload"
                    :title="previewVersionNumber !== null && previewVersionNumber !== undefined
                        ? `下载 v${previewVersionNumber} 历史版本的批注 Word`
                        : '下载当前工作区的批注 Word'"
                    @click="emit('download')"
                >
                    <DownloadIcon class="size-4 mr-1" />
                    {{ previewVersionNumber !== null && previewVersionNumber !== undefined
                        ? `下载 v${previewVersionNumber} 历史版本`
                        : '下载批注 Word' }}
                </Button>
            </div>
        </div>

        <AssistantContractRiskEditDialog v-model:open="editDialogOpen" :risk="editingRisk" @confirm="handleEditConfirm" />

        <AssistantContractExportPdfDialog v-model:open="exportPdfDialogOpen" @confirm="handleExportPdfConfirm" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除该风险？</AlertDialogTitle>
                    <AlertDialogDescription>删除后需点击"重新生成批注 Word"才会同步到 Word 文档。</AlertDialogDescription>
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
