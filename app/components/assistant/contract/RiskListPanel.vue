<script setup lang="ts">
/**
 * 右侧风险清单侧栏（M5 CRUD 版）
 *
 * M4 只读版 → M5 扩展：
 * - 顶部「新增风险」按钮 + 每条风险的「编辑 / 删除」按钮
 * - 删除走 AlertDialog 二次确认
 * - 底部「下载批注 Word」上方插入「重新生成批注 Word」
 * - isRebuilding 态：所有编辑/新增/删除/重新生成按钮禁用，顶部条状提示「批注正在重新生成...」
 *
 * 组件为纯展示 + 交互，CRUD 结果通过 `editRisks` 事件把新 risks 数组整体交还父组件持久化。
 *
 * **Feature: contract-review-m5**
 */
import { DownloadIcon, ChevronDownIcon, Loader2Icon, PlusIcon, PencilIcon, Trash2Icon, FileTextIcon, Pin, TriangleAlert } from 'lucide-vue-next'
import type { ContractOverview, Risk, ContractReviewStatus } from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    isRebuilding: boolean
    hasUnsavedDocxChanges: boolean
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
}>()

const emit = defineEmits<{
    download: []
    rebuild: []
    editRisks: [risks: Risk[]]
    exportPdf: [includeRisks: boolean]
    focusRisk: [riskId: string]
    togglePin: [riskId: string]
}>()

const containerRef = ref<HTMLElement | null>(null)

const sorted = computed(() => [...props.risks].sort((a, b) => a.clauseIndex - b.clauseIndex))
const expandedId = ref<string | null>(null)

// focusedRiskId 变化时，在 RiskListPanel 自身容器内滚动到对应卡片（不影响文档侧 ContractDocxPreview）
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
        // 3 秒后自动 evict，重新赋值触发 Vue 响应
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

// status === 'completed' 是下载/重生/CRUD 的共同前置条件，集中派生避免三处各自写
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

// 导出 PDF 对话框
const exportPdfDialogOpen = ref(false)
function openExportPdf() {
    if (!canDownload.value) return
    exportPdfDialogOpen.value = true
}
function handleExportPdfConfirm(includeRisks: boolean) {
    emit('exportPdf', includeRisks)
}
</script>

<template>
    <div class="flex flex-col h-full">
        <AssistantContractOverviewPanel
            :risks="risks"
            :summary="summary"
            @focus-risk="(id: string) => emit('focusRisk', id)"
        />

        <div v-if="isRebuilding" class="p-3 border-b bg-muted/30 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2Icon class="size-4 animate-spin" />
            <span>批注正在重新生成...</span>
        </div>

        <ScrollArea class="flex-1">
            <div ref="containerRef" class="p-3 space-y-2">
                <Button variant="outline" class="w-full" :disabled="!editable" @click="openCreate">
                    <PlusIcon class="size-4 mr-1" />新增风险
                </Button>

                <div v-if="!sorted.length" class="p-6 text-sm text-muted-foreground text-center">暂无风险条目</div>

                <Card
                    v-for="r in sorted"
                    :key="r.id"
                    :data-risk-id="r.id"
                    :data-just-added="justAddedIds.has(r.id) ? 'true' : 'false'"
                    class="cursor-pointer relative transition-all"
                    :class="{
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
                            <span
                                v-if="notLocatedIds.has(r.id)"
                                class="text-[10px] px-1.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-0.5 shrink-0"
                            >
                                <TriangleAlert class="size-2.5" />
                                未定位
                            </span>
                            <!-- 钉住按钮：@click.stop 阻止触发 Card 的 focusRisk；放到行内并靠右对齐，避免与 ChevronDownIcon 重叠 -->
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
                        <div class="flex gap-2 pt-2 border-t">
                            <Button size="sm" variant="outline" :disabled="!editable" @click="openEdit(r)">
                                <PencilIcon class="size-3 mr-1" />编辑
                            </Button>
                            <Button size="sm" variant="outline" class="text-destructive" :disabled="!editable" @click="openDelete(r.id)">
                                <Trash2Icon class="size-3 mr-1" />删除
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ScrollArea>

        <div class="p-3 border-t space-y-2">
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
            <Button class="w-full" :disabled="!canDownload" @click="emit('download')">
                <DownloadIcon class="size-4 mr-1" />下载批注 Word
            </Button>
            <Button class="w-full" variant="outline" :disabled="!canDownload" @click="openExportPdf">
                <FileTextIcon class="size-4 mr-1" />导出 PDF
            </Button>
        </div>

        <AssistantContractRiskEditDialog v-model:open="editDialogOpen" :risk="editingRisk" @confirm="handleEditConfirm" />

        <AssistantContractExportPdfDialog v-model:open="exportPdfDialogOpen" @confirm="handleExportPdfConfirm" />

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
    </div>
</template>
