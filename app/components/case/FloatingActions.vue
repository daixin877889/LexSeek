<script setup lang="ts">
/**
 * 浮动操作按钮组件
 *
 * 在分析页面右下角显示浮动操作按钮，提供：
 * - 导出功能（Word、PDF、Markdown）
 * - 模块导航菜单
 *
 * @see Requirements 19.12-19.15
 * @see design.md - 导航与导出功能
 */
import type { HTMLAttributes } from 'vue'
import type { AnalysisResult } from '#shared/types/case'
import { cn } from '@/lib/utils'
import {
    DownloadIcon,
    NavigationIcon,
    FileTextIcon,
    FileIcon,
    FileTypeIcon,
    CheckIcon,
    LoaderIcon,
} from 'lucide-vue-next'

/**
 * 导出格式类型
 */
export type ExportFormat = 'word' | 'pdf' | 'markdown'

/**
 * 导出状态
 */
export interface ExportState {
    format: ExportFormat | null
    isExporting: boolean
    error: string | null
}

/**
 * 组件属性接口
 */
interface Props {
    /** 分析结果列表 */
    results: AnalysisResult[]
    /** 当前选中的模块索引 */
    activeIndex?: number
    /** 是否显示组件 */
    visible?: boolean
    /** 是否正在导出 */
    isExporting?: boolean
    /** 正在导出的格式 */
    exportingFormat?: ExportFormat | null
    /** 自定义类名 */
    class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
    results: () => [],
    activeIndex: 0,
    visible: true,
    isExporting: false,
    exportingFormat: null,
})

const emit = defineEmits<{
    /** 导出事件 */
    (e: 'export', format: ExportFormat): void
    /** 导航到指定模块 */
    (e: 'navigate', index: number): void
    /** 更新当前选中索引 */
    (e: 'update:activeIndex', index: number): void
}>()

// 是否有结果
const hasResults = computed(() => props.results.length > 0)

// 导出选项
const exportOptions = [
    {
        format: 'word' as ExportFormat,
        label: 'Word 文档',
        icon: FileTextIcon,
        description: '导出为 .docx 格式',
    },
    {
        format: 'pdf' as ExportFormat,
        label: 'PDF 文档',
        icon: FileIcon,
        description: '导出为 .pdf 格式',
    },
    {
        format: 'markdown' as ExportFormat,
        label: 'Markdown',
        icon: FileTypeIcon,
        description: '导出为 .md 格式',
    },
]

// 导出完成状态（用于显示成功图标）
const exportedFormat = ref<ExportFormat | null>(null)

/**
 * 处理导出
 */
function handleExport(format: ExportFormat) {
    emit('export', format)
}

/**
 * 处理导航
 */
function handleNavigate(index: number) {
    emit('navigate', index)
    emit('update:activeIndex', index)
}

/**
 * 判断导出选项是否正在导出
 */
function isOptionExporting(format: ExportFormat): boolean {
    return props.isExporting && props.exportingFormat === format
}

/**
 * 判断导出选项是否已完成
 */
function isOptionExported(format: ExportFormat): boolean {
    return exportedFormat.value === format
}

/**
 * 设置导出完成状态
 */
function setExportComplete(format: ExportFormat) {
    exportedFormat.value = format
    // 2 秒后重置
    setTimeout(() => {
        if (exportedFormat.value === format) {
            exportedFormat.value = null
        }
    }, 2000)
}

// 暴露方法供父组件调用
defineExpose({
    setExportComplete,
})
</script>

<template>
    <Transition enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-4 scale-95" enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-200 ease-in" leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-4 scale-95">
        <div v-if="visible && hasResults" :class="cn(
            'fixed bottom-6 right-6 z-[60] flex flex-col gap-2',
            props.class
        )">
            <!-- 导航按钮 -->
            <DropdownMenu v-if="results.length > 1">
                <DropdownMenuTrigger as-child>
                    <Button variant="secondary" size="icon"
                        class="size-12 rounded-full shadow-lg hover:shadow-xl transition-shadow" title="模块导航">
                        <NavigationIcon class="size-5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="w-56 mb-2">
                    <DropdownMenuLabel class="text-xs text-muted-foreground">
                        跳转到分析结果
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem v-for="(result, index) in results" :key="result.nodeId"
                        class="flex items-center gap-2 cursor-pointer" @click="handleNavigate(index)">
                        <FileTextIcon class="size-4 shrink-0" />
                        <span class="flex-1 truncate">{{ result.moduleTitle || result.moduleName }}</span>
                        <CheckIcon v-if="index === activeIndex" class="size-4 text-primary shrink-0" />
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <!-- 导出按钮 -->
            <DropdownMenu>
                <DropdownMenuTrigger as-child>
                    <Button variant="default" size="icon"
                        class="size-12 rounded-full shadow-lg hover:shadow-xl transition-shadow" title="导出分析结果"
                        :disabled="isExporting">
                        <LoaderIcon v-if="isExporting" class="size-5 animate-spin" />
                        <DownloadIcon v-else class="size-5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="w-56 mb-2">
                    <DropdownMenuLabel class="text-xs text-muted-foreground">
                        导出分析结果
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem v-for="option in exportOptions" :key="option.format"
                        class="flex items-center gap-3 cursor-pointer" :disabled="isExporting"
                        @click="handleExport(option.format)">
                        <!-- 图标 -->
                        <div class="shrink-0">
                            <LoaderIcon v-if="isOptionExporting(option.format)" class="size-4 animate-spin" />
                            <CheckIcon v-else-if="isOptionExported(option.format)" class="size-4 text-green-500" />
                            <component :is="option.icon" v-else class="size-4" />
                        </div>
                        <!-- 文本 -->
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium">{{ option.label }}</div>
                            <div class="text-xs text-muted-foreground">{{ option.description }}</div>
                        </div>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </Transition>
</template>
