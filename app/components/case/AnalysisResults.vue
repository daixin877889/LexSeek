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
import type { AnalysisResult } from '@/composables/useCaseAnalysis'
import { cn } from '@/lib/utils'
import {
    RefreshCwIcon,
    CopyIcon,
    CheckIcon,
    FileTextIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
} from 'lucide-vue-next'

/**
 * 组件属性接口
 */
interface Props {
    /** 分析结果列表 */
    results: AnalysisResult[]
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
    /** 空状态标题 */
    emptyTitle?: string
    /** 空状态描述 */
    emptyDescription?: string
    /** 自定义类名 */
    class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
    results: () => [],
    activeIndex: 0,
    isRegenerating: false,
    regeneratingNodeId: null,
    showRegenerate: true,
    showCopy: true,
    emptyTitle: '暂无分析结果',
    emptyDescription: '完成分析后，结果将在此处展示',
})

const emit = defineEmits<{
    /** 切换模块 */
    (e: 'update:activeIndex', index: number): void
    /** 重新生成 */
    (e: 'regenerate', result: AnalysisResult): void
    /** 复制内容 */
    (e: 'copy', result: AnalysisResult): void
}>()

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
const copiedNodeId = ref<number | null>(null)

/**
 * 切换到上一个模块
 */
function goToPrevious() {
    if (currentIndex.value > 0) {
        currentIndex.value = currentIndex.value - 1
    }
}

/**
 * 切换到下一个模块
 */
function goToNext() {
    if (currentIndex.value < props.results.length - 1) {
        currentIndex.value = currentIndex.value + 1
    }
}

/**
 * 切换到指定模块
 */
function goToModule(index: number) {
    if (index >= 0 && index < props.results.length) {
        currentIndex.value = index
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
        copiedNodeId.value = currentResult.value.nodeId

        // 2 秒后重置复制状态
        setTimeout(() => {
            copiedNodeId.value = null
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
    return copiedNodeId.value === currentResult.value?.nodeId
})

/**
 * 格式化分析时间
 */
function formatAnalyzedAt(dateStr: string): string {
    try {
        const date = new Date(dateStr)
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return dateStr
    }
}
</script>

<template>
    <div :class="cn('flex flex-col h-full', props.class)">
        <!-- 空状态 -->
        <div v-if="!hasResults" class="flex flex-col items-center justify-center h-full text-center p-8">
            <FileTextIcon class="size-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium text-foreground mb-2">{{ emptyTitle }}</h3>
            <p class="text-sm text-muted-foreground max-w-sm">{{ emptyDescription }}</p>
        </div>

        <!-- 有结果时的展示 -->
        <template v-else>
            <!-- 模块导航 Tabs -->
            <div class="flex items-center gap-2 border-b px-4 py-2 bg-muted/30">
                <!-- 左箭头 -->
                <Button variant="ghost" size="icon" class="size-8 shrink-0" :disabled="currentIndex === 0"
                    @click="goToPrevious">
                    <ChevronLeftIcon class="size-4" />
                </Button>

                <!-- Tab 列表 -->
                <div class="flex-1 overflow-x-auto">
                    <div class="flex gap-1">
                        <Button v-for="(result, index) in results" :key="result.nodeId"
                            :variant="index === currentIndex ? 'secondary' : 'ghost'" size="sm" class="shrink-0 text-xs"
                            @click="goToModule(index)">
                            {{ result.moduleTitle || result.moduleName }}
                        </Button>
                    </div>
                </div>

                <!-- 右箭头 -->
                <Button variant="ghost" size="icon" class="size-8 shrink-0"
                    :disabled="currentIndex === results.length - 1" @click="goToNext">
                    <ChevronRightIcon class="size-4" />
                </Button>
            </div>

            <!-- 结果内容区域 -->
            <div class="flex-1 overflow-hidden">
                <AiElementsArtifactArtifact v-if="currentResult" class="h-full border-0 rounded-none shadow-none">
                    <!-- 头部：标题和操作按钮 -->
                    <AiElementsArtifactArtifactHeader>
                        <div class="flex flex-col gap-0.5">
                            <AiElementsArtifactArtifactTitle>
                                {{ currentResult.moduleTitle || currentResult.moduleName }}
                            </AiElementsArtifactArtifactTitle>
                            <span class="text-xs text-muted-foreground">
                                分析于 {{ formatAnalyzedAt(currentResult.analyzedAt) }}
                            </span>
                        </div>

                        <AiElementsArtifactArtifactActions>
                            <!-- 复制按钮 -->
                            <AiElementsArtifactArtifactAction v-if="showCopy" tooltip="复制内容" @click="handleCopy">
                                <CheckIcon v-if="isCurrentCopied" class="size-4 text-green-500" />
                                <CopyIcon v-else class="size-4" />
                            </AiElementsArtifactArtifactAction>

                            <!-- 重新生成按钮 -->
                            <AiElementsArtifactArtifactAction v-if="showRegenerate" tooltip="重新生成"
                                :disabled="isCurrentRegenerating" @click="handleRegenerate">
                                <RefreshCwIcon class="size-4" :class="{ 'animate-spin': isCurrentRegenerating }" />
                            </AiElementsArtifactArtifactAction>
                        </AiElementsArtifactArtifactActions>
                    </AiElementsArtifactArtifactHeader>

                    <!-- 内容区域 -->
                    <AiElementsArtifactArtifactContent class="overflow-y-auto">
                        <!-- 重新生成中的加载状态 -->
                        <div v-if="isCurrentRegenerating" class="flex items-center justify-center py-12">
                            <div class="flex flex-col items-center gap-3">
                                <AiElementsLoaderLoader :size="24" />
                                <span class="text-sm text-muted-foreground">正在重新生成...</span>
                            </div>
                        </div>

                        <!-- Markdown 内容渲染 -->
                        <AiElementsMessageMessageResponse v-else :content="currentResult.content"
                            class="prose prose-sm dark:prose-invert max-w-none" />
                    </AiElementsArtifactArtifactContent>
                </AiElementsArtifactArtifact>
            </div>

            <!-- 底部：模块指示器 -->
            <div class="flex items-center justify-center gap-1.5 py-2 border-t bg-muted/30">
                <button v-for="(result, index) in results" :key="result.nodeId" type="button"
                    class="size-2 rounded-full transition-colors" :class="[
                        index === currentIndex
                            ? 'bg-primary'
                            : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                    ]" :title="result.moduleTitle || result.moduleName" @click="goToModule(index)" />
            </div>
        </template>
    </div>
</template>
