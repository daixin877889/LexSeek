<script setup lang="ts">
/**
 * update_case_memory 工具卡片
 *
 * 输入：{ subjectKey, text, kind?, oldText? }
 * 输出：{ id, supersededId, ... }
 *
 * 紧凑卡片：旧值（灰删除线） → 新值（高亮）+ subject_key 灰小标。
 */
import { computed } from 'vue'
import { ArrowRightIcon, NotebookPenIcon } from 'lucide-vue-next'
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: {
        subjectKey?: string
        text?: string
        kind?: string
        oldText?: string
        previousText?: string
    } | any
    output?: any
    state: ExtendedToolState
}>()

const isDone = computed(() => props.state === 'output-available')
const isError = computed(() => props.state === 'output-error')

const oldText = computed(() => props.input?.oldText ?? props.input?.previousText ?? '')
const newText = computed(() => props.input?.text ?? '')
</script>

<template>
    <div class="rounded-md border bg-card text-xs my-2 px-3 py-2">
        <!-- 进行中 -->
        <div v-if="!isDone && !isError" class="flex items-center gap-2 text-muted-foreground">
            <NotebookPenIcon class="size-3.5 animate-pulse" />
            <span>正在更新案件记忆...</span>
        </div>

        <!-- 失败 -->
        <div v-else-if="isError" class="flex items-center gap-2 text-destructive">
            <NotebookPenIcon class="size-3.5" />
            <span>更新记忆失败</span>
        </div>

        <!-- 完成 -->
        <div v-else class="space-y-1">
            <div class="flex items-center gap-1.5 flex-wrap">
                <NotebookPenIcon class="size-3.5 text-emerald-600 flex-shrink-0" />
                <span class="text-muted-foreground">已更正记忆</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
                <span v-if="oldText"
                    class="text-muted-foreground/70 line-through line-clamp-1">{{ oldText }}</span>
                <ArrowRightIcon v-if="oldText" class="size-3 text-muted-foreground/50 flex-shrink-0" />
                <span class="text-foreground bg-emerald-50 px-1 rounded line-clamp-1">{{ newText }}</span>
            </div>
            <p v-if="input?.subjectKey"
                class="text-[10px] font-mono text-muted-foreground/60">
                {{ input.subjectKey }}
            </p>
        </div>
    </div>
</template>
