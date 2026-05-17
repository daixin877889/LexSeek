<script setup lang="ts">
/**
 * 合同审查阶段进度条（M6.1 子期 1）
 *
 * 5 段进度：识别 / 等立场 / 切分 / 分析 / 汇总
 * - 每段可视化：wait 灰点 / running Loader2 旋转 / done CheckCircle2
 * - analyze 阶段 running 时额外显示 "正在分析第 X / Y 条"
 * - 全部 done 时组件隐藏（by v-if）
 *
 * 自动导入名：AssistantContractReviewProgress
 */
import { CheckCircle2Icon, Loader2Icon } from 'lucide-vue-next'

type StageKey = 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'
type Status = 'wait' | 'running' | 'done'

const props = defineProps<{
    stages: Record<StageKey, Status>
    totalClauses: number | null
    analyzingIndex: number | null
}>()

const STAGE_LABEL: Record<StageKey, string> = {
    detect: '识别甲乙方',
    stance: '等待立场',
    segment: '切分条款',
    analyze: '分析风险',
    summarize: '汇总总览',
}
const STAGE_ORDER: StageKey[] = ['detect', 'stance', 'segment', 'analyze', 'summarize']

const allDone = computed(() => STAGE_ORDER.every(k => props.stages[k] === 'done'))

const progressText = computed(() => {
    if (props.stages.analyze !== 'running') return null
    if (props.totalClauses === null || props.analyzingIndex === null) return null
    return `正在分析第 ${props.analyzingIndex} / ${props.totalClauses} 条`
})
</script>

<template>
    <div v-if="!allDone" class="p-3 border-b bg-muted/20 text-sm space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <template v-for="key in STAGE_ORDER" :key="key">
                <div class="flex items-center gap-1.5 whitespace-nowrap">
                    <span
                        data-stage-dot
                        :data-stage="key"
                        :data-stage-status="stages[key]"
                        class="flex items-center justify-center shrink-0"
                    >
                        <CheckCircle2Icon v-if="stages[key] === 'done'" class="size-3.5 text-emerald-600" />
                        <Loader2Icon v-else-if="stages[key] === 'running'" class="size-3.5 text-primary animate-spin" />
                        <span v-else class="size-2 rounded-full bg-muted-foreground/30" />
                    </span>
                    <span
                        class="text-xs"
                        :class="{
                            'text-emerald-600': stages[key] === 'done',
                            'text-primary font-medium': stages[key] === 'running',
                            'text-muted-foreground': stages[key] === 'wait',
                        }"
                    >{{ STAGE_LABEL[key] }}</span>
                </div>
                <span v-if="key !== 'summarize'" class="text-muted-foreground/40">·</span>
            </template>
        </div>
        <div v-if="progressText" class="text-xs text-muted-foreground flex items-center gap-2">
            <span class="whitespace-nowrap">{{ progressText }}</span>
            <div v-if="totalClauses" class="flex-1 h-1 bg-muted rounded overflow-hidden min-w-[40px]">
                <div
                    class="h-full bg-gradient-brand-button transition-all"
                    :style="{ width: `${((analyzingIndex ?? 0) / totalClauses) * 100}%` }"
                />
            </div>
        </div>
    </div>
</template>
