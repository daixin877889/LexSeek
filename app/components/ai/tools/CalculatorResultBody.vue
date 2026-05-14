<template>
    <div class="space-y-3">
        <!-- calculate_compensation: workInjury / trafficAccident / death 3 分支 -->
        <template v-if="toolName === 'calculate_compensation'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>赔偿类型</span>
                    <span class="font-medium">{{ compensationTypeText }}</span>
                </div>

                <!-- workInjury 分支字段 -->
                <template v-if="input.type === 'workInjury'">
                    <div class="flex justify-between text-sm"><span>月工资</span><span>{{ fmt(input.salary) }}</span></div>
                    <div class="flex justify-between text-sm"><span>伤残等级</span><span>{{ input.disabilityLevel }} 级</span></div>
                    <div class="flex justify-between text-sm"><span>一次性伤残补助金</span><span>{{ fmt(output.disabilityCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>医疗费用</span><span>{{ fmt(output.medicalExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>护理费用</span><span>{{ fmt(output.nursingExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>营养费用</span><span>{{ fmt(output.nutritionExpenses) }}</span></div>
                </template>

                <!-- trafficAccident 分支字段 -->
                <template v-else-if="input.type === 'trafficAccident'">
                    <div class="flex justify-between text-sm"><span>医疗费用</span><span>{{ fmt(output.medicalExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>伤残赔偿金</span><span>{{ fmt(output.disabilityCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>护理费用</span><span>{{ fmt(output.nursingExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>误工费</span><span>{{ fmt(output.lostIncome) }}</span></div>
                    <div class="flex justify-between text-sm"><span>交通费</span><span>{{ fmt(output.transportationExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>财产损失</span><span>{{ fmt(output.propertyLoss) }}</span></div>
                </template>

                <!-- death 分支字段 -->
                <template v-else-if="input.type === 'death'">
                    <div class="flex justify-between text-sm"><span>年收入</span><span>{{ fmt(input.annualIncome) }}</span></div>
                    <div class="flex justify-between text-sm"><span>死亡赔偿金</span><span>{{ fmt(output.deathCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>丧葬费</span><span>{{ fmt(output.funeralExpenses) }}</span></div>
                    <div class="flex justify-between text-sm"><span>被抚养人生活费</span><span>{{ fmt(output.dependentCompensation) }}</span></div>
                    <div class="flex justify-between text-sm"><span>精神损害</span><span>{{ fmt(output.emotionalDamages) }}</span></div>
                </template>

                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">赔偿总额</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.totalCompensation) }}</span>
                </div>
            </div>
        </template>

        <!-- TODO PR-B-T10 时补 9 个工具的 v-else-if 分支 -->

        <!-- 计算明细 Accordion -->
        <Accordion v-if="Array.isArray(output.details) && output.details.length > 0"
                   type="single" collapsible class="w-full" default-value="details">
            <AccordionItem value="details">
                <AccordionTrigger>计算明细</AccordionTrigger>
                <AccordionContent>
                    <ul class="text-sm space-y-1 list-disc pl-5">
                        <li v-for="(line, i) in (output.details as string[])" :key="i">{{ line }}</li>
                    </ul>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '~/components/ui/accordion'

const props = defineProps<{
    toolName: string
    input: Record<string, any>
    output: Record<string, any>
}>()

function fmt(n: unknown): string {
    if (typeof n !== 'number') return '—'
    return `¥ ${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

const compensationTypeText = computed(() => {
    const m: Record<string, string> = {
        workInjury: '工伤赔偿',
        trafficAccident: '交通事故',
        death: '死亡赔偿',
    }
    return m[props.input.type as string] ?? '—'
})
</script>
