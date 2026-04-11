<script setup lang="ts">
/**
 * 分析结果展示组件
 *
 * 展示案件分析的各模块结果，支持：
 * - 模块切换（Tab 导航）
 * - 结果内容展示（Markdown 渲染）
 * - 重新生成功能
 *
 * @see Requirements 8.1, 8.2, 8.3
 * @see design.md - 分析结果展示与重新生成
 */
import type { HTMLAttributes } from 'vue'
import type { AnalysisResult } from '#shared/types/case'
import type { AnalysisModuleCard } from '#shared/types/case'
import { cn } from '@/lib/utils'
import {
    MessageCircleIcon,
    CopyIcon,
    CheckIcon,
    FileTextIcon,
    Loader2Icon,
    CalendarIcon,
    ScaleIcon,
    TrendingUpIcon,
    TagIcon,
    ShieldIcon,
    ClipboardListIcon,
    ArrowLeftIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    LayoutGridIcon,
    ListIcon,
    SparklesIcon,
    HistoryIcon,
    PlusIcon,
    AlertCircleIcon,
    ClockIcon,
} from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'

/**
 * 组件属性接口
 */
interface Props {
    /** 分析结果列表（旧模式，保留兼容） */
    results: AnalysisResult[]
    /** 全部模块卡片（新模式，四态） */
    moduleCards?: AnalysisModuleCard[]
    /** 案件 ID（用于版本管理） */
    caseId?: number
    /** 当前选中的模块索引（旧 v-model） */
    activeIndex?: number
    /** 当前选中的模块名（新 v-model） */
    activeModule?: string | null
    /** 是否正在重新生成 */
    isRegenerating?: boolean
    /** 正在重新生成的模块 ID */
    regeneratingNodeId?: number | null
    /** 是否显示重新生成按钮 */
    showRegenerate?: boolean
    /** 是否显示复制按钮 */
    showCopy?: boolean
    /** 是否显示版本按钮 */
    showVersions?: boolean
    /** 空状态标题 */
    emptyTitle?: string
    /** 空状态描述 */
    emptyDescription?: string
    /** 是否正在分析中 */
    isAnalyzing?: boolean
    /** 自定义类名 */
    class?: HTMLAttributes['class']
    /** 查看模式：仪表盘或详情 */
    viewMode?: 'dashboard' | 'detail'
    /** 是否隐藏头部（仅在仪表盘模式下生效） */
    hideHeader?: boolean
    /** 是否显示批量分析按钮 */
    showBatchButton?: boolean
    /** 是否有待处理的中断 */
    hasPendingInterrupt?: boolean
    /** 只读模式：禁用生成操作和模块对话 */
    readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    results: () => [],
    activeIndex: 0,
    isRegenerating: false,
    regeneratingNodeId: null,
    showRegenerate: true,
    showCopy: true,
    showVersions: false,
    emptyTitle: '暂无分析结果',
    emptyDescription: '完成分析后，结果将在此处展示',
    isAnalyzing: false,
    viewMode: 'dashboard',
    hideHeader: false,
})

// readonly 模式覆盖
const effectiveShowRegenerate = computed(() => props.readonly ? false : props.showRegenerate)
const effectiveShowBatchButton = computed(() => props.readonly ? false : props.showBatchButton)

const emit = defineEmits<{
    /** 切换模块（旧模式） */
    (e: 'update:activeIndex', index: number): void
    /** 切换模块（新模式） */
    (e: 'update:activeModule', moduleName: string | null): void
    /** 切换查看模式 */
    (e: 'update:viewMode', mode: 'dashboard' | 'detail'): void
    /** 重新生成 */
    (e: 'regenerate', result: AnalysisResult): void
    /** 复制内容 */
    (e: 'copy', result: AnalysisResult): void
    /** 版本切换后 */
    (e: 'versionChanged'): void
    /** 触发单个模块生成/重试/重新展开 */
    (e: 'generateModule', moduleName: string, moduleTitle: string): void
    /** 触发批量生成 */
    (e: 'batchGenerate'): void
    /** 前往处理中断 */
    (e: 'goToInterrupt'): void
}>()

// 版本 Sheet 状态
const versionSheetOpen = ref(false)

// 版本列表（由父组件获取并传入）
const versionItems = ref<Array<{
    id: number
    version: number
    isActive: boolean
    analysisResult: string | null
    createdAt: string
}>>([])
const versionLoading = ref(false)

// 刷新版本列表
async function refreshVersionList() {
    if (!props.caseId || !currentResult.value?.moduleName) return
    versionLoading.value = true
    try {
        const data = await useApiFetch<typeof versionItems.value>(
            `/api/v1/case/analysis/versions/${props.caseId}`,
            { query: { analysisType: currentResult.value!.moduleName } },
        )
        versionItems.value = data ?? []
        if (versionItems.value.length === 0) {
            // fallback：从 init-analysis-status 获取版本信息
            const status = await useApiFetch<{ modules?: Array<{ name: string; version?: number }> }>(
                `/api/v1/case/init-analysis-status/${props.caseId}`,
            )
            const moduleStatus = status?.modules?.find(m => m.name === currentResult.value!.moduleName)
            if (moduleStatus?.version && moduleStatus.version > 0) {
                versionItems.value = [{
                    id: 0,
                    version: moduleStatus.version,
                    isActive: true,
                    analysisResult: null,
                    createdAt: '',
                }]
            }
        }
    }
    catch (error) {
        console.error('获取版本列表失败:', error)
        versionItems.value = []
    }
    finally {
        versionLoading.value = false
    }
}

watch(versionSheetOpen, async (open) => {
    if (open) {
        await refreshVersionList()
    }
    else {
        versionItems.value = []
    }
})

// 移动端详情模式时隐藏外部 header
const isMobileView = useMediaQuery('(max-width: 767px)')
const hideDashboardHeader = useState('hideDashboardHeader', () => false)

// 查看模式：仪表盘或详情
const currentViewMode = computed({
    get: () => props.viewMode,
    set: (value) => emit('update:viewMode', value),
})

// 仪表盘模式下的显示视图：网格或列表
const dashboardViewMode = ref<'grid' | 'list'>('grid')

watch([currentViewMode, isMobileView], ([mode, mobile]) => {
    hideDashboardHeader.value = mobile && mode === 'detail'
}, { immediate: true })

onUnmounted(() => {
    hideDashboardHeader.value = false
})

// 模块图标映射
const iconMap: Record<string, any> = {
    summary: FileTextIcon,
    chronicle: CalendarIcon,
    claim: ScaleIcon,
    trend: TrendingUpIcon,
    cause: TagIcon,
    defense: ShieldIcon,
    evidence: ClipboardListIcon,
}

/**
 * 获取模块图标
 */
function getModuleIcon(name: string) {
    return iconMap[name] || FileTextIcon
}

// 数据源：优先 moduleCards（新模式），回退 results（旧模式）
const cards = computed<AnalysisModuleCard[]>(() => {
    if (props.moduleCards?.length) return props.moduleCards
    return props.results.map(r => ({
        moduleName: r.moduleName,
        moduleTitle: r.moduleTitle,
        status: 'complete' as const,
        content: r.content,
        analyzedAt: r.analyzedAt,
        version: r.version,
    }))
})

// 只有 complete 的卡片可进入详情
const completeCards = computed(() => cards.value.filter(c => c.status === 'complete'))

// 双模式 activeModule 解析
const currentModuleName = computed({
    get: () => {
        if (props.activeModule !== undefined) return props.activeModule
        const idx = props.activeIndex ?? 0
        return completeCards.value[idx]?.moduleName ?? null
    },
    set: (val) => {
        if (props.activeModule !== undefined) emit('update:activeModule', val)
        if (props.activeIndex !== undefined) {
            const idx = completeCards.value.findIndex(c => c.moduleName === val)
            emit('update:activeIndex', idx >= 0 ? idx : 0)
        }
    },
})

// 当前选中的完成结果（用于详情视图）
const currentResult = computed(() => {
    if (!currentModuleName.value) return completeCards.value[0] ?? null
    return completeCards.value.find(c => c.moduleName === currentModuleName.value) ?? completeCards.value[0] ?? null
})

// 是否有任何结果可展示（包含四态卡片）
const hasResults = computed(() => cards.value.length > 0)

// 卡片禁用判断
function isCardDisabled(card: AnalysisModuleCard): boolean {
    if (props.readonly && card.status !== 'complete') return true
    if (props.hasPendingInterrupt && card.status !== 'complete') return true
    if (card.locked) return true
    return false
}

// 卡片点击处理
function handleCardClick(card: AnalysisModuleCard) {
    if (isCardDisabled(card)) return
    if (props.readonly && card.status !== 'complete') return
    if (card.status === 'complete') {
        currentModuleName.value = card.moduleName
        currentViewMode.value = 'detail'
        return
    }
    if (card.status === 'idle' || card.status === 'failed' || card.status === 'in_progress') {
        emit('generateModule', card.moduleName, card.moduleTitle)
    }
}

// 卡片底部文案
function getCardSubtext(card: AnalysisModuleCard): string {
    if (props.hasPendingInterrupt && card.status !== 'complete') return '等待处理中断'
    if (card.status === 'complete') return `第 ${card.version ?? 1} 版`
    if (card.status === 'in_progress') return '生成中...'
    if (card.status === 'failed') {
        if (props.readonly) return '生成失败'
        if (card.locked) return '等待当前批次完成后可重试'
        return '生成失败，点击重试'
    }
    if (card.status === 'idle') {
        if (props.readonly) return '未生成'
        if (card.locked) return '等待执行'
        return '点击生成'
    }
    return ''
}

// 复制状态
const copiedModuleName = ref<string | null>(null)

/**
 * 返回仪表盘
 */
function goBack() {
    currentViewMode.value = 'dashboard'
}

/**
 * 切换到指定模块
 */
function goToModule(moduleName: string) {
    currentModuleName.value = moduleName
    currentViewMode.value = 'detail'
}

/**
 * 切换到上一个 complete 模块
 */
function goToPrev() {
    const idx = completeCards.value.findIndex(c => c.moduleName === currentModuleName.value)
    if (idx > 0) currentModuleName.value = completeCards.value[idx - 1]!.moduleName
}

/**
 * 切换到下一个 complete 模块
 */
function goToNext() {
    const idx = completeCards.value.findIndex(c => c.moduleName === currentModuleName.value)
    if (idx < completeCards.value.length - 1) currentModuleName.value = completeCards.value[idx + 1]!.moduleName
}

// 当前模块在 completeCards 中的位置（用于翻页 disabled 判断）
const currentCompleteIndex = computed(() =>
    completeCards.value.findIndex(c => c.moduleName === currentModuleName.value),
)

/**
 * 重新生成当前模块（用于详情视图内）
 */
function handleRegenerate() {
    if (currentResult.value) {
        // 构造 AnalysisResult 兼容对象
        const r = currentResult.value
        emit('regenerate', {
            nodeId: 0,
            moduleName: r.moduleName,
            moduleTitle: r.moduleTitle,
            content: r.content ?? '',
            analyzedAt: r.analyzedAt ?? '',
            version: r.version,
        })
    }
}

/**
 * 复制当前模块内容
 */
async function handleCopy() {
    if (!currentResult.value?.content) return

    try {
        await navigator.clipboard.writeText(currentResult.value.content)
        copiedModuleName.value = currentModuleName.value

        setTimeout(() => {
            copiedModuleName.value = null
        }, 2000)

        emit('copy', {
            nodeId: 0,
            moduleName: currentResult.value.moduleName,
            moduleTitle: currentResult.value.moduleTitle,
            content: currentResult.value.content,
            analyzedAt: currentResult.value.analyzedAt ?? '',
            version: currentResult.value.version,
        })
    } catch (error) {
        console.error('复制失败:', error)
    }
}

/**
 * 判断当前模块是否正在重新生成
 */
const isCurrentRegenerating = computed(() => {
    return props.isRegenerating && currentResult.value?.moduleName != null
})

/**
 * 判断是否已复制当前模块
 */
const isCurrentCopied = computed(() => {
    return copiedModuleName.value === currentModuleName.value
})

const { formatDate } = useFormatters()

function formatAnalyzedAt(dateStr: string): string {
    if (!dateStr) return ''
    return formatDate(dateStr, 'MM/DD HH:mm')
}
</script>

<template>
    <div :class="cn('flex flex-col h-full', props.class)">
        <!-- 空状态 -->
        <div v-if="!hasResults" class="flex flex-col items-center justify-center h-full text-center p-8">
            <!-- 分析中状态 -->
            <template v-if="isAnalyzing">
                <Loader2Icon class="size-12 text-primary animate-spin mb-4" />
                <h3 class="text-lg font-medium text-foreground mb-2">正在分析中</h3>
                <p class="text-sm text-muted-foreground max-w-sm">AI 正在处理案件信息，分析结果将在此处展示</p>
            </template>
            <!-- 等待状态 -->
            <template v-else>
                <FileTextIcon class="size-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium text-foreground mb-2">{{ emptyTitle }}</h3>
                <p class="text-sm text-muted-foreground max-w-sm">{{ emptyDescription }}</p>
            </template>
        </div>

        <!-- 有结果时的展示 -->
        <template v-else>
            <Transition name="view-fade" mode="out-in">
                <!-- 仪表盘视图 -->
                <div v-if="currentViewMode === 'dashboard'" key="dashboard" class="p-4">
                    <div v-if="!hideHeader" class="flex items-center justify-between mb-4">
                        <h3
                            class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                            <SparklesIcon class="size-4" />
                            分析结果
                            <span class="font-normal text-[10px] bg-muted px-1.5 py-0.5 rounded">{{ completeCards.length
                                }}/{{ cards.length }}</span>
                        </h3>

                        <div class="flex items-center gap-2">
                            <button v-if="effectiveShowBatchButton"
                                class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mr-2"
                                @click="emit('batchGenerate')">
                                <PlusIcon class="size-3" />
                                批量分析
                            </button>
                            <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
                                <button class="size-7 flex items-center justify-center rounded-md transition-all"
                                    :class="dashboardViewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
                                    @click="dashboardViewMode = 'grid'">
                                    <LayoutGridIcon class="size-3.5" />
                                </button>
                                <button class="size-7 flex items-center justify-center rounded-md transition-all"
                                    :class="dashboardViewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
                                    @click="dashboardViewMode = 'list'">
                                    <ListIcon class="size-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 中断提示条 -->
                    <div v-if="hasPendingInterrupt"
                        class="flex items-center gap-3 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                        <AlertCircleIcon class="size-4 shrink-0" />
                        <span class="text-xs flex-1">初始化分析已中断（积分不足），部分模块暂不可用</span>
                        <button
                            class="text-xs font-medium px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 transition-colors shrink-0"
                            @click="emit('goToInterrupt')"
                        >
                            前往处理
                        </button>
                    </div>

                    <!-- 网格模式：四态卡片 -->
                    <div v-if="dashboardViewMode === 'grid'"
                        class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                        <button v-for="card in cards" :key="card.moduleName"
                            class="group relative flex flex-col items-center p-2.5 rounded-xl transition-all text-center"
                            :class="[
                                isCardDisabled(card) ? 'pointer-events-none opacity-60' : 'cursor-pointer',
                                card.status === 'complete' ? 'bg-muted/40 hover:bg-muted/60 border border-transparent hover:border-primary' : '',
                                card.status === 'in_progress' ? 'bg-muted/40 border border-primary/30' : '',
                                card.status === 'idle' ? 'bg-muted/20 border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50' : '',
                                card.status === 'failed' ? 'bg-destructive/5 border border-destructive/30 hover:border-destructive/50' : '',
                            ]" @click="handleCardClick(card)">

                            <!-- 模块图标 -->
                            <div class="flex items-center justify-center size-11 rounded-xl shrink-0 transition-colors mb-1.5"
                                :class="[
                                    card.status === 'complete' ? 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white group-hover:scale-105' : '',
                                    card.status === 'in_progress' ? 'bg-primary/10 text-primary' : '',
                                    card.status === 'idle' ? 'bg-muted/60 text-muted-foreground/40' : '',
                                    card.status === 'failed' ? 'bg-destructive/10 text-destructive' : '',
                                ]">
                                <Loader2Icon v-if="card.status === 'in_progress'" class="size-6 animate-spin" />
                                <AlertCircleIcon v-else-if="card.status === 'failed'" class="size-6" />
                                <component v-else :is="getModuleIcon(card.moduleName)" class="size-6" />
                            </div>

                            <!-- 模块信息 -->
                            <div class="flex-1 min-w-0 w-full">
                                <h4 class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 transition-colors px-1"
                                    :class="[
                                        card.status === 'complete' ? 'group-hover:text-primary' : '',
                                        card.status === 'idle' ? 'text-muted-foreground/60' : '',
                                        card.status === 'failed' ? 'text-destructive/80' : '',
                                    ]">
                                    {{ card.moduleTitle || card.moduleName }}
                                </h4>
                                <div
                                    class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
                                    <ClockIcon v-if="card.status === 'idle' && card.locked" class="size-2.5" />
                                    <span>{{ getCardSubtext(card) }}</span>
                                </div>
                            </div>
                        </button>
                    </div>

                    <!-- 列表模式：四态卡片 -->
                    <div v-else class="space-y-1">
                        <button v-for="card in cards" :key="card.moduleName"
                            class="w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors group text-left"
                            :class="[
                                isCardDisabled(card) ? 'pointer-events-none opacity-60' : '',
                                card.status === 'complete' ? 'hover:bg-muted/50 border border-transparent hover:border-border/50' : '',
                                card.status === 'in_progress' ? 'border border-primary/20' : '',
                                card.status === 'idle' ? 'border border-dashed border-muted-foreground/20 hover:border-muted-foreground/40' : '',
                                card.status === 'failed' ? 'border border-destructive/20 hover:border-destructive/40' : '',
                            ]" @click="handleCardClick(card)">
                            <div class="flex items-center justify-center size-9 rounded-lg shrink-0 transition-colors"
                                :class="[
                                    card.status === 'complete' ? 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white' : '',
                                    card.status === 'in_progress' ? 'bg-primary/10 text-primary' : '',
                                    card.status === 'idle' ? 'bg-muted/60 text-muted-foreground/40' : '',
                                    card.status === 'failed' ? 'bg-destructive/10 text-destructive' : '',
                                ]">
                                <Loader2Icon v-if="card.status === 'in_progress'" class="size-5 animate-spin" />
                                <AlertCircleIcon v-else-if="card.status === 'failed'" class="size-5" />
                                <component v-else :is="getModuleIcon(card.moduleName)" class="size-5" />
                            </div>
                            <div class="flex-1 min-w-0">
                                <h4 class="text-sm font-medium truncate transition-colors" :class="[
                                    card.status === 'complete' ? 'group-hover:text-primary' : '',
                                    card.status === 'idle' ? 'text-muted-foreground/60' : '',
                                    card.status === 'failed' ? 'text-destructive/80' : '',
                                ]">
                                    {{ card.moduleTitle || card.moduleName }}
                                </h4>
                                <div class="text-[11px] text-muted-foreground/60 flex items-center gap-2">
                                    <ClockIcon v-if="card.status === 'idle' && card.locked" class="size-2.5" />
                                    <span>{{ getCardSubtext(card) }}</span>
                                    <template
                                        v-if="card.status === 'complete' && card.analyzedAt && formatAnalyzedAt(card.analyzedAt)">
                                        <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                                        <span>分析于 {{ formatAnalyzedAt(card.analyzedAt) }}</span>
                                    </template>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>

                <!-- 详情视图 -->
                <div v-else key="detail" class="flex-1 overflow-hidden">
                    <AiElementsArtifact v-if="currentResult" class="h-full border-0 rounded-none shadow-none">
                        <!-- 头部：标题和操作按钮 -->
                        <AiElementsArtifactHeader>
                            <div class="flex items-center gap-3">
                                <Button variant="ghost" size="icon" class="size-8 -ml-2 shrink-0" @click="goBack">
                                    <ArrowLeftIcon class="size-4" />
                                </Button>
                                <div class="flex flex-col gap-0.5 min-w-0">
                                    <div class="flex items-center gap-2">
                                        <AiElementsArtifactTitle class="truncate">
                                            {{ currentResult.moduleTitle || currentResult.moduleName }}
                                        </AiElementsArtifactTitle>
                                        <Badge variant="secondary"
                                            class="px-1 py-0 h-4 text-[10px] font-normal shrink-0">
                                            第 {{ currentResult.version ?? 1 }} 版
                                        </Badge>
                                    </div>
                                    <span v-if="currentResult.analyzedAt && formatAnalyzedAt(currentResult.analyzedAt)"
                                        class="text-[10px] text-muted-foreground">
                                        分析于 {{ formatAnalyzedAt(currentResult.analyzedAt) }}
                                    </span>
                                </div>
                            </div>

                            <AiElementsArtifactActions>
                                <!-- 版本按钮 -->
                                <AiElementsArtifactAction v-if="showVersions && caseId" tooltip="历史版本"
                                    @click="versionSheetOpen = true">
                                    <HistoryIcon class="size-4" />
                                </AiElementsArtifactAction>

                                <!-- 复制按钮 -->
                                <AiElementsArtifactAction v-if="showCopy" tooltip="复制内容" @click="handleCopy">
                                    <CheckIcon v-if="isCurrentCopied" class="size-4 text-green-500" />
                                    <CopyIcon v-else class="size-4" />
                                </AiElementsArtifactAction>

                                <!-- 对话按钮 -->
                                <AiElementsArtifactAction v-if="effectiveShowRegenerate" tooltip="模块对话"
                                    :disabled="isCurrentRegenerating" @click="handleRegenerate">
                                    <MessageCircleIcon class="size-4" />
                                </AiElementsArtifactAction>

                                <!-- 翻页按钮 -->
                                <div class="flex items-center bg-muted/50 rounded-lg p-0.5 ml-1">
                                    <AiElementsArtifactAction tooltip="上一个模块" :disabled="currentCompleteIndex <= 0"
                                        @click="goToPrev">
                                        <ChevronLeftIcon class="size-4" />
                                    </AiElementsArtifactAction>
                                    <div class="w-px h-3 bg-border mx-0.5"></div>
                                    <AiElementsArtifactAction tooltip="下一个模块"
                                        :disabled="currentCompleteIndex >= completeCards.length - 1" @click="goToNext">
                                        <ChevronRightIcon class="size-4" />
                                    </AiElementsArtifactAction>
                                </div>
                            </AiElementsArtifactActions>
                        </AiElementsArtifactHeader>

                        <!-- 内容区域 -->
                        <AiElementsArtifactContent class="overflow-y-auto">
                            <div class="px-8 pt-8 pb-12">
                                <!-- 重新生成中的加载状态 -->
                                <div v-if="isCurrentRegenerating" class="flex items-center justify-center py-12">
                                    <div class="flex flex-col items-center gap-3">
                                        <AiElementsLoader :size="24" />
                                        <span class="text-sm text-muted-foreground">正在重新生成...</span>
                                    </div>
                                </div>

                                <!-- Markdown 内容渲染 -->
                                <AiElementsMessageResponse v-else :content="currentResult.content ?? ''"
                                    class="prose prose-sm dark:prose-invert max-w-none" />
                            </div>
                        </AiElementsArtifactContent>
                    </AiElementsArtifact>
                </div>
            </Transition>
        </template>
    </div>

    <!-- 版本 Sheet -->
    <CaseAnalysisVersionSheet v-if="showVersions && caseId && currentResult" v-model:open="versionSheetOpen"
        :case-id="caseId" :analysis-type="currentResult.moduleName"
        :module-title="currentResult.moduleTitle || currentResult.moduleName" :versions="versionItems"
        :loading="versionLoading" @activated="refreshVersionList(); emit('versionChanged')" />
</template>

<style scoped>
.view-fade-enter-active,
.view-fade-leave-active {
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.view-fade-enter-from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
}

.view-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.99);
}
</style>
