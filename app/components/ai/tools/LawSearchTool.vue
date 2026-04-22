<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { Check, Copy, FileText } from 'lucide-vue-next'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

interface LawSearchResult {
    score?: number
    content?: string
    metadata?: {
        legal_name?: string
        document_number?: string
        chapter_hierarchy?: string | string[]
        publish_date?: string
        effective_date?: string
        invalid_date?: string
    }
}

const results = computed<LawSearchResult[]>(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return Array.isArray(data) ? data : []
    } catch { return [] }
})

const query = computed<string>(() => props.input?.query || props.input?.keyword || '')

// 章节面包屑：原"X > Y > Z"风格改为 "X · Y · Z"，更柔和
function formatChapter(hierarchy: unknown): string {
    if (Array.isArray(hierarchy)) return hierarchy.filter(Boolean).join(' · ')
    if (typeof hierarchy === 'string') return hierarchy
    return ''
}

// 单条法条复制：key=index，true 表示处于"已复制"提示态（2s 后回落）
const copiedMap = ref<Record<number, boolean>>({})
const resetTimers: Record<number, ReturnType<typeof setTimeout>> = {}

async function copyArticle(index: number, content: string) {
    if (!content || typeof window === 'undefined' || !navigator?.clipboard?.writeText) return
    try {
        await navigator.clipboard.writeText(content)
        copiedMap.value = { ...copiedMap.value, [index]: true }
        if (resetTimers[index]) clearTimeout(resetTimers[index])
        resetTimers[index] = setTimeout(() => {
            copiedMap.value = { ...copiedMap.value, [index]: false }
        }, 2000)
    } catch {
        // 剪贴板失败时静默：用户可以再试一次
    }
}

onBeforeUnmount(() => {
    Object.values(resetTimers).forEach(t => clearTimeout(t))
})
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="法律检索" type="tool-search_law" :state="state">
            <template v-if="state === 'output-available' && results.length" #extra>
                <span class="text-xs text-muted-foreground">找到 {{ results.length }} 条结果</span>
            </template>
        </AiElementsToolHeader>
        <AiElementsToolContent v-if="input || output != null">
            <!-- 接续外层 header border 视觉 -->
            <div class="border-t border-border">
                <!-- 检索条件区（与材料检索同款） -->
                <div
                    v-if="query || input?.legalType"
                    class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2"
                >
                    <template v-if="query">
                        <span class="shrink-0 text-xs text-muted-foreground">关键词</span>
                        <span class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                            {{ query }}
                        </span>
                    </template>
                    <template v-if="input?.legalType">
                        <span class="shrink-0 text-xs text-muted-foreground" :class="{ 'ml-2': query }">类别</span>
                        <span class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                            {{ input.legalType }}
                        </span>
                    </template>
                </div>

                <!-- 法条结果列表 -->
                <div v-if="results.length" class="space-y-2 p-3">
                    <div
                        v-for="(item, index) in results"
                        :key="index"
                        class="group rounded-md border border-border/60 bg-muted/30 p-3 transition-colors hover:border-border hover:bg-muted/50"
                    >
                        <!-- 头部：法律名（强调） + 文号·章节（小字 muted） + 复制按钮 -->
                        <div class="flex items-start gap-2">
                            <FileText class="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <div class="min-w-0 flex-1">
                                <div class="text-xs font-medium text-foreground">
                                    {{ item.metadata?.legal_name || '未知法律' }}
                                </div>
                                <div
                                    v-if="formatChapter(item.metadata?.chapter_hierarchy) || item.metadata?.document_number"
                                    class="mt-0.5 text-[11px] text-muted-foreground"
                                >
                                    <template v-if="item.metadata?.document_number">{{ item.metadata.document_number }}</template>
                                    <template v-if="item.metadata?.document_number && formatChapter(item.metadata?.chapter_hierarchy)"> · </template>
                                    <template v-if="formatChapter(item.metadata?.chapter_hierarchy)">{{ formatChapter(item.metadata?.chapter_hierarchy) }}</template>
                                </div>
                            </div>
                            <button
                                type="button"
                                class="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                                :title="copiedMap[index] ? '已复制' : '复制法条'"
                                @click="copyArticle(index, item.content || '')"
                            >
                                <Check v-if="copiedMap[index]" class="size-3.5 text-emerald-500" />
                                <Copy v-else class="size-3.5 text-muted-foreground" />
                            </button>
                        </div>
                        <!-- 法条正文：左侧 primary 竖线 + 自动换行 -->
                        <div v-if="item.content" class="mt-2 flex gap-2 pl-1">
                            <div class="w-0.5 shrink-0 rounded-full bg-primary/70" />
                            <p class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                                {{ item.content }}
                            </p>
                        </div>
                    </div>
                </div>
                <div v-else-if="state === 'output-available'" class="p-4 text-sm text-muted-foreground">
                    未检索到结果
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
