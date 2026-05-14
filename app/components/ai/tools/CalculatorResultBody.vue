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

        <!-- calculate_interest: 利息计算（LPR / 央行基准 / 自定义） -->
        <template v-else-if="toolName === 'calculate_interest'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>计息时间</span>
                    <span>{{ output.startDate }} 至 {{ output.endDate }}</span>
                </div>
                <div class="flex justify-between text-sm"><span>计息天数</span><span>{{ output.days }} 天</span></div>
                <div class="flex justify-between text-sm"><span>本金</span><span>{{ fmt(output.amount) }}</span></div>
                <div class="flex justify-between text-sm"><span>利息</span><span>{{ fmt(output.totalInterest) }}</span></div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">本息合计</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.total) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_delay_interest: 迟延履行利息 -->
        <template v-else-if="toolName === 'calculate_delay_interest'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>计息时间</span>
                    <span>{{ output.startDate }} 至 {{ output.endDate }}</span>
                </div>
                <div class="flex justify-between text-sm"><span>计息天数</span><span>{{ output.days }} 天</span></div>
                <div class="flex justify-between text-sm"><span>本金</span><span>{{ fmt(output.amount) }}</span></div>
                <div class="flex justify-between text-sm"><span>迟延履行利息</span><span>{{ fmt(output.totalInterest) }}</span></div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">本息合计</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.total) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_court_fee: 诉讼费 -->
        <template v-else-if="toolName === 'calculate_court_fee'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div v-if="input.amount" class="flex justify-between text-sm">
                    <span>争议金额</span>
                    <span>{{ fmt(input.amount) }}</span>
                </div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">应缴诉讼费用</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.totalFee) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_lawyer_fee: 律师费 -->
        <template v-else-if="toolName === 'calculate_lawyer_fee'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>案件类型</span>
                    <span>{{ lawyerCaseTypeText }}</span>
                </div>
                <div v-if="input.disputeAmount" class="flex justify-between text-sm">
                    <span>争议金额</span>
                    <span>{{ fmt(input.disputeAmount) }}</span>
                </div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">律师费用</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.fee) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_overtime_pay: 加班费 -->
        <template v-else-if="toolName === 'calculate_overtime_pay'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>月基本工资</span>
                    <span>{{ fmt(input.baseSalary) }}</span>
                </div>
                <div v-if="Number(output.workdayOvertimePay) > 0" class="flex justify-between text-sm">
                    <span>工作日加班费（×1.5）</span>
                    <span>{{ fmt(Number(output.workdayOvertimePay)) }}</span>
                </div>
                <div v-if="Number(output.weekendOvertimePay) > 0" class="flex justify-between text-sm">
                    <span>休息日加班费（×2）</span>
                    <span>{{ fmt(Number(output.weekendOvertimePay)) }}</span>
                </div>
                <div v-if="Number(output.holidayOvertimePay) > 0" class="flex justify-between text-sm">
                    <span>节假日加班费（×3）</span>
                    <span>{{ fmt(Number(output.holidayOvertimePay)) }}</span>
                </div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">总加班费</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(Number(output.totalOvertimePay)) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_social_insurance_backpay: 社保追缴 -->
        <template v-else-if="toolName === 'calculate_social_insurance_backpay'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>月工资基数</span>
                    <span>{{ fmt(input.monthlySalary) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span>追缴月数</span>
                    <span>{{ input.months }} 个月</span>
                </div>
                <div v-if="output.employeePart" class="flex justify-between text-sm">
                    <span>个人缴纳部分</span>
                    <span>{{ fmt(output.employeePart.total) }}</span>
                </div>
                <div v-if="output.employerPart" class="flex justify-between text-sm">
                    <span>单位缴纳部分</span>
                    <span>{{ fmt(output.employerPart.total) }}</span>
                </div>
                <div class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">追缴总额</span>
                    <span class="font-semibold text-primary text-lg">{{ fmt(output.totalBackpay) }}</span>
                </div>
            </div>
        </template>

        <!-- calculate_divorce_property: 离婚财产分割（4个 Accordion） -->
        <template v-else-if="toolName === 'calculate_divorce_property'">
            <Accordion type="multiple" class="w-full" :default-value="['overview', 'distribution']">
                <AccordionItem value="overview">
                    <AccordionTrigger>财产概览</AccordionTrigger>
                    <AccordionContent>
                        <div class="space-y-2 pt-1">
                            <div class="flex justify-between text-sm">
                                <span>共同财产总额</span>
                                <span>{{ fmt(output.totalAssets) }}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span>共同债务总额</span>
                                <span>{{ fmt(output.totalDebts) }}</span>
                            </div>
                            <div class="flex justify-between text-sm font-semibold">
                                <span>净资产</span>
                                <span class="text-primary">{{ fmt(output.netAssets) }}</span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="distribution">
                    <AccordionTrigger>分割结果</AccordionTrigger>
                    <AccordionContent>
                        <div class="space-y-2 pt-1">
                            <div class="flex justify-between text-sm">
                                <span>丈夫分得比例</span>
                                <span>{{ ((Number(input.husbandRatio) || 0.5) * 100).toFixed(0) }}%</span>
                            </div>
                            <div class="flex justify-between text-sm font-semibold">
                                <span>丈夫分得金额</span>
                                <span>{{ fmt(output.husbandNetAssets) }}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span>妻子分得比例</span>
                                <span>{{ ((Number(input.wifeRatio) || 0.5) * 100).toFixed(0) }}%</span>
                            </div>
                            <div class="flex justify-between text-sm font-semibold">
                                <span>妻子分得金额</span>
                                <span>{{ fmt(output.wifeNetAssets) }}</span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem v-if="output.childSupportAmount > 0" value="child-support">
                    <AccordionTrigger>子女抚养</AccordionTrigger>
                    <AccordionContent>
                        <div class="space-y-2 pt-1">
                            <div class="flex justify-between text-sm">
                                <span>子女抚养费</span>
                                <span>{{ fmt(output.childSupportAmount) }}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span>支付方</span>
                                <span>{{ output.childSupportPayer }}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span>接收方</span>
                                <span>{{ output.childSupportReceiver }}</span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </template>

        <!-- calculate_date: 法律日期计算 -->
        <template v-else-if="toolName === 'calculate_date'">
            <div class="rounded-md bg-muted/50 p-4 space-y-2">
                <div class="flex justify-between text-sm">
                    <span>起始日期</span>
                    <span>{{ output.startDate }}</span>
                </div>
                <div v-if="output.endDate" class="flex justify-between text-sm">
                    <span>结束日期</span>
                    <span>{{ output.endDate }}</span>
                </div>
                <div v-if="output.details && typeof output.details === 'string'"
                     class="text-sm text-muted-foreground">{{ output.details }}</div>
                <div v-if="output.resultDate" class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">结果日期</span>
                    <span class="font-semibold text-primary">{{ output.resultDate }}</span>
                </div>
                <div v-if="output.workingDays !== undefined" class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">工作日天数</span>
                    <span class="font-semibold text-primary">{{ output.workingDays }} 天</span>
                </div>
                <div v-if="output.days !== undefined && output.resultDate === undefined && output.workingDays === undefined"
                     class="flex justify-between border-t pt-2 mt-2">
                    <span class="font-semibold">天数</span>
                    <span class="font-semibold text-primary">{{ output.days }} 天</span>
                </div>
            </div>
        </template>

        <!-- query_bank_rate: 银行利率查询（按 queryType 显示对应表，不用 Tab） -->
        <template v-else-if="toolName === 'query_bank_rate'">
            <!-- lpr -->
            <template v-if="input.queryType === 'lpr' && output.date">
                <div class="rounded-md bg-muted/50 p-4 space-y-2">
                    <div class="flex justify-between text-sm font-medium">
                        <span>LPR贷款市场报价利率</span>
                        <span class="text-xs text-muted-foreground">{{ output.date }}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>1年期</span>
                        <span class="font-semibold">{{ output.oneYear }}%</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span>5年期以上</span>
                        <span class="font-semibold">{{ output.fiveYear }}%</span>
                    </div>
                </div>
            </template>
            <!-- deposit -->
            <template v-else-if="input.queryType === 'deposit' && output.date">
                <div class="rounded-md bg-muted/50 p-4 space-y-2">
                    <div class="flex justify-between text-sm font-medium">
                        <span>存款基准利率</span>
                        <span class="text-xs text-muted-foreground">{{ output.date }}</span>
                    </div>
                    <div class="flex justify-between text-sm"><span>活期</span><span>{{ output.demand }}%</span></div>
                    <div class="flex justify-between text-sm"><span>3个月</span><span>{{ output.threeMonths }}%</span></div>
                    <div class="flex justify-between text-sm"><span>6个月</span><span>{{ output.sixMonths }}%</span></div>
                    <div class="flex justify-between text-sm"><span>1年</span><span>{{ output.oneYear }}%</span></div>
                    <div class="flex justify-between text-sm"><span>2年</span><span>{{ output.twoYear }}%</span></div>
                    <div class="flex justify-between text-sm"><span>3年</span><span>{{ output.threeYear }}%</span></div>
                    <div class="flex justify-between text-sm"><span>5年</span><span>{{ output.fiveYear }}%</span></div>
                </div>
            </template>
            <!-- loan -->
            <template v-else-if="input.queryType === 'loan' && output.date">
                <div class="rounded-md bg-muted/50 p-4 space-y-2">
                    <div class="flex justify-between text-sm font-medium">
                        <span>贷款基准利率</span>
                        <span class="text-xs text-muted-foreground">{{ output.date }}</span>
                    </div>
                    <div class="flex justify-between text-sm"><span>6个月以内</span><span>{{ output.sixMonths }}%</span></div>
                    <div class="flex justify-between text-sm"><span>1年</span><span>{{ output.oneYear }}%</span></div>
                    <div class="flex justify-between text-sm"><span>1-5年</span><span>{{ output.oneToFiveYear }}%</span></div>
                    <div class="flex justify-between text-sm"><span>5年以上</span><span>{{ output.fiveYear }}%</span></div>
                </div>
            </template>
            <!-- all: 显示三组最新利率 -->
            <template v-else-if="input.queryType === 'all'">
                <div class="space-y-3">
                    <div v-if="output.lpr" class="rounded-md bg-muted/50 p-3 space-y-1">
                        <div class="text-xs font-medium text-muted-foreground mb-1">
                            LPR（{{ output.lpr.date }}）
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>1年期</span>
                            <span class="font-semibold">{{ output.lpr.oneYear }}%</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>5年期以上</span>
                            <span class="font-semibold">{{ output.lpr.fiveYear }}%</span>
                        </div>
                    </div>
                    <div v-if="output.loanRate" class="rounded-md bg-muted/50 p-3 space-y-1">
                        <div class="text-xs font-medium text-muted-foreground mb-1">
                            贷款基准（{{ output.loanRate.date }}）
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>1年</span>
                            <span>{{ output.loanRate.oneYear }}%</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>5年以上</span>
                            <span>{{ output.loanRate.fiveYear }}%</span>
                        </div>
                    </div>
                    <div v-if="output.depositRate" class="rounded-md bg-muted/50 p-3 space-y-1">
                        <div class="text-xs font-medium text-muted-foreground mb-1">
                            存款基准（{{ output.depositRate.date }}）
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>活期</span>
                            <span>{{ output.depositRate.demand }}%</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span>1年</span>
                            <span>{{ output.depositRate.oneYear }}%</span>
                        </div>
                    </div>
                </div>
            </template>
        </template>

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

const lawyerCaseTypeText = computed(() => {
    const m: Record<string, string> = {
        civil: '民事案件',
        criminal: '刑事案件',
        administrative: '行政案件',
        commercial: '商事案件',
        consultation: '法律咨询',
        document: '文书制作',
    }
    return m[props.input.caseType as string] ?? '—'
})
</script>
