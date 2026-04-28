<script setup lang="ts">
/**
 * write_case_memory 工具卡片
 *
 * 输入：{ kind, text, subjectKey? }
 * 输出：{ id, ... }
 *
 * 紧凑卡片：✓ + 类型徽章 + 文本一行 + subject_key 灰小标。
 */
import { computed } from 'vue'
import { CheckIcon, BookMarkedIcon } from 'lucide-vue-next'
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: { kind?: string; text?: string; subjectKey?: string } | any
    output?: any
    state: ExtendedToolState
}>()

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
    <div class="rounded-md border bg-card text-xs my-2 px-3 py-2">
        <!-- 进行中 -->
        <div v-if="!isDone && !isError" class="flex items-center gap-2 text-muted-foreground">
            <BookMarkedIcon class="size-3.5 animate-pulse" />
            <span>正在记入案件记忆...</span>
        </div>

        <!-- 失败 -->
        <div v-else-if="isError" class="flex items-center gap-2 text-destructive">
            <BookMarkedIcon class="size-3.5" />
            <span>写入记忆失败</span>
        </div>

        <!-- 完成 -->
        <div v-else class="flex items-start gap-2">
            <CheckIcon class="size-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-muted-foreground">已记入</span>
                    <span v-if="input?.kind"
                        class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none font-medium"
                        :class="KIND_COLORS[input.kind]">
                        {{ KIND_LABELS[input.kind] ?? input.kind }}
                    </span>
                    <span v-if="input?.text" class="text-foreground line-clamp-1">{{ input.text }}</span>
                </div>
                <p v-if="input?.subjectKey"
                    class="mt-1 text-[10px] font-mono text-muted-foreground/60">
                    {{ input.subjectKey }}
                </p>
            </div>
        </div>
    </div>
</template>
