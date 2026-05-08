<script setup lang="ts">
/**
 * search_case_analysis 结果卡片
 *
 * 与 MaterialSearchTool 同一视觉规范（折叠 + 关键词条 + HoverCard / 移动端 Sheet 全文）。
 * 数据形态来自 server/services/agent-platform/tools/search_case_analysis.tool.ts:
 *   { id, text, score, analysisType, version }
 *
 * 与材料检索的差异：
 * - 无 OSS 图片（分析正文是纯 markdown）→ 删 OSS 解析逻辑
 * - 用 analysisType（claim/trend/cause/...）+ 显示名映射代替 sourceName
 * - 加 version 角标，便于识别不同版本的分析片段
 */
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { useMediaQuery } from '@vueuse/core'
import {
    BookOpenText,
    ChevronDown,
    Wrench,
} from 'lucide-vue-next'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { ANALYSIS_NODE_LABEL as ANALYSIS_TYPE_LABEL } from '~/utils/toolDisplayName'
import { stripMarkdown } from '~/utils/stripMarkdown'

interface AnalysisSearchHit {
    id: string
    text: string
    score: number
    analysisType?: string
    version?: number | string
}

const props = defineProps<{
    toolName: string
    input?: { query?: string; analysis_type?: string } | any
    output?: any
    state: ExtendedToolState
}>()

const isOpen = ref(false)
const canHover = useMediaQuery('(hover: hover)')

// 移动端点击查看全文用的 Sheet 状态
const mobileSheetOpen = ref(false)
const activeHit = ref<AnalysisSearchHit | null>(null)

function openMobileDetail(h: AnalysisSearchHit) {
    activeHit.value = h
    mobileSheetOpen.value = true
}

const query = computed<string>(() => {
    const q = props.input?.query
    return typeof q === 'string' && q.trim() ? q.trim() : ''
})

const analysisTypeFilter = computed<string>(() => {
    const t = props.input?.analysis_type
    return typeof t === 'string' && t.trim() ? t.trim() : ''
})

function labelOf(type?: string): string {
    if (!type) return '分析片段'
    return ANALYSIS_TYPE_LABEL[type] ?? type
}

const results = computed<AnalysisSearchHit[]>(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        if (!Array.isArray(data)) return []
        return data.filter((r: any): r is AnalysisSearchHit =>
            r && typeof r === 'object' && typeof r.text === 'string',
        )
    } catch {
        return []
    }
})

const isDone = computed(() => props.state === 'output-available')

const resultSummary = computed(() => {
    if (!isDone.value) return ''
    return results.value.length === 0
        ? '未找到相关分析'
        : `找到 ${results.value.length} 条结果`
})

// 仅在有任何可显示内容时允许展开（条件 / 结果之一存在即可）
const hasExpandableContent = computed(() => {
    return !!query.value || !!analysisTypeFilter.value || results.value.length > 0
})
</script>

<template>
    <Collapsible v-model:open="isOpen" class="group not-prose mb-4 w-full rounded-md border">
        <CollapsibleTrigger class="flex w-full items-center justify-between gap-4 p-3">
            <div class="flex min-w-0 items-center gap-2">
                <Wrench class="size-4 shrink-0 text-muted-foreground" />
                <span class="shrink-0 text-sm font-medium">案件分析检索</span>
                <ToolStatusBadge :state="state" />
            </div>
            <div class="flex items-center gap-2">
                <span v-if="resultSummary" class="text-xs text-muted-foreground">
                    {{ resultSummary }}
                </span>
                <ChevronDown
                    v-if="hasExpandableContent"
                    class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                />
            </div>
        </CollapsibleTrigger>

        <CollapsibleContent
            v-if="hasExpandableContent"
            class="overflow-hidden data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2"
        >
            <div class="border-t border-border">
                <!-- 关键词 + 模块筛选条 -->
                <div
                    v-if="query || analysisTypeFilter"
                    class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
                >
                    <template v-if="query">
                        <span class="shrink-0 text-xs text-muted-foreground">关键词</span>
                        <span class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                            {{ query }}
                        </span>
                    </template>
                    <template v-if="analysisTypeFilter">
                        <span class="shrink-0 text-xs text-muted-foreground" :class="{ 'ml-2': query }">模块</span>
                        <span class="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                            {{ labelOf(analysisTypeFilter) }}
                        </span>
                    </template>
                </div>
                <!-- 空态：有查询条件但 0 条结果 -->
                <div
                    v-if="results.length === 0 && isDone"
                    class="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                    未找到相关分析
                </div>
                <div v-else-if="results.length > 0" class="space-y-2 p-3">
                    <template v-for="(r, i) in results" :key="r.id ?? i">
                        <!-- 桌面端：HoverCard 悬停预览 -->
                        <HoverCard v-if="canHover" :open-delay="200" :close-delay="100">
                            <HoverCardTrigger as-child>
                                <div class="cursor-default rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/50">
                                    <div class="mb-1.5 flex items-center gap-2">
                                        <BookOpenText class="size-3.5 shrink-0 text-primary" />
                                        <span class="truncate text-xs font-medium text-foreground">
                                            {{ labelOf(r.analysisType) }}
                                        </span>
                                        <span
                                            v-if="r.version !== undefined && r.version !== null && r.version !== ''"
                                            class="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                                        >
                                            v{{ r.version }}
                                        </span>
                                        <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                            #{{ i + 1 }}
                                        </span>
                                    </div>
                                    <div class="flex gap-2 pl-1">
                                        <div class="w-0.5 shrink-0 rounded-full bg-primary/70" />
                                        <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                            {{ stripMarkdown(r.text || '').substring(0, 200) }}
                                        </p>
                                    </div>
                                </div>
                            </HoverCardTrigger>

                            <HoverCardContent
                                v-if="r.text"
                                side="top"
                                align="start"
                                class="z-[200] flex max-h-[400px] w-[420px] flex-col overflow-hidden p-0"
                            >
                                <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                                    <BookOpenText class="size-4 shrink-0 text-primary" />
                                    <span class="truncate text-sm font-semibold text-foreground">
                                        {{ labelOf(r.analysisType) }}
                                    </span>
                                    <span
                                        v-if="r.version !== undefined && r.version !== null && r.version !== ''"
                                        class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                    >
                                        v{{ r.version }}
                                    </span>
                                    <span class="ml-auto shrink-0 text-xs text-muted-foreground">
                                        #{{ i + 1 }}
                                    </span>
                                </div>
                                <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                                    <div class="prose prose-sm dark:prose-invert max-w-none text-foreground/90 [&_*]:!text-xs [&_*]:!leading-snug [&_p]:!my-1.5 [&_ul]:!my-1.5 [&_ol]:!my-1.5 [&_blockquote]:!my-1.5 [&_pre]:!my-1.5 [&_h1]:!my-2 [&_h2]:!my-2 [&_h3]:!my-1.5 [&_h4]:!my-1.5">
                                        <Markdown :content="r.text" />
                                    </div>
                                </div>
                            </HoverCardContent>
                        </HoverCard>

                        <!-- 移动端：点击触发底部 Sheet -->
                        <button
                            v-else
                            type="button"
                            class="block w-full rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-left transition-colors active:bg-muted/60"
                            @click="openMobileDetail(r)"
                        >
                            <div class="mb-1.5 flex items-center gap-2">
                                <BookOpenText class="size-3.5 shrink-0 text-primary" />
                                <span class="truncate text-xs font-medium text-foreground">
                                    {{ labelOf(r.analysisType) }}
                                </span>
                                <span
                                    v-if="r.version !== undefined && r.version !== null && r.version !== ''"
                                    class="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                                >
                                    v{{ r.version }}
                                </span>
                                <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                    #{{ i + 1 }}
                                </span>
                            </div>
                            <div class="flex gap-2 pl-1">
                                <div class="w-0.5 shrink-0 rounded-full bg-primary/70" />
                                <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                    {{ stripMarkdown(r.text || '').substring(0, 200) }}
                                </p>
                            </div>
                        </button>
                    </template>
                </div>
            </div>
        </CollapsibleContent>

        <Sheet v-model:open="mobileSheetOpen">
            <SheetContent
                side="bottom"
                class="z-[200] flex max-h-[80vh] flex-col gap-0 p-0"
            >
                <SheetHeader class="border-b border-border px-4 py-3 pr-12">
                    <SheetTitle class="flex items-center gap-2 text-sm">
                        <BookOpenText class="size-4 shrink-0 text-primary" />
                        <span class="truncate">
                            {{ labelOf(activeHit?.analysisType) }}
                        </span>
                        <span
                            v-if="activeHit?.version !== undefined && activeHit?.version !== null && activeHit?.version !== ''"
                            class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                            v{{ activeHit.version }}
                        </span>
                    </SheetTitle>
                    <SheetDescription class="text-xs">
                        分析片段
                    </SheetDescription>
                </SheetHeader>
                <div class="flex-1 overflow-y-auto px-4 py-3">
                    <div class="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                        <Markdown :content="activeHit?.text ?? ''" />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    </Collapsible>
</template>
