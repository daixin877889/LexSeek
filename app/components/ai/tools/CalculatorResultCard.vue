<script setup lang="ts">
/**
 * 办案计算器结果卡片（PANEL_TOOL_MAP 协议）
 *
 * 协议对齐 ReviewContractCard：
 * - props.toolName: 工具名（如 'calculate_compensation'）
 * - props.input: toolCall.args（原始输入参数）
 * - props.output: toolCall.result（JSON 字符串或对象）
 * - props.state: ExtendedToolState（执行状态）
 */
import { computed } from 'vue'
import { Calculator, CircleCheck, Ban, Check, Loader2, XCircle } from 'lucide-vue-next'
import type { ExtendedToolState } from '~/components/ai-elements/types'
import CalculatorResultBody from '~/components/ai/tools/CalculatorResultBody.vue'
import { CALCULATOR_TOOL_META } from '#shared/utils/tools/agentTools/_fieldMetadata'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const displayName = computed(() =>
    CALCULATOR_TOOL_META[props.toolName]?.displayName ?? props.toolName,
)

const parsedOutput = computed<Record<string, any>>(() => {
    const raw = props.output
    if (raw == null) return {}
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return {} }
    }
    if (typeof raw === 'object') return raw as Record<string, any>
    return {}
})

const parsedInput = computed<Record<string, any>>(() => props.input ?? {})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

const isFailed = computed(() => {
    if (props.state === 'output-error' || props.state === 'output-denied') return true
    if (parsedOutput.value?.success === false) return true
    if (props.state === 'output-available' && Object.keys(parsedOutput.value).length === 0) return true
    return false
})

const isCancelled = computed(() => parsedOutput.value?.cancelled === true)

const isCompleted = computed(() => !isRunning.value && !isFailed.value)
</script>

<template>
    <div
        class="not-prose group my-2 w-full max-w-lg rounded-lg border bg-card p-4 shadow-sm transition-colors"
        :class="[
            isRunning && 'border-primary/40 bg-primary/5',
            isFailed && 'border-destructive/40 bg-destructive/5',
        ]"
    >
        <!-- 执行中 -->
        <div v-if="isRunning" class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Loader2 class="size-5 animate-spin text-primary" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">{{ displayName }}</p>
                <p class="mt-0.5 truncate text-xs text-primary">正在计算...</p>
            </div>
        </div>

        <!-- 失败 -->
        <div v-else-if="isFailed" class="flex items-start gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <XCircle class="size-5 text-destructive" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">计算失败</p>
                <p class="mt-0.5 text-xs text-destructive">
                    {{ parsedOutput?.error || '计算过程中出现错误，请稍后重试' }}
                </p>
            </div>
        </div>

        <!-- 已取消 -->
        <div v-else-if="isCancelled" class="flex items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Ban class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">{{ displayName }} · 已取消</p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">用户取消了本次计算</p>
            </div>
        </div>

        <!-- 已完成 -->
        <div v-else-if="isCompleted" class="space-y-3">
            <div class="flex items-center gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
                    <CircleCheck class="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-foreground">{{ displayName }}结果</p>
                </div>
            </div>

            <!-- 结果内容 -->
            <CalculatorResultBody :tool-name="toolName" :input="parsedInput" :output="parsedOutput" />

            <!-- 已写入记忆提示 -->
            <div class="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                <Check class="size-3.5 shrink-0" />
                已自动保存到案件记忆，下次再算时会自动预填这些字段
            </div>
        </div>
    </div>
</template>
