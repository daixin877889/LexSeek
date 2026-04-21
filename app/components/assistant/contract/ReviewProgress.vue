<script setup lang="ts">
/**
 * 合同审查阶段进度条（M6.1 子期 1）
 *
 * 5 段进度：识别 / 等立场 / 切分 / 分析 / 汇总
 * - 每段可视化为一个小圆点：wait 灰 / running 橙+光晕 / done 绿
 * - analyze 阶段 running 时额外显示 "正在分析第 X / Y 条"
 * - 全部 done 时组件隐藏（by v-if）
 *
 * 自动导入名：AssistantContractReviewProgress
 */

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
                        class="size-2.5 rounded-full transition-colors shrink-0"
                        :class="{
                            'bg-gray-300 dark:bg-gray-600': stages[key] === 'wait',
                            'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)] animate-pulse': stages[key] === 'running',
                            'bg-emerald-600': stages[key] === 'done',
                        }"
                    />
                    <span class="text-xs text-muted-foreground">{{ STAGE_LABEL[key] }}</span>
                </div>
                <span v-if="key !== 'summarize'" class="text-gray-300 dark:text-gray-600">·</span>
            </template>
        </div>
        <div v-if="progressText" class="text-xs text-muted-foreground flex items-center gap-2">
            <span class="whitespace-nowrap">{{ progressText }}</span>
            <div v-if="totalClauses" class="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden min-w-[40px]">
                <div
                    class="h-full bg-blue-500 transition-all"
                    :style="{ width: `${((analyzingIndex ?? 0) / totalClauses) * 100}%` }"
                />
            </div>
        </div>
    </div>
</template>
