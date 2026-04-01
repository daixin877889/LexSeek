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
    SparklesIcon,
    HistoryIcon,
} from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'

/**
 * 组件属性接口
 */
interface Props {
    /** 分析结果列表 */
    results: AnalysisResult[]
    /** 案件 ID（用于版本管理） */
    caseId?: number
    /** 当前选中的模块索引 */
    activeIndex?: number
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
})

const emit = defineEmits<{
    /** 切换模块 */
    (e: 'update:activeIndex', index: number): void
    /** 切换查看模式 */
    (e: 'update:viewMode', mode: 'dashboard' | 'detail'): void
    /** 重新生成 */
    (e: 'regenerate', result: AnalysisResult): void
    /** 复制内容 */
    (e: 'copy', result: AnalysisResult): void
    /** 版本切换后 */
    (e: 'versionChanged'): void
}>()

// 版本 Sheet 状态
const versionSheetOpen = ref(false)

// 移动端详情模式时隐藏外部 header
const isMobileView = useMediaQuery('(max-width: 767px)')
const hideDashboardHeader = useState('hideDashboardHeader', () => false)

// 查看模式：仪表盘或详情
const currentViewMode = computed({
    get: () => props.viewMode,
    set: (value) => emit('update:viewMode', value),
})

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

// 当前选中的模块索引（支持 v-model）
const currentIndex = computed({
    get: () => props.activeIndex,
    set: (value) => emit('update:activeIndex', value),
})

// 当前选中的分析结果
const currentResult = computed(() => {
    if (props.results.length === 0) return null
    return props.results[currentIndex.value] || props.results[0]
})

// 是否有结果
const hasResults = computed(() => props.results.length > 0)

// 复制状态
const copiedIndex = ref<number | null>(null)

/**
 * 返回仪表盘
 */
function goBack() {
    currentViewMode.value = 'dashboard'
}

/**
 * 切换到指定模块
 */
function goToModule(index: number) {
    if (index >= 0 && index < props.results.length) {
        currentIndex.value = index
        currentViewMode.value = 'detail'
    }
}

/**
 * 重新生成当前模块
 */
function handleRegenerate() {
    if (currentResult.value) {
        emit('regenerate', currentResult.value)
    }
}

/**
 * 复制当前模块内容
 */
async function handleCopy() {
    if (!currentResult.value) return

    try {
        await navigator.clipboard.writeText(currentResult.value.content)
        copiedIndex.value = currentIndex.value

        // 2 秒后重置复制状态
        setTimeout(() => {
            copiedIndex.value = null
        }, 2000)

        emit('copy', currentResult.value)
    } catch (error) {
        console.error('复制失败:', error)
    }
}

/**
 * 判断当前模块是否正在重新生成
 */
const isCurrentRegenerating = computed(() => {
    return props.isRegenerating && props.regeneratingNodeId === currentResult.value?.nodeId
})

/**
 * 判断是否已复制当前模块
 */
const isCurrentCopied = computed(() => {
    return copiedIndex.value === currentIndex.value
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
            <!-- 仪表盘视图 -->
            <div v-if="currentViewMode === 'dashboard'" class="p-4">
                <div class="flex items-center justify-between mb-4">
                    <h3
                        class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                        <SparklesIcon class="size-4" />
                        分析结果
                        <span class="font-normal text-[10px] bg-muted px-1.5 py-0.5 rounded">{{ results.length }}</span>
                    </h3>
                </div>
                <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                    <button v-for="(result, index) in results" :key="result.nodeId"
                        class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary cursor-pointer text-center"
                        @click="goToModule(index)">

                        <!-- 模块图标 -->
                        <div
                            class="flex items-center justify-center size-11 rounded-xl shrink-0 transition-colors group-hover:scale-105 mb-1.5 bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white">
                            <component :is="getModuleIcon(result.moduleName)" class="size-6" />
                        </div>

                        <!-- 模块信息 -->
                        <div class="flex-1 min-w-0 w-full">
                            <h4
                                class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
                                {{ result.moduleTitle || result.moduleName }}
                            </h4>
                            <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center">
                                <span>第 {{ result.version ?? 1 }} 版</span>
                            </div>
                        </div>
                    </button>
                </div>
            </div>

            <!-- 详情视图 -->
            <template v-else>
                <!-- 结果内容区域 -->
                <div class="flex-1 overflow-hidden">
                    <AiElementsArtifact v-if="currentResult" class="h-full border-0 rounded-none shadow-none">
                        <!-- 头部：标题和操作按钮 -->
                        <AiElementsArtifactHeader>
                            <div class="flex items-center gap-3">
                                <Button variant="ghost" size="icon" class="size-8 -ml-2 shrink-0" @click="goBack">
                                    <ArrowLeftIcon class="size-4" />
                                </Button>
                                <div class="flex flex-col gap-0.5 min-w-0">
                                    <AiElementsArtifactTitle class="truncate">
                                        {{ currentResult.moduleTitle || currentResult.moduleName }}
                                    </AiElementsArtifactTitle>
                                    <span v-if="formatAnalyzedAt(currentResult.analyzedAt)"
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
                                <AiElementsArtifactAction v-if="showRegenerate" tooltip="模块对话"
                                    :disabled="isCurrentRegenerating" @click="handleRegenerate">
                                    <MessageCircleIcon class="size-4" />
                                </AiElementsArtifactAction>
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
                                <AiElementsMessageResponse v-else :content="currentResult.content"
                                    class="prose prose-sm dark:prose-invert max-w-none" />
                            </div>
                        </AiElementsArtifactContent>
                    </AiElementsArtifact>
                </div>

            </template>
        </template>
    </div>

    <!-- 版本 Sheet（组件待实现） -->
    <!-- <CaseAnalysisVersionSheet v-if="showVersions && caseId && currentResult" v-model="versionSheetOpen"
        :case-id="caseId" :analysis-type="currentResult.moduleName"
        :module-title="currentResult.moduleTitle || currentResult.moduleName" @activated="emit('versionChanged')" /> -->
</template>
