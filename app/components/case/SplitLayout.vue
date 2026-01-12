<script setup lang="ts">
/**
 * 自适应布局组件
 *
 * 根据分析进度自动调整布局：
 * - 初始状态：全宽展示工作流对话区域
 * - 有分析结果时：自动切换为左右分栏布局
 * - 支持可拖拽分割线调整宽度
 * - 支持关闭/展开结果区域
 * - 支持移动端视图切换
 *
 * @see Requirements 19.1-19.11, 19.20
 * @see design.md - 分析页面自适应布局
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { useLocalStorage, useWindowSize } from '@vueuse/core'
import {
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    MessageSquareIcon,
    FileTextIcon,
} from 'lucide-vue-next'
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from '~/components/ui/resizable'

/**
 * 组件属性接口
 */
interface Props {
    /** 是否有分析结果 */
    hasResults?: boolean
    /** 默认左侧面板宽度比例（0-100） */
    defaultLeftSize?: number
    /** 左侧面板最小宽度比例 */
    minLeftSize?: number
    /** 右侧面板最小宽度比例 */
    minRightSize?: number
    /** 移动端断点宽度 */
    mobileBreakpoint?: number
    /** 本地存储键名（用于保存宽度比例） */
    storageKey?: string
    /** 自定义类名 */
    class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
    hasResults: false,
    defaultLeftSize: 50,
    minLeftSize: 30,
    minRightSize: 25,
    mobileBreakpoint: 768,
    storageKey: 'case-analysis-split-layout',
})

const emit = defineEmits<{
    /** 布局模式变化 */
    (e: 'layout-change', mode: 'full' | 'split'): void
    /** 右侧面板展开/收起 */
    (e: 'panel-toggle', expanded: boolean): void
    /** 移动端视图切换 */
    (e: 'mobile-view-change', view: 'conversation' | 'results'): void
}>()

// 窗口尺寸
const { width: windowWidth } = useWindowSize()

// 是否为移动端
const isMobile = computed(() => windowWidth.value < props.mobileBreakpoint)

// 右侧面板是否展开（桌面端）
const isRightPanelExpanded = ref(true)

// 移动端当前视图
const mobileView = ref<'conversation' | 'results'>('conversation')

// 保存的左侧面板宽度比例
const savedLeftSize = useLocalStorage<number>(`${props.storageKey}-left-size`, props.defaultLeftSize)

// 当前左侧面板宽度
const currentLeftSize = ref(savedLeftSize.value ?? props.defaultLeftSize)

// 当前布局模式
const layoutMode = computed<'full' | 'split'>(() => {
    // 移动端始终使用全宽模式（通过视图切换实现）
    if (isMobile.value) return 'full'
    // 桌面端：有结果且右侧面板展开时使用分栏模式
    return props.hasResults && isRightPanelExpanded.value ? 'split' : 'full'
})

// 是否显示分栏布局
const showSplitLayout = computed(() => {
    return !isMobile.value && props.hasResults && isRightPanelExpanded.value
})

// 是否显示展开按钮（右侧面板收起时）
const showExpandButton = computed(() => {
    return !isMobile.value && props.hasResults && !isRightPanelExpanded.value
})

// 是否显示移动端底部切换标签
const showMobileTabs = computed(() => {
    return isMobile.value && props.hasResults
})

/**
 * 切换右侧面板展开/收起状态
 */
function toggleRightPanel() {
    isRightPanelExpanded.value = !isRightPanelExpanded.value
    emit('panel-toggle', isRightPanelExpanded.value)
}

/**
 * 展开右侧面板
 */
function expandRightPanel() {
    isRightPanelExpanded.value = true
    emit('panel-toggle', true)
}

/**
 * 收起右侧面板
 */
function collapseRightPanel() {
    isRightPanelExpanded.value = false
    emit('panel-toggle', false)
}

/**
 * 处理面板大小变化
 */
function handlePanelResize(sizes: number[]) {
    if (sizes.length >= 1 && sizes[0] !== undefined) {
        currentLeftSize.value = sizes[0]
        savedLeftSize.value = sizes[0]
    }
}

/**
 * 切换移动端视图
 */
function switchMobileView(view: 'conversation' | 'results') {
    mobileView.value = view
    emit('mobile-view-change', view)
}

// 监听布局模式变化
watch(layoutMode, (newMode) => {
    emit('layout-change', newMode)
})

// 当有新结果时，自动展开右侧面板（桌面端）
watch(() => props.hasResults, (hasResults) => {
    if (hasResults && !isMobile.value && !isRightPanelExpanded.value) {
        isRightPanelExpanded.value = true
        emit('panel-toggle', true)
    }
})

// 暴露方法供父组件调用
defineExpose({
    toggleRightPanel,
    expandRightPanel,
    collapseRightPanel,
    switchMobileView,
    layoutMode,
    isMobile,
    mobileView,
})
</script>

<template>
    <div :class="cn('relative h-full w-full overflow-hidden', props.class)">
        <!-- 桌面端：分栏布局 -->
        <template v-if="!isMobile">
            <!-- 有结果且展开时：左右分栏 -->
            <ResizablePanelGroup v-if="showSplitLayout" direction="horizontal"
                class="h-full transition-all duration-300 ease-in-out" @layout="handlePanelResize">
                <!-- 左侧：工作流对话区域 -->
                <ResizablePanel :default-size="currentLeftSize" :min-size="minLeftSize"
                    class="transition-all duration-300">
                    <div class="h-full overflow-hidden">
                        <slot name="conversation" />
                    </div>
                </ResizablePanel>

                <!-- 可拖拽分割线 -->
                <ResizableHandle with-handle class="bg-border hover:bg-primary/20 transition-colors" />

                <!-- 右侧：分析结果区域 -->
                <ResizablePanel :default-size="100 - currentLeftSize" :min-size="minRightSize"
                    class="transition-all duration-300">
                    <div class="h-full overflow-hidden relative">
                        <!-- 关闭按钮 -->
                        <Button variant="ghost" size="icon"
                            class="absolute top-2 left-2 z-10 size-8 bg-background/80 backdrop-blur-sm hover:bg-background"
                            title="收起结果区域" @click="collapseRightPanel">
                            <PanelRightCloseIcon class="size-4" />
                        </Button>
                        <slot name="results" />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>

            <!-- 全宽布局（无结果或右侧面板收起） -->
            <div v-else class="h-full transition-all duration-300 ease-in-out">
                <slot name="conversation" />
            </div>

            <!-- 展开按钮（右侧面板收起时显示） -->
            <Transition enter-active-class="transition-all duration-300 ease-out"
                enter-from-class="opacity-0 translate-x-4" enter-to-class="opacity-100 translate-x-0"
                leave-active-class="transition-all duration-200 ease-in" leave-from-class="opacity-100 translate-x-0"
                leave-to-class="opacity-0 translate-x-4">
                <Button v-if="showExpandButton" variant="secondary" size="sm"
                    class="absolute top-4 right-4 z-20 gap-2 shadow-md" @click="expandRightPanel">
                    <PanelRightOpenIcon class="size-4" />
                    <span>查看结果</span>
                </Button>
            </Transition>
        </template>

        <!-- 移动端：单视图 + 底部切换 -->
        <template v-else>
            <!-- 内容区域 -->
            <div class="h-full pb-14">
                <!-- 对话视图 -->
                <Transition enter-active-class="transition-transform duration-300 ease-out"
                    enter-from-class="-translate-x-full" enter-to-class="translate-x-0"
                    leave-active-class="transition-transform duration-300 ease-in" leave-from-class="translate-x-0"
                    leave-to-class="-translate-x-full" mode="out-in">
                    <div v-if="mobileView === 'conversation'" key="conversation" class="h-full overflow-hidden">
                        <slot name="conversation" />
                    </div>

                    <!-- 结果视图 -->
                    <div v-else key="results" class="h-full overflow-hidden">
                        <slot name="results" />
                    </div>
                </Transition>
            </div>

            <!-- 底部切换标签 -->
            <Transition enter-active-class="transition-all duration-300 ease-out"
                enter-from-class="opacity-0 translate-y-full" enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition-all duration-200 ease-in" leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 translate-y-full">
                <div v-if="showMobileTabs"
                    class="absolute bottom-0 left-0 right-0 h-14 border-t bg-background/95 backdrop-blur-sm flex items-center justify-center gap-2 px-4">
                    <Button :variant="mobileView === 'conversation' ? 'default' : 'ghost'" size="sm"
                        class="flex-1 max-w-32 gap-2" @click="switchMobileView('conversation')">
                        <MessageSquareIcon class="size-4" />
                        <span>对话</span>
                    </Button>
                    <Button :variant="mobileView === 'results' ? 'default' : 'ghost'" size="sm"
                        class="flex-1 max-w-32 gap-2" @click="switchMobileView('results')">
                        <FileTextIcon class="size-4" />
                        <span>结果</span>
                    </Button>
                </div>
            </Transition>
        </template>
    </div>
</template>
