<script setup lang="ts">
/**
 * 合同分档总览区
 *
 * 展示内容：
 * - conic-gradient 仪表盘 + 加权风险分 + 定性标签
 * - 三色计数卡（高/中/低）——纯展示不可点（spec 入口 1+2+4，未选入口 3）
 * - 分档要点（highlights 非空时显示，每条 button 化，emit focusRisk）
 * - 总评文字
 *
 * highlights 为 null 时降级为仅显示仪表盘 + 计数 + 总评。
 *
 * **Feature: contract-review-m6-1 Task 3.3**
 */
import { TriangleAlert, Info } from 'lucide-vue-next'
import type { Risk, ContractOverview } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    summary: ContractOverview | null
}>()

const emit = defineEmits<{
    focusRisk: [riskId: string]
}>()

const risksRef = computed(() => props.risks)
const { counts, score, scoreLabel } = useContractOverview(risksRef)

const hasHighlights = computed(() => !!props.summary?.highlights)
const overall = computed(() => props.summary?.overall ?? '')

/** conic-gradient 角度（风险分 → 0~360deg） */
const arcDeg = computed(() => (score.value / 100) * 360)
</script>

<template>
    <div class="p-3 border-b bg-muted/10 space-y-3">
        <!-- 仪表盘 + 定性标签 -->
        <div class="flex items-center gap-3">
            <div
                class="relative size-16 flex items-center justify-center"
                :style="{
                    background: `conic-gradient(#b91c1c 0deg ${arcDeg}deg, #e5e7eb ${arcDeg}deg 360deg)`,
                    borderRadius: '50%',
                }"
            >
                <div class="absolute inset-2 bg-background rounded-full flex items-center justify-center text-lg font-bold">
                    {{ score }}
                </div>
            </div>
            <div class="text-xs">
                <div class="text-red-700 dark:text-red-300 font-semibold">合同风险分 {{ score }}/100</div>
                <div class="text-muted-foreground">{{ scoreLabel }}</div>
            </div>
        </div>

        <!-- 三色计数卡（只读，不可点；用 div 而非 button） -->
        <div class="grid grid-cols-3 gap-1.5">
            <div class="bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-200 rounded p-2 text-center" data-count="high">
                <div class="text-lg font-bold">{{ counts.high }}</div>
                <div class="text-xs">高</div>
            </div>
            <div class="bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-200 rounded p-2 text-center" data-count="medium">
                <div class="text-lg font-bold">{{ counts.medium }}</div>
                <div class="text-xs">中</div>
            </div>
            <div class="bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 rounded p-2 text-center" data-count="low">
                <div class="text-lg font-bold">{{ counts.low }}</div>
                <div class="text-xs">低</div>
            </div>
        </div>

        <!-- 分档要点（仅 highlights 非空时显示） -->
        <template v-if="hasHighlights">
            <div v-if="summary!.highlights!.high.length" class="space-y-1">
                <div class="text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-1">
                    <TriangleAlert class="size-3" />
                    高风险要点
                </div>
                <button
                    v-for="h in summary!.highlights!.high"
                    :key="h.riskId"
                    :data-riskid="h.riskId"
                    class="block w-full text-left text-xs px-1.5 py-1 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                    @click="emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.medium.length" class="space-y-1">
                <div class="text-xs font-semibold text-orange-700 dark:text-orange-300 flex items-center gap-1">
                    <TriangleAlert class="size-3" />
                    中风险要点
                </div>
                <button
                    v-for="h in summary!.highlights!.medium"
                    :key="h.riskId"
                    :data-riskid="h.riskId"
                    class="block w-full text-left text-xs px-1.5 py-1 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                    @click="emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.low.length" class="space-y-1">
                <div class="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Info class="size-3" />
                    低风险要点
                </div>
                <button
                    v-for="h in summary!.highlights!.low"
                    :key="h.riskId"
                    :data-riskid="h.riskId"
                    class="block w-full text-left text-xs px-1.5 py-1 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                    @click="emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
        </template>

        <!-- 总评 -->
        <div
            v-if="overall"
            class="text-xs leading-relaxed rounded-md border-l-4 border-primary bg-primary/5 dark:bg-primary/10 px-2.5 py-2 text-foreground"
        >
            <span class="font-semibold text-primary">总评：</span>{{ overall }}
        </div>
    </div>
</template>
