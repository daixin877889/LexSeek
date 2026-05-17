<script setup lang="ts">
/**
 * 合同分档总览区
 *
 * 展示内容：
 * - conic-gradient 仪表盘 + 加权风险分 + 定性标签
 * - 三色计数卡（高/中/低）——纯展示不可点（spec 入口 1+2+4，未选入口 3）
 * - 分档要点（highlights 非空时显示，每条 button 化，emit focusRisk）
 * - 清单对照（playbookSnapshot 非空时显示，命中/未命中折叠）
 * - 总评文字
 *
 * highlights 为 null 时降级为仅显示仪表盘 + 计数 + 总评。
 *
 * **Feature: contract-review-m6-1 Task 3.3**
 * **Feature: contract-review-playbook (M7) Task 2.5**
 */
import { TriangleAlert, Info, ClipboardList, ChevronDown } from 'lucide-vue-next'
import { toRef } from 'vue'
import type { Risk, ContractOverview, PlaybookSnapshot } from '#shared/types/contract'
import { useContractPlaybookMatch } from '~/composables/useContractPlaybookMatch'
import { useContractOverview } from '~/composables/useContractOverview'

const props = defineProps<{
    risks: Risk[]
    summary: ContractOverview | null
    playbookSnapshot: PlaybookSnapshot | null
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

/** 清单对照 */
const playbookMatch = useContractPlaybookMatch(
    toRef(props, 'playbookSnapshot'),
    toRef(props, 'risks') as ReturnType<typeof toRef<typeof props, 'risks'>>,
)
const missesExpanded = ref(false)
</script>

<template>
    <div class="p-3 bg-muted/40 flex flex-col gap-3">
        <!-- 仪表盘 + 定性标签 -->
        <div class="flex items-center gap-3">
            <div
                class="relative size-16 shrink-0 rounded-full flex items-center justify-center"
                :style="{ background: `conic-gradient(#dc2626 0deg ${arcDeg}deg, var(--muted) ${arcDeg}deg 360deg)` }"
            >
                <div class="absolute inset-[7px] bg-card rounded-full flex items-center justify-center text-lg font-bold">
                    {{ score }}
                </div>
            </div>
            <div class="text-xs">
                <div class="text-[13px] font-semibold text-red-700 dark:text-red-300">合同风险分 {{ score }}/100</div>
                <div class="text-muted-foreground mt-0.5">{{ scoreLabel }}</div>
            </div>
        </div>

        <!-- 三色计数卡（只读，不可点；用 div 而非 button） -->
        <div class="grid grid-cols-3 gap-1.5">
            <div class="rounded-md px-1 py-1.5 text-center bg-red-600/10 text-red-700 dark:text-red-300" data-count="high">
                <div class="text-[17px] font-bold leading-none">{{ counts.high }}</div>
                <div class="text-[11px] mt-0.5">高</div>
            </div>
            <div class="rounded-md px-1 py-1.5 text-center bg-amber-600/12 text-amber-700 dark:text-amber-300" data-count="medium">
                <div class="text-[17px] font-bold leading-none">{{ counts.medium }}</div>
                <div class="text-[11px] mt-0.5">中</div>
            </div>
            <div class="rounded-md px-1 py-1.5 text-center bg-slate-500/12 text-slate-600 dark:text-slate-300" data-count="low">
                <div class="text-[17px] font-bold leading-none">{{ counts.low }}</div>
                <div class="text-[11px] mt-0.5">低</div>
            </div>
        </div>

        <!-- 分档要点（仅 highlights 非空时显示） -->
        <template v-if="hasHighlights">
            <div v-if="summary!.highlights!.high.length" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 text-[11.5px] font-semibold text-red-700 dark:text-red-300">
                    <TriangleAlert class="size-3" />
                    高风险要点
                </div>
                <button
                    v-for="(h, i) in summary!.highlights!.high"
                    :key="h.riskId || `no-id-${i}`"
                    :data-riskid="h.riskId"
                    :disabled="!h.riskId"
                    :class="[
                        'block w-full text-left text-[11.5px] px-1.5 py-1 rounded-md transition-colors',
                        h.riskId
                            ? 'text-foreground/75 hover:bg-primary/8'
                            : 'cursor-default text-muted-foreground',
                    ]"
                    :title="!h.riskId ? '该要点缺少关联风险编号，无法跳转' : undefined"
                    @click="h.riskId && emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.medium.length" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <TriangleAlert class="size-3" />
                    中风险要点
                </div>
                <button
                    v-for="(h, i) in summary!.highlights!.medium"
                    :key="h.riskId || `no-id-${i}`"
                    :data-riskid="h.riskId"
                    :disabled="!h.riskId"
                    :class="[
                        'block w-full text-left text-[11.5px] px-1.5 py-1 rounded-md transition-colors',
                        h.riskId
                            ? 'text-foreground/75 hover:bg-primary/8'
                            : 'cursor-default text-muted-foreground',
                    ]"
                    :title="!h.riskId ? '该要点缺少关联风险编号，无法跳转' : undefined"
                    @click="h.riskId && emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
            <div v-if="summary!.highlights!.low.length" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
                    <Info class="size-3" />
                    低风险要点
                </div>
                <button
                    v-for="(h, i) in summary!.highlights!.low"
                    :key="h.riskId || `no-id-${i}`"
                    :data-riskid="h.riskId"
                    :disabled="!h.riskId"
                    :class="[
                        'block w-full text-left text-[11.5px] px-1.5 py-1 rounded-md transition-colors',
                        h.riskId
                            ? 'text-foreground/75 hover:bg-primary/8'
                            : 'cursor-default text-muted-foreground',
                    ]"
                    :title="!h.riskId ? '该要点缺少关联风险编号，无法跳转' : undefined"
                    @click="h.riskId && emit('focusRisk', h.riskId)"
                >· {{ h.text }}</button>
            </div>
        </template>

        <!-- 清单对照（仅 playbookMatch.enabled 时显示） -->
        <div
            v-if="playbookMatch.enabled.value"
            class="rounded-md border bg-background px-2.5 py-2 flex flex-col gap-1.5"
        >
            <div class="flex items-center gap-1.5 text-xs font-semibold">
                <ClipboardList class="size-3.5" />
                <span>审查清单 · {{ playbookSnapshot!.contractType }}</span>
                <span class="ml-auto text-[11px] font-normal text-muted-foreground">
                    命中 {{ playbookMatch.hitCount.value }} / {{ playbookMatch.total.value }}
                </span>
            </div>

            <!-- 命中项 -->
            <div v-if="playbookMatch.hits.value.length" class="flex flex-col gap-0.5">
                <button
                    v-for="h in playbookMatch.hits.value"
                    :key="h.point.code"
                    :data-riskid="h.risk.id"
                    class="block w-full text-left text-[11.5px] px-1.5 py-1 rounded-md hover:bg-primary/8 transition-colors"
                    @click="emit('focusRisk', h.risk.id)"
                >
                    <TriangleAlert class="inline size-3 text-red-600 dark:text-red-300 mr-1 -mt-0.5" />
                    <span class="font-medium">{{ h.point.title }}</span>
                    <span class="text-muted-foreground ml-1">（{{ h.point.defaultLevel === 'high' ? '高' : h.point.defaultLevel === 'medium' ? '中' : '低' }}）</span>
                </button>
            </div>

            <!-- 未命中项 -->
            <div v-if="playbookMatch.misses.value.length" class="border-t pt-1.5">
                <button
                    class="w-full flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
                    @click="missesExpanded = !missesExpanded"
                >
                    <ChevronDown class="size-3 transition-transform" :class="{ 'rotate-180': missesExpanded }" />
                    <span>未命中 {{ playbookMatch.misses.value.length }} 条</span>
                </button>
                <div v-if="missesExpanded" class="mt-1 pl-4 flex flex-col gap-0.5">
                    <div
                        v-for="p in playbookMatch.misses.value"
                        :key="p.code"
                        class="text-[11.5px] text-muted-foreground"
                    >
                        · {{ p.title }}
                    </div>
                </div>
            </div>
        </div>

        <!-- 总评 -->
        <div
            v-if="overall"
            class="text-xs leading-relaxed rounded-r-md border-l-[3px] border-primary bg-primary/5 px-2.5 py-2 text-foreground"
        >
            <span class="font-semibold text-primary">总评：</span>{{ overall }}
        </div>
    </div>
</template>
