<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import {
    CheckCircle2,
    Loader2,
    PauseCircle,
    Save,
    XCircle,
} from 'lucide-vue-next'

/**
 * 保存分析结果工具卡片
 *
 * 视觉与 Read/Write/RunSkill 同款（FileCard 风格）。不渲染 input.analysisResult（大段 markdown 正文）。
 * 完成态把 output.message（"分析结果已保存为第N版"）作为主标题展示，token 数作为副标题补充。
 */
interface SaveResultOutput {
    success?: boolean
    version?: number
    message?: string
    error?: string
    tokens?: number | null
    tokenCount?: number | null
}

const props = defineProps<{
    toolName: string
    input?: { analysisResult?: string } | any
    output?: any
    state: ExtendedToolState
}>()

// output 可能是 string（JSON）或 object，按需 parse
const result = computed<SaveResultOutput | null>(() => {
    const raw = props.output
    if (raw == null) return null
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return null }
    }
    if (typeof raw === 'object') return raw as SaveResultOutput
    return null
})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

// 业务失败（output.success === false）也算失败态，统一染色
const isFailed = computed(() => {
    if (props.state === 'output-error' || props.state === 'output-denied') return true
    return result.value?.success === false
})

// 主标题：完成时优先用后端的 message（"分析结果已保存为第N版"），其它态固定文案
const title = computed<string>(() => {
    if (isRunning.value) return '保存分析结果'
    if (isFailed.value) return '保存失败'
    return result.value?.message || '保存分析结果'
})

// 副标题：完成时显示 token 消耗，失败显示错误信息，运行中显示"正在保存…"
const subtitle = computed<string>(() => {
    if (isRunning.value) return '正在保存…'
    if (isFailed.value) return result.value?.error || '保存失败，请稍后重试'

    const parts: string[] = ['保存分析结果']
    const tokens = result.value?.tokens
    if (typeof tokens === 'number' && tokens > 0) {
        parts.push(`${tokens.toLocaleString()} tokens`)
    }
    return parts.join(' · ')
})
</script>

<template>
    <div
        class="not-prose group my-2 inline-flex w-full max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors"
        :class="[
            isRunning && 'border-primary/40 bg-primary/5',
            isFailed && 'border-destructive/40 bg-destructive/5',
            !isRunning && !isFailed && 'hover:border-border hover:bg-muted/30',
        ]"
    >
        <!-- 左侧图标方块：运行中 spinner / 失败红 X / 默认 Save -->
        <div
            class="flex size-10 shrink-0 items-center justify-center rounded-md"
            :class="isFailed ? 'bg-destructive/10' : 'bg-primary/10'"
        >
            <Loader2 v-if="isRunning" class="size-5 animate-spin text-primary" />
            <XCircle v-else-if="isFailed" class="size-5 text-destructive" />
            <Save v-else class="size-5 text-primary" />
        </div>

        <!-- 主信息：标题 + 副标题 -->
        <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground" :title="title">
                {{ title }}
            </p>
            <p
                class="mt-0.5 truncate text-xs"
                :class="[
                    isRunning && 'text-primary',
                    isFailed && 'text-destructive',
                    !isRunning && !isFailed && 'text-muted-foreground',
                ]"
                :title="subtitle"
            >
                {{ subtitle }}
            </p>
        </div>

        <!-- 右侧状态小图标（运行中由左侧 spinner 表达） -->
        <CheckCircle2
            v-if="state === 'output-available' && !isFailed"
            class="size-4 shrink-0 text-green-500"
        />
        <XCircle
            v-else-if="state === 'output-error' || isFailed"
            class="size-4 shrink-0 text-destructive"
        />
        <XCircle
            v-else-if="state === 'output-denied'"
            class="size-4 shrink-0 text-orange-500"
        />
        <PauseCircle
            v-else-if="state === 'input-paused'"
            class="size-4 shrink-0 text-yellow-500"
        />
    </div>
</template>
