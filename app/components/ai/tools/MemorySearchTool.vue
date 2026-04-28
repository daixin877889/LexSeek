<script setup lang="ts">
/**
 * search_case_memory 工具卡片
 *
 * 输入：{ query: string }
 * 输出：Array<{ id, text, kind, subjectKey?, score? }> 或 string（JSON）
 *
 * 视觉：默认折叠 "找到 N 条相关记忆"，展开显示 Top 3 一行预览。
 */
import { computed, ref } from 'vue'
import { ChevronDownIcon, NotebookPenIcon } from 'lucide-vue-next'
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
    fact: 'bg-blue-100 text-blue-700',
    event: 'bg-emerald-100 text-emerald-700',
    decision: 'bg-amber-100 text-amber-700',
    note: 'bg-gray-100 text-gray-700',
}
</script>

<template>
    <div class="rounded-md border bg-card text-xs my-2">
        <!-- 状态：进行中 -->
        <div v-if="!isDone && !isError" class="flex items-center gap-2 px-3 py-2 text-muted-foreground">
            <NotebookPenIcon class="size-3.5 animate-pulse" />
            <span>正在检索案件记忆...</span>
            <span v-if="query" class="font-mono text-[10px] text-muted-foreground/70 truncate">"{{ query }}"</span>
        </div>

        <!-- 状态：失败 -->
        <div v-else-if="isError" class="flex items-center gap-2 px-3 py-2 text-destructive">
            <NotebookPenIcon class="size-3.5" />
            <span>记忆检索失败</span>
        </div>

        <!-- 状态：完成 -->
        <button v-else
            class="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent transition-colors"
            @click="isOpen = !isOpen">
            <div class="flex items-center gap-2 min-w-0">
                <NotebookPenIcon class="size-3.5 text-muted-foreground flex-shrink-0" />
                <span class="text-muted-foreground">找到 {{ hits.length }} 条相关记忆</span>
                <span v-if="query" class="font-mono text-[10px] text-muted-foreground/70 truncate">"{{ query }}"</span>
            </div>
            <ChevronDownIcon class="size-3 text-muted-foreground transition-transform"
                :class="isOpen ? 'rotate-180' : ''" />
        </button>

        <div v-if="isDone && isOpen" class="border-t px-3 py-2 space-y-1.5">
            <div v-if="hits.length === 0" class="text-muted-foreground/70 italic">没有命中条目</div>
            <div v-for="(hit, idx) in hits.slice(0, 3)" :key="hit.id ?? idx"
                class="flex items-start gap-1.5">
                <Badge v-if="hit.kind" variant="secondary"
                    class="font-normal px-1.5 py-0 h-4 text-[10px] flex-shrink-0"
                    :class="KIND_COLORS[hit.kind]">
                    {{ hit.kind }}
                </Badge>
                <span class="line-clamp-1 text-foreground">{{ hit.text }}</span>
            </div>
            <div v-if="hits.length > 3" class="text-[10px] text-muted-foreground/60 pt-0.5">
                还有 {{ hits.length - 3 }} 条命中（被 AI 用作回答上下文）
            </div>
        </div>
    </div>
</template>
