<script setup lang="ts">
/**
 * search_case_memory 工具卡片
 *
 * 输入：{ query: string }
 * 输出：Array<{ id, text, kind, subjectKey?, score? }> 或 string（JSON）
 *
 * 视觉：默认折叠 "找到 N 条相关记忆"，展开显示 Top 3 一行预览；
 * 桌面端鼠标悬停在条目上展示完整内容（HoverCard），移动端点击弹底部 Sheet。
 */
import { computed, ref } from 'vue'
import { ChevronDownIcon, LightbulbIcon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import type { ExtendedToolState } from '@/components/ai-elements/types'

interface MemorySearchHit {
    id?: string
    text?: string
    kind?: string
    subjectKey?: string
    score?: number
    [key: string]: any
}

const props = defineProps<{
    toolName: string
    input?: { query?: string } | any
    output?: any
    state: ExtendedToolState
}>()

const isOpen = ref(false)

// SSR 期间为 false，水合后客户端重新计算；对话流为客户端渲染，无视觉抖动
const canHover = useMediaQuery('(hover: hover)')

const mobileSheetOpen = ref(false)
const activeHit = ref<MemorySearchHit | null>(null)
function openMobileDetail(hit: MemorySearchHit) {
    activeHit.value = hit
    mobileSheetOpen.value = true
}

const query = computed<string>(() => {
    const q = props.input?.query
    return typeof q === 'string' && q.trim() ? q.trim() : ''
})

const hits = computed<MemorySearchHit[]>(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
})

const isDone = computed(() => props.state === 'output-available')
const isError = computed(() => props.state === 'output-error')

const KIND_COLORS: Record<string, string> = {
    fact: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    event: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    decision: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    note: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
    dialogue_note: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
    preference: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
}

const KIND_LABELS: Record<string, string> = {
    fact: '事实',
    event: '事件',
    decision: '决策',
    note: '笔记',
    dialogue_note: '对话笔记',
    preference: '偏好',
}
</script>

<template>
    <div class="rounded-md border bg-card text-xs my-2">
        <!-- 状态：进行中 -->
        <div v-if="!isDone && !isError" class="px-3 py-2 text-muted-foreground">
            <div class="flex items-center gap-2">
                <LightbulbIcon class="size-3.5 shrink-0 animate-pulse" />
                <span class="shrink-0">正在检索案件记忆...</span>
            </div>
            <div v-if="query" class="mt-0.5 truncate pl-[22px] font-mono text-[10px] text-muted-foreground/70">
                "{{ query }}"
            </div>
        </div>

        <!-- 状态：失败 -->
        <div v-else-if="isError" class="flex items-center gap-2 px-3 py-2 text-destructive">
            <LightbulbIcon class="size-3.5" />
            <span>记忆检索失败</span>
        </div>

        <!-- 状态：完成 -->
        <button v-else
            class="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent transition-colors"
            @click="isOpen = !isOpen">
            <div class="flex items-center gap-2 min-w-0">
                <LightbulbIcon class="size-3.5 text-muted-foreground flex-shrink-0" />
                <span class="text-muted-foreground">找到 {{ hits.length }} 条相关记忆</span>
            </div>
            <ChevronDownIcon class="size-3 text-muted-foreground transition-transform"
                :class="isOpen ? 'rotate-180' : ''" />
        </button>

        <div v-if="isDone && isOpen" class="border-t">
            <!-- 查询条件区（参考 MaterialSearchTool） -->
            <div v-if="query" class="flex items-center gap-2 border-b px-3 py-2">
                <span class="shrink-0 text-[11px] text-muted-foreground">查询</span>
                <span class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary line-clamp-1">
                    {{ query }}
                </span>
            </div>
            <!-- 结果列表 -->
            <div class="px-3 py-2 space-y-1.5">
                <div v-if="hits.length === 0" class="text-muted-foreground/70 italic">没有命中条目</div>

                <template v-for="(hit, idx) in hits.slice(0, 3)" :key="hit.id ?? idx">
                    <HoverCard v-if="canHover" :open-delay="200" :close-delay="100">
                        <HoverCardTrigger as-child>
                            <div class="flex cursor-default items-start gap-1.5 -mx-1 rounded px-1 py-0.5 transition-colors hover:bg-muted/50">
                                <span v-if="hit.kind"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none font-medium flex-shrink-0"
                                    :class="KIND_COLORS[hit.kind]">
                                    {{ KIND_LABELS[hit.kind] ?? hit.kind }}
                                </span>
                                <span class="line-clamp-1 text-foreground">{{ hit.text }}</span>
                            </div>
                        </HoverCardTrigger>
                        <HoverCardContent
                            v-if="hit.text"
                            side="top"
                            align="start"
                            class="z-[200] flex max-h-[400px] w-[420px] flex-col overflow-hidden p-0"
                        >
                            <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                                <LightbulbIcon class="size-4 shrink-0 text-amber-500" />
                                <span v-if="hit.kind"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none font-medium"
                                    :class="KIND_COLORS[hit.kind]">
                                    {{ KIND_LABELS[hit.kind] ?? hit.kind }}
                                </span>
                                <span v-else class="text-sm font-semibold text-foreground">记忆详情</span>
                            </div>
                            <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                                <p class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                                    {{ hit.text }}
                                </p>
                                <p v-if="hit.subjectKey" class="font-mono text-[10px] text-muted-foreground/60">
                                    {{ hit.subjectKey }}
                                </p>
                            </div>
                        </HoverCardContent>
                    </HoverCard>

                    <button
                        v-else
                        type="button"
                        class="block w-full -mx-1 rounded px-1 py-0.5 text-left transition-colors active:bg-muted/60"
                        @click="openMobileDetail(hit)"
                    >
                        <div class="flex items-start gap-1.5">
                            <span v-if="hit.kind"
                                class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none font-medium flex-shrink-0"
                                :class="KIND_COLORS[hit.kind]">
                                {{ KIND_LABELS[hit.kind] ?? hit.kind }}
                            </span>
                            <span class="line-clamp-1 text-foreground">{{ hit.text }}</span>
                        </div>
                    </button>
                </template>

                <div v-if="hits.length > 3" class="text-[10px] text-muted-foreground/60 pt-0.5">
                    还有 {{ hits.length - 3 }} 条命中（被 AI 用作回答上下文）
                </div>
            </div>
        </div>

        <!-- 移动端全文 Sheet（z-[200] 防止被对话面板挡住） -->
        <Sheet v-model:open="mobileSheetOpen">
            <SheetContent
                side="bottom"
                class="z-[200] flex max-h-[80vh] flex-col gap-0 p-0"
            >
                <SheetHeader class="border-b border-border px-4 py-3 pr-12">
                    <SheetTitle class="flex items-center gap-2 text-sm">
                        <LightbulbIcon class="size-4 shrink-0 text-amber-500" />
                        <span v-if="activeHit?.kind"
                            class="inline-flex items-center px-1.5 py-0.5 rounded text-xs leading-none font-medium"
                            :class="KIND_COLORS[activeHit.kind]">
                            {{ KIND_LABELS[activeHit.kind] ?? activeHit.kind }}
                        </span>
                        <span v-else>记忆详情</span>
                    </SheetTitle>
                    <SheetDescription class="sr-only">案件记忆完整内容</SheetDescription>
                </SheetHeader>
                <div class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                    <p class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                        {{ activeHit?.text }}
                    </p>
                    <p v-if="activeHit?.subjectKey" class="font-mono text-[10px] text-muted-foreground/60">
                        {{ activeHit.subjectKey }}
                    </p>
                </div>
            </SheetContent>
        </Sheet>
    </div>
</template>
