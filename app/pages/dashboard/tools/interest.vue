<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">利息计算器</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <HelpIcon class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">利息计算器说明</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <CloseIcon class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">利息计算类型说明：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li><strong>自定义利率</strong>：使用自定义的固定利率计算</li>
                <li><strong>LPR利率</strong>：基于贷款市场报价利率(LPR)计算</li>
                <li><strong>基准利率</strong>：基于中国人民银行同期贷款基准利率计算</li>
                <li><strong>基准利率与LPR自动分段</strong>：根据日期自动选择基准利率或LPR计算</li>
              </ul>
            </div>

            <div class="bg-destructive/10 p-2 rounded text-destructive">
              <p><strong>注意：</strong>LPR和基准利率会根据日期自动采用对应时期的利率标准，如遇到利率调整，会自动分段计算。自动分段选项将根据2019年8月20日的LPR推出日期作为分界点。</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row gap-6">
      <!-- 左侧：信息输入区 -->
      <div class="w-full lg:w-5/12">
        <Card class="mb-6 shadow-none border">
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div>
                <label class="text-sm font-medium leading-none">计算方式</label>
                <Select v-model="calculationType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择计算方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">自定义利率</SelectItem>
                    <SelectItem value="lpr">全国银行间同业拆借中心公布的贷款市场报价利率(LPR)</SelectItem>
                    <SelectItem value="pboc">中国人民银行同期贷款基准利率</SelectItem>
                    <SelectItem value="auto">中国人民银行同期贷款基准利率与LPR自动分段</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">本金（元）</label>
                <Input type="number" v-model="principal" placeholder="请输入本金金额" class="mt-1.5"
                  @input="convertToChinese" />
                <p v-if="chineseAmount" class="text-xs text-muted-foreground mt-1">大写：{{ chineseAmount }}</p>
              </div>

              <!-- 自定义利率选项 -->
              <div v-if="calculationType === 'custom'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">年利率（%）</label>
                  <Input type="number" v-model="customRate" step="0.01" placeholder="请输入年利率" class="mt-1.5" />
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">利率周期</label>
                  <Select v-model="rateCalculationCycle" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择利率周期" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="年">年</SelectItem>
                      <SelectItem value="月">月</SelectItem>
                      <SelectItem value="日">日</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <!-- LPR利率选项 -->
              <div v-if="calculationType === 'lpr' || calculationType === 'auto'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none mb-1.5 block">LPR期限</label>
                  <RadioGroup v-model="lprPeriod">
                    <div class="flex items-center space-x-4">
                      <div class="flex items-center space-x-2">
                        <RadioGroupItem value="1" id="lpr1y" />
                        <label for="lpr1y" class="text-sm leading-none">1年期</label>
                      </div>
                      <div class="flex items-center space-x-2">
                        <RadioGroupItem value="2" id="lpr5y" />
                        <label for="lpr5y" class="text-sm leading-none">5年期以上</label>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                <div v-if="calculationType === 'lpr'">
                  <label class="text-sm font-medium leading-none">LPR计算方式</label>
                  <Select v-model="lprCalculationMethod" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择LPR计算方式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="分段利率">分段利率</SelectItem>
                      <SelectItem value="指定LPR">指定LPR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div v-if="lprCalculationMethod === '指定LPR' && calculationType === 'lpr'">
                  <label class="text-sm font-medium leading-none">指定LPR日期</label>
                  <Select v-model="designatedLprDate" class="mt-1.5" @update:modelValue="updateDesignatedLprRate">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择LPR日期" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="date in designatedLprTable" :key="date" :value="date">
                        {{ date }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Alert v-if="designatedLprRate" variant="info" class="mt-2 p-2 block">
                    <p class="text-xs">
                      当前指定LPR利率: <strong>{{ designatedLprRate }}%</strong>
                    </p>
                  </Alert>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-medium leading-none">LPR调整方式</label>
                    <Select v-model="lprAdjustmentMethod" class="mt-1.5">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择调整方式" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="无">无调整</SelectItem>
                        <SelectItem value="加点">加点</SelectItem>
                        <SelectItem value="减点">减点</SelectItem>
                        <SelectItem value="倍率">倍率</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div v-if="lprAdjustmentMethod !== '无'">
                    <label class="text-sm font-medium leading-none">
                      {{ lprAdjustmentMethod === "倍率" ? "调整倍率" : "调整值（BP）" }}
                    </label>
                    <Input type="number" v-model="lprAdjustmentValue"
                      :placeholder="lprAdjustmentMethod === '倍率' ? '输入倍率，如1.1' : '输入基点数，1BP=0.01%'" class="mt-1.5" />
                    <p class="text-xs text-muted-foreground mt-1">
                      {{ lprAdjustmentMethod === "倍率" ? "例如：1.1表示按利率的1.1倍计算" : "1个基点(BP)=0.01%，例如加20BP相当于+0.2%" }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- 基准利率选项 -->
              <div v-if="calculationType === 'pboc' || calculationType === 'auto'" class="space-y-4">
                <div v-if="calculationType === 'pboc'">
                  <label class="text-sm font-medium leading-none">基准利率计算方式</label>
                  <Select v-model="pbocCalculationMethod" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择基准利率计算方式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="分段利率">分段利率</SelectItem>
                      <SelectItem value="指定利率">指定利率</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div v-if="pbocCalculationMethod === '指定利率' && calculationType === 'pboc'">
                  <label class="text-sm font-medium leading-none">指定利率日期</label>
                  <Select v-model="designatedPbocDate" class="mt-1.5" @update:modelValue="updateDesignatedPbocRate">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择基准利率日期" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="date in designatedPbocTable" :key="date" :value="date">
                        {{ date }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Alert v-if="designatedPbocRate" variant="info" class="mt-2 p-2 block">
                    <p class="text-xs">
                      当前指定基准利率: <strong>{{ designatedPbocRate }}%</strong>
                    </p>
                  </Alert>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-medium leading-none">基准利率调整方式</label>
                    <Select v-model="pbocAdjustmentMethod" class="mt-1.5">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择调整方式" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="无">无调整</SelectItem>
                        <SelectItem value="上浮">上浮</SelectItem>
                        <SelectItem value="下浮">下浮</SelectItem>
                        <SelectItem value="倍率">倍率</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div v-if="pbocAdjustmentMethod !== '无'">
                    <label class="text-sm font-medium leading-none">
                      {{ pbocAdjustmentMethod === "倍率" ? "调整倍率" : "调整比例（%）" }}
                    </label>
                    <Input type="number" v-model="pbocAdjustmentValue"
                      :placeholder="pbocAdjustmentMethod === '倍率' ? '输入倍率，如1.1' : '输入百分比'" class="mt-1.5" />
                    <p class="text-xs text-muted-foreground mt-1">
                      {{ pbocAdjustmentMethod === "倍率" ? "例如：1.1表示按利率的1.1倍计算" : "例如：上浮10%表示按基准利率的1.1倍计算" }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- 日期选择 -->
              <div>
                <label class="text-sm font-medium leading-none">计息开始日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="startDate" class="w-full pl-10"
                      @update:modelValue="autoSelectPeriods" />
                  </div>
                </div>
                <p v-if="startDate && new Date(startDate) < new Date('2014-01-01')"
                  class="text-xs text-yellow-500 mt-1">
                  <AlertTriangleIcon class="h-3 w-3 inline-block mr-1" />您选择的日期较早，请确认是否需要从这个日期开始计算。
                </p>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">计息结束日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="endDate" class="w-full pl-10" @update:modelValue="autoSelectPeriods" />
                  </div>
                </div>
                <p v-if="endDate && new Date(endDate) > new Date(new Date().setFullYear(new Date().getFullYear() + 3))"
                  class="text-xs text-yellow-500 mt-1">
                  <AlertTriangleIcon class="h-3 w-3 inline-block mr-1" />您选择的结束日期较远，系统将使用最新利率进行估算。
                </p>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">一年天数</label>
                <Select v-model="yearDays" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择一年天数" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="365">365天</SelectItem>
                    <SelectItem :value="360">360天</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="pt-4">
                <Button class="w-full" @click="calculateInterest">计算利息</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：结果显示区域 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border mb-6">
          <CardHeader>
            <div class="flex justify-between items-center">
              <CardTitle>计算结果</CardTitle>
              <Button variant="outline" @click="exportToExcel" class="flex items-center gap-1">
                <span>导出Excel</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <!-- 计算说明提示 -->
            <Alert v-if="result.pbocResult && result.lprResult" class="mb-4 block">
              <p class="mb-1">
                <strong>计算说明：</strong>本次计算从<strong>{{ result.startDate }}</strong>开始，跨越LPR实施日期(2019-08-20)，系统自动分段计算：
              </p>
              <ul class="list-disc list-inside space-y-1 pl-2">
                <li>
                  第一阶段：<strong>{{ result.pbocResult.startDate }}</strong> 至 {{ result.pbocResult.endDate }}，使用中国人民银行基准利率
                </li>
                <li>第二阶段：{{ result.lprResult.startDate }} 至 {{ result.lprResult.endDate }}，使用LPR利率</li>
              </ul>
              <p class="text-xs text-muted-foreground mt-1">注：计算结果已包含所有历史利率调整</p>
            </Alert>

            <Alert v-else-if="calculationType === 'custom'" class="mb-4 block">
              <p>
                <strong>计算说明：</strong>本次使用自定义利率({{ customRate }}%)计算 <strong>{{ result.startDate }}</strong> 至 {{
                result.endDate }} 期间的利息
              </p>
            </Alert>

            <Alert v-else-if="calculationType === 'pboc'" class="mb-4 block">
              <p>
                <strong>计算说明：</strong>本次使用中国人民银行基准利率计算 <strong>{{ result.startDate }}</strong> 至 {{ result.endDate }}
                期间的利息
              </p>
              <p class="text-xs text-muted-foreground mt-1">注：利率数据包含2012年至今的所有基准利率变动</p>
            </Alert>

            <Alert v-else-if="calculationType === 'lpr'" class="mb-4 block">
              <p>
                <strong>计算说明：</strong>本次使用LPR利率计算 <strong>{{ result.startDate }}</strong> 至 {{ result.endDate }} 期间的利息
              </p>
              <p class="text-xs text-muted-foreground mt-1">注：LPR利率自2019年8月20日开始实施</p>
            </Alert>

            <!-- 结果概览 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <span>本金:</span>
                  <span class="font-semibold">{{ formatCurrency(result.amount) }} 元</span>
                </div>
                <div class="flex justify-between items-center">
                  <span>利息:</span>
                  <span class="font-semibold">{{ formatCurrency(result.totalInterest) }} 元</span>
                </div>
                <div class="flex justify-between items-center">
                  <span>本息合计:</span>
                  <span class="font-semibold">{{ formatCurrency(result.total) }} 元</span>
                </div>
              </div>
              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <span>计息时间:</span>
                  <span>{{ result.startDate }} 至 {{ result.endDate }}</span>
                </div>
                <div class="flex justify-between items-center">
                  <span>计息天数:</span>
                  <span>{{ result.days }} 天</span>
                </div>
              </div>
            </div>

            <!-- 跨越LPR实施日期的分段显示 -->
            <div v-if="result.pbocResult && result.lprResult" class="space-y-4">
              <Accordion type="single" collapsible class="w-full">
                <!-- 第一阶段：基准利率 -->
                <AccordionItem value="pboc-stage">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">第一阶段：人民银行基准利率 ({{ result.pbocResult.startDate }} 至 {{
                      result.pbocResult.endDate }})</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="overflow-x-auto">
                      <table class="w-full border-collapse">
                        <thead>
                          <tr class="bg-muted/50">
                            <th class="p-2 text-left border">计息区间</th>
                            <th class="p-2 text-left border">适用利率</th>
                            <th class="p-2 text-left border">计息天数</th>
                            <th class="p-2 text-left border">利息金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(detail, index) in mergeDetailsByRate(result.pbocResult.interestDetails)"
                            :key="'pboc-' + index" class="border-b hover:bg-muted/20">
                            <td class="p-2 border">{{ detail.startDate }} 至 {{ detail.endDate }}</td>
                            <td class="p-2 border">{{ detail.adjustedRate ? detail.adjustedRate.toFixed(2) :
                              detail.rate.toFixed(2) }}%</td>
                            <td class="p-2 border">{{ detail.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(detail.interest) }}元</td>
                          </tr>
                          <tr class="font-semibold bg-primary/10">
                            <td class="p-2 border" colspan="2">第一阶段合计</td>
                            <td class="p-2 border">{{ result.pbocResult.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(result.pbocResult.totalInterest) }}元</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <!-- 第二阶段：LPR利率 -->
                <AccordionItem value="lpr-stage">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">第二阶段：LPR利率 ({{ result.lprResult.startDate }} 至 {{
                      result.lprResult.endDate }})</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="overflow-x-auto">
                      <table class="w-full border-collapse">
                        <thead>
                          <tr class="bg-muted/50">
                            <th class="p-2 text-left border">计息区间</th>
                            <th class="p-2 text-left border">适用利率</th>
                            <th class="p-2 text-left border">计息天数</th>
                            <th class="p-2 text-left border">利息金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(detail, index) in mergeDetailsByRate(result.lprResult.interestDetails)"
                            :key="'lpr-' + index" class="border-b hover:bg-muted/20">
                            <td class="p-2 border">{{ detail.startDate }} 至 {{ detail.endDate }}</td>
                            <td class="p-2 border">{{ detail.adjustedRate ? detail.adjustedRate.toFixed(2) :
                              detail.rate.toFixed(2) }}%</td>
                            <td class="p-2 border">{{ detail.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(detail.interest) }}元</td>
                          </tr>
                          <tr class="font-semibold bg-primary/10">
                            <td class="p-2 border" colspan="2">第二阶段合计</td>
                            <td class="p-2 border">{{ result.lprResult.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(result.lprResult.totalInterest) }}元</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <!-- 单一计算方法的结果显示 -->
            <div v-else class="mt-4">
              <Accordion type="single" collapsible class="w-full">
                <AccordionItem value="details">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">计息明细</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="overflow-x-auto">
                      <table class="w-full border-collapse">
                        <thead>
                          <tr class="bg-muted/50">
                            <th class="p-2 text-left border">计息区间</th>
                            <th class="p-2 text-left border">适用利率</th>
                            <th class="p-2 text-left border">计息天数</th>
                            <th class="p-2 text-left border">利息金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(detail, index) in mergeDetailsByRate(result.interestDetails)" :key="index"
                            class="border-b hover:bg-muted/20">
                            <td class="p-2 border">{{ detail.startDate }} 至 {{ detail.endDate }}</td>
                            <td class="p-2 border">{{ detail.adjustedRate ? detail.adjustedRate.toFixed(2) : detail.rate
                              }}%</td>
                            <td class="p-2 border">{{ detail.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(detail.interest) }}元</td>
                          </tr>
                          <tr class="font-semibold bg-primary/10">
                            <td class="p-2 border" colspan="2">合计</td>
                            <td class="p-2 border">{{ result.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(result.totalInterest) }}元</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <!-- 计算明细 -->
                <AccordionItem value="calculation-details" v-if="result.details || result.process">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">计算明细</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="bg-muted/30 p-4 rounded font-mono text-sm whitespace-pre-wrap wrap-break-word">
                      {{ result.details ? result.details.join("\n") : result.process }}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </CardContent>
        </Card>

        <div v-if="!result" class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
          <div class="text-center">
            <div class="text-muted-foreground mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"
                class="mx-auto mb-4 opacity-50">
                <circle cx="12" cy="12" r="10" />
                <polyline points="8 12 12 16 16 12" />
                <line x1="12" y1="8" x2="12" y2="16" />
              </svg>
              <h3 class="text-lg font-medium">计算结果将在这里显示</h3>
            </div>
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算利息"按钮查看结果</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "利息计算",
  layout: "dashboard-layout",
});
import { AlertTriangleIcon, CalendarIcon } from "lucide-vue-next";
import { calculateSimpleInterest, calculateCustomRateInterest, calculateLPRInterest, calculatePBOCInterest, getRateForDate, getInterestRates } from "#shared/utils/tools/interestService";
import { formatDate, daysBetween } from "#shared/utils/tools/utils/date";
import { exportInterestToExcel } from "#shared/utils/tools/utils/excelExport";

// 状态管理
const isHelpOpen = ref(false);
const calculationType = ref("custom");
const principal = ref(100000);
const customRate = ref(4.35);
const yearDays = ref(365);
const rateCalculationCycle = ref("年");
const chineseAmount = ref("");

// LPR相关参数
const lprPeriod = ref("1");
const lprAdjustmentMethod = ref("无");
const lprAdjustmentValue = ref(0);
const lprCalculationMethod = ref("分段利率");
const designatedLprDate = ref("2019-08-20");
const designatedLprRate = ref(null);
const designatedLprTable = ref(["2019-08-20", "2019-09-20", "2019-11-20", "2020-02-20", "2020-04-20", "2021-12-20", "2022-01-20", "2022-05-20", "2022-08-22", "2023-06-20", "2023-08-21", "2024-02-20", "2024-07-20"]);

// 基准利率相关参数
const pbocPeriod = ref("2");
const pbocAdjustmentMethod = ref("无");
const pbocAdjustmentValue = ref(0);
const pbocCalculationMethod = ref("分段利率");
const designatedPbocDate = ref("2015-10-24");
const designatedPbocRate = ref(null);
const designatedPbocTable = ref(["1991-04-21", "1993-05-15", "1993-07-11", "1995-01-01", "1995-07-01", "1996-05-01", "1996-08-23", "1997-10-23", "1998-03-25", "1998-07-01", "1998-12-07", "1999-06-10", "2002-02-21", "2004-10-29", "2006-04-28", "2006-08-19", "2007-03-18", "2007-05-19", "2007-07-21", "2007-08-22", "2007-09-15", "2007-12-21", "2008-09-16", "2008-10-09", "2008-10-30", "2008-11-27", "2008-12-23", "2010-10-20", "2010-12-26", "2011-02-09", "2011-04-06", "2011-07-07", "2012-06-08", "2012-07-06", "2014-11-22", "2015-03-01", "2015-05-11", "2015-06-28", "2015-08-26", "2015-10-24"]);

const startDate = ref(formatDate(new Date(new Date().setFullYear(new Date().getFullYear() - 1))));
const endDate = ref(formatDate(new Date()));

const result = ref(null);
const applicableLPRRate = ref(null);
const applicablePBOCRate = ref(null);

// 未来日期利率处理
const isLprFutureRate = ref(false);
const isPbocFutureRate = ref(false);
const latestLprRateDate = ref(null);
const latestPbocRateDate = ref(null);

// 计算属性
const calculationTypeText = computed(() => {
  switch (calculationType.value) {
    case "custom":
      return `自定义利率（${customRate.value}%）`;
    case "lpr":
      return `LPR利率（${lprPeriod.value === "1" ? "1年期" : "5年期以上"}）`;
    case "pboc":
      let periodText = "";
      switch (pbocPeriod.value) {
        case "1":
          periodText = "六个月以内";
          break;
        case "2":
          periodText = "六个月至一年";
          break;
        case "3":
          periodText = "一至三年";
          break;
        case "4":
          periodText = "三至五年";
          break;
        case "5":
          periodText = "五年以上";
          break;
      }
      return `中国人民银行基准利率（${periodText}）`;
    case "auto":
      return "基准利率与LPR自动分段计算";
    default:
      return "";
  }
});

// 方法
function updateApplicableRates() {
  applicableLPRRate.value = getRateForDate(2, lprPeriod.value, endDate.value);
  applicablePBOCRate.value = getRateForDate(1, pbocPeriod.value, endDate.value);

  // 检查结束日期是否为未来日期
  const today = new Date();
  const endDateObj = new Date(endDate.value);

  if (endDateObj > today) {
    // 获取最新的LPR利率日期
    const lprRates = getInterestRates(2, lprPeriod.value);
    const pbocRates = getInterestRates(1, pbocPeriod.value);

    if (lprRates.length > 0) {
      const latestLprRate = lprRates[lprRates.length - 1];
      isLprFutureRate.value = true;
      latestLprRateDate.value = latestLprRate.sTime;
    }

    if (pbocRates.length > 0) {
      const latestPbocRate = pbocRates[pbocRates.length - 1];
      isPbocFutureRate.value = true;
      latestPbocRateDate.value = latestPbocRate.sTime;
    }
  } else {
    isLprFutureRate.value = false;
    isPbocFutureRate.value = false;
  }
}

function updateDesignatedLprRate() {
  // 根据选择的LPR日期获取对应的LPR利率
  const lprRates = getInterestRates(2, lprPeriod.value);
  const selectedRate = lprRates.find((rate) => rate.sTime === designatedLprDate.value);
  if (selectedRate) {
    designatedLprRate.value = selectedRate.rate;
  }
}

function updateDesignatedPbocRate() {
  // 根据选择的基准利率日期获取对应的基准利率
  const pbocRates = getInterestRates(1, pbocPeriod.value);
  const selectedRate = pbocRates.find((rate) => rate.sTime === designatedPbocDate.value);
  if (selectedRate) {
    designatedPbocRate.value = selectedRate.rate;
  }
}

function autoSelectPeriods() {
  if (!startDate.value || !endDate.value) return;

  const start = new Date(startDate.value);
  const end = new Date(endDate.value);
  const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();

  logger.debug("日期月份差:", diffMonths);

  // 根据月份差异自动设置贷款期限
  if (diffMonths <= 6) {
    pbocPeriod.value = "1"; // 六个月以内
    lprPeriod.value = "1"; // LPR 1年期
  } else if (diffMonths <= 12) {
    pbocPeriod.value = "2"; // 六个月至一年
    lprPeriod.value = "1"; // LPR 1年期
  } else if (diffMonths <= 36) {
    pbocPeriod.value = "3"; // 一至三年
    lprPeriod.value = "2"; // LPR 5年期以上
  } else if (diffMonths <= 60) {
    pbocPeriod.value = "4"; // 三至五年
    lprPeriod.value = "2"; // LPR 5年期以上
  } else {
    pbocPeriod.value = "5"; // 五年以上
    lprPeriod.value = "2"; // LPR 5年期以上
  }

  updateApplicableRates();
}

function convertToChinese() {
  if (!principal.value) return;
  chineseAmount.value = toChineseBig(principal.value);
}

function toChineseBig(num) {
  if (num >= 1000000000000) {
    return "大于一万亿....";
  } else {
    var strNum = String(num);
    var unit = ["", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿", "拾", "佰", "仟"];
    var result = [];
    var unitNo = 0;
    var zeroCount = 0; // 记录连续的零的个数

    for (let i = strNum.length - 1; i >= 0; i--) {
      var currentNum = strNum[i];
      if (currentNum === "0") {
        zeroCount++;
      } else {
        if (zeroCount > 0) {
          result.unshift("零");
          zeroCount = 0;
        }
        result.unshift(unit[unitNo]);
        result.unshift(numToChinese(currentNum));
      }
      unitNo++;
    }

    return result
      .join("")
      .replace(/零{2,}/g, "零") // 多个连续的零替换为一个零
      .replace(/零([万亿])/g, "$1") // 零万或零亿去掉零
      .replace(/亿万/g, "亿") // 亿后面不应有万
      .replace(/零+$/g, "") // 去掉末尾的零
      .replace(/^壹拾/, "拾"); // 去掉开头的"壹拾"
  }
}

function numToChinese(n) {
  var chineseBigNum = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  return chineseBigNum[parseInt(n, 10)];
}

function createInterestResult() {
  // 确保日期存在默认值
  if (!startDate.value) {
    startDate.value = formatDate(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
  }

  if (!endDate.value) {
    endDate.value = formatDate(new Date());
  }

  // 返回基本结果结构
  return {
    amount: principal.value,
    startDate: startDate.value,
    endDate: endDate.value,
    totalInterest: 0,
    total: principal.value,
    days: 0,
    interestDetails: [],
    details: [],
  };
}

function calculateInterest() {
  if (!startDate.value || !endDate.value || !principal.value) {
    toast.showErrorToast({
      title: "输入错误",
      message: "请填写完整信息后再计算",
    });
    return;
  }

  // 注释掉自动选择期限功能，让用户手动选择保持有效
  // autoSelectPeriods();

  const principalValue = parseFloat(principal.value);
  const startDateValue = startDate.value;
  const endDateValue = endDate.value;

  // 检查日期顺序
  if (new Date(startDateValue) > new Date(endDateValue)) {
    toast.error("开始日期不能晚于结束日期");
    return;
  }

  logger.debug("计算参数:", {
    计算类型: calculationType.value,
    本金: principalValue,
    开始日期: startDateValue,
    结束日期: endDateValue,
    年天数: yearDays.value,
    LPR期限: lprPeriod.value,
    基准利率期限: pbocPeriod.value,
  });

  let calculationResult;

  switch (calculationType.value) {
    case "custom":
      calculationResult = calculateCustomRateInterest(principalValue, customRate.value, startDateValue, endDateValue, yearDays.value);
      break;

    case "pboc":
      calculationResult = calculatePBOCInterest(principalValue, startDateValue, endDateValue, pbocPeriod.value, pbocAdjustmentMethod.value, parseFloat(pbocAdjustmentValue.value), yearDays.value);
      break;

    case "lpr":
      calculationResult = calculateLPRInterest(principalValue, startDateValue, endDateValue, lprPeriod.value, lprAdjustmentMethod.value, parseFloat(lprAdjustmentValue.value), yearDays.value);
      break;

    case "auto":
      // 自动分段计算
      const start = new Date(startDateValue);
      const end = new Date(endDateValue);
      const lprStartDate = new Date("2019-08-20");

      // 确保调整值为数字
      const pbocAdjustValue = parseFloat(pbocAdjustmentValue.value || 0);
      const lprAdjustValue = parseFloat(lprAdjustmentValue.value || 0);

      logger.debug("调整值类型检查:", {
        pbocAdjustmentValue原始值: pbocAdjustmentValue.value,
        pbocAdjustmentValue类型: typeof pbocAdjustmentValue.value,
        pbocAdjustValue转换后: pbocAdjustValue,
        pbocAdjustValue类型: typeof pbocAdjustValue,
        lprAdjustmentValue原始值: lprAdjustmentValue.value,
        lprAdjustmentValue类型: typeof lprAdjustmentValue.value,
        lprAdjustValue转换后: lprAdjustValue,
        lprAdjustValue类型: typeof lprAdjustValue,
      });

      logger.debug("日期比较:", {
        start: start.toISOString(),
        end: end.toISOString(),
        lprStartDate: lprStartDate.toISOString(),
        startBeforeLpr: start < lprStartDate,
        endBeforeLpr: end < lprStartDate,
        startAfterLpr: start >= lprStartDate,
      });

      if (end < lprStartDate) {
        // 全部使用基准利率
        logger.debug("分支: 全部使用基准利率");
        calculationResult = calculatePBOCInterest(
          principalValue,
          startDateValue,
          endDateValue,
          pbocPeriod.value,
          pbocAdjustmentMethod.value,
          pbocAdjustValue, // 使用转换后的数值
          yearDays.value
        );

        logger.debug("基准利率计算结果:", calculationResult);

        // 添加防御性检查
        if (calculationResult) {
          if (!calculationResult.details) {
            calculationResult.details = [];
          }
          calculationResult.details.unshift("自动分段计算：全部使用基准利率（计算期间早于LPR实施日期2019-08-20）");
        }
      } else if (start >= lprStartDate) {
        // 全部使用LPR
        logger.debug("分支: 全部使用LPR");

        // PBOC期限到LPR期限的映射
        let mappedLprPeriod = lprPeriod.value;
        // 如果是数字形式的pbocPeriod，将3-5（一至三年、三至五年、五年以上）映射到LPR的5年期以上（2）
        if (parseInt(pbocPeriod.value) >= 3) {
          mappedLprPeriod = "2"; // 5年期以上LPR
        } else {
          mappedLprPeriod = "1"; // 1年期LPR
        }

        logger.debug("期限映射:", {
          原期限: lprPeriod.value,
          映射后期限: mappedLprPeriod,
        });

        calculationResult = calculateLPRInterest(
          principalValue,
          startDateValue,
          endDateValue,
          mappedLprPeriod, // 使用映射后的LPR期限
          lprAdjustmentMethod.value,
          lprAdjustValue, // 使用转换后的数值
          yearDays.value
        );

        logger.debug("LPR计算结果:", calculationResult);

        // 添加防御性检查
        if (calculationResult) {
          if (!calculationResult.details) {
            calculationResult.details = [];
          }
          calculationResult.details.unshift("自动分段计算：全部使用LPR利率（计算期间均在LPR实施日期2019-08-20之后）");
        }
      } else {
        // 跨越LPR实施日期，需要分段计算
        logger.debug("分支: 跨越LPR实施日期分段计算");

        // PBOC期限到LPR期限的映射
        let mappedLprPeriod = lprPeriod.value;
        // 如果是数字形式的pbocPeriod，将3-5（一至三年、三至五年、五年以上）映射到LPR的5年期以上（2）
        if (parseInt(pbocPeriod.value) >= 3) {
          mappedLprPeriod = "2"; // 5年期以上LPR
        } else {
          mappedLprPeriod = "1"; // 1年期LPR
        }

        logger.debug("期限映射:", {
          原PBOC期限: pbocPeriod.value,
          映射后LPR期限: mappedLprPeriod,
        });

        // 第一段：基准利率阶段（开始日期至LPR实施前一天）
        const pbocEndDate = new Date(lprStartDate);
        pbocEndDate.setDate(pbocEndDate.getDate() - 1);

        logger.debug("基准利率段:", {
          开始日期: startDateValue,
          结束日期: formatDate(pbocEndDate),
        });

        const pbocResult = calculatePBOCInterest(
          principalValue,
          startDateValue,
          formatDate(pbocEndDate),
          pbocPeriod.value,
          pbocAdjustmentMethod.value,
          pbocAdjustValue, // 使用转换后的数值
          yearDays.value
        );

        logger.debug("基准利率段结果:", pbocResult);

        // 第二段：LPR阶段（LPR实施日期至结束日期）
        logger.debug("LPR段:", {
          开始日期: formatDate(lprStartDate),
          结束日期: endDateValue,
        });

        const lprResult = calculateLPRInterest(
          principalValue,
          formatDate(lprStartDate),
          endDateValue,
          mappedLprPeriod, // 使用映射后的LPR期限
          lprAdjustmentMethod.value,
          lprAdjustValue, // 使用转换后的数值
          yearDays.value
        );

        logger.debug("LPR段结果:", lprResult);

        // 合并结果
        const totalInterest = (pbocResult.totalInterest || 0) + (lprResult.totalInterest || 0);
        const totalDays = (pbocResult.days || 0) + (lprResult.days || 0);

        logger.debug("合并计算:", {
          pboc利息: pbocResult.totalInterest,
          lpr利息: lprResult.totalInterest,
          总利息: totalInterest,
          pboc天数: pbocResult.days,
          lpr天数: lprResult.days,
          总天数: totalDays,
        });

        // 确保details属性存在
        const pbocDetails = pbocResult.details || [];
        const lprDetails = lprResult.details || [];

        calculationResult = {
          amount: principalValue,
          startDate: startDateValue,
          endDate: endDateValue,
          totalInterest: totalInterest,
          total: principalValue + totalInterest,
          days: totalDays,
          // 保存各阶段完整结果，便于表格展示
          pbocResult: pbocResult,
          lprResult: lprResult,
          interestDetails: [...(pbocResult.interestDetails || []), ...(lprResult.interestDetails || [])],
          details: [`自动分段计算：计算期间跨越LPR实施日期(2019-08-20)，采用不同计算方法`, `---------- 第一段：基准利率计算 (${startDateValue} 至 2019-08-19) ----------`, ...pbocDetails.map((item) => `  ${item}`), `第一段小计：利息${pbocResult.totalInterest ? pbocResult.totalInterest.toFixed(2) : "0.00"}元，${pbocResult.days}天`, `---------- 第二段：LPR利率计算 (2019-08-20 至 ${endDateValue}) ----------`, ...lprDetails.map((item) => `  ${item}`), `第二段小计：利息${lprResult.totalInterest ? lprResult.totalInterest.toFixed(2) : "0.00"}元，${lprResult.days}天`, `---------- 合计 ----------`, `总计息天数：${totalDays}天`, `总利息：${totalInterest.toFixed(2)}元`, `本息合计：${(principalValue + totalInterest).toFixed(2)}元`],
        };
      }
      break;

    default:
      toast.error(`未知的计算类型: ${calculationType.value}`);
      return;
  }

  // 检查最终结果是否有NaN
  if (calculationResult) {
    logger.debug("最终计算结果:", {
      总利息: calculationResult.totalInterest,
      本息合计: calculationResult.total,
      计息天数: calculationResult.days,
      isNaN总利息: isNaN(calculationResult.totalInterest),
      isNaN本息合计: isNaN(calculationResult.total),
    });
  }

  // 更新计算结果
  result.value = calculationResult;
}

function exportToExcel() {
  if (!result.value) return;

  exportInterestToExcel(result.value, calculationType.value);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(parseFloat(value).toFixed(2));
}

function mergeDetailsByRate(details) {
  if (!details || details.length === 0) return [];

  const mergedDetails = [];

  // 处理数据按照不同利率区间分组
  for (let i = 0; i < details.length; i++) {
    const detail = details[i];

    // 判断当前项与下一项是否属于同一利率区间
    if (i < details.length - 1) {
      const nextDetail = details[i + 1];

      // 如果当前项和下一项的调整后利率相同，则合并它们
      if (Math.abs((detail.adjustedRate || detail.rate) - (nextDetail.adjustedRate || nextDetail.rate)) < 0.00001) {
        // 开始一个新的组
        let group = {
          startDate: detail.startDate,
          endDate: detail.endDate,
          days: detail.days,
          rate: detail.rate,
          adjustedRate: detail.adjustedRate || detail.rate,
          interest: detail.interest,
        };

        // 向后合并所有具有相同利率的项
        let j = i + 1;
        while (j < details.length && Math.abs((details[j].adjustedRate || details[j].rate) - (detail.adjustedRate || detail.rate)) < 0.00001) {
          group.endDate = details[j].endDate;
          group.days += details[j].days;
          group.interest += details[j].interest;
          j++;
        }

        // 添加组到结果
        mergedDetails.push(group);

        // 跳过已处理的项
        i = j - 1;
      } else {
        // 利率不同，单独作为一个组
        mergedDetails.push({
          startDate: detail.startDate,
          endDate: detail.endDate,
          days: detail.days,
          rate: detail.rate,
          adjustedRate: detail.adjustedRate || detail.rate,
          interest: detail.interest,
        });
      }
    } else {
      // 最后一项，检查是否能与前一个组合并
      if (mergedDetails.length > 0 && Math.abs(mergedDetails[mergedDetails.length - 1].adjustedRate - (detail.adjustedRate || detail.rate)) < 0.00001) {
        // 与前一个组合并
        const lastGroup = mergedDetails[mergedDetails.length - 1];
        lastGroup.endDate = detail.endDate;
        lastGroup.days += detail.days;
        lastGroup.interest += detail.interest;
      } else {
        // 单独作为一个组
        mergedDetails.push({
          startDate: detail.startDate,
          endDate: detail.endDate,
          days: detail.days,
          rate: detail.rate,
          adjustedRate: detail.adjustedRate || detail.rate,
          interest: detail.interest,
        });
      }
    }
  }

  return mergedDetails;
}

// 监听变化
watch(
  () => lprPeriod.value,
  () => {
    updateApplicableRates();
    updateDesignatedLprRate();
  }
);

watch(
  () => pbocPeriod.value,
  () => {
    updateApplicableRates();
    updateDesignatedPbocRate();
  }
);

watch(
  () => endDate.value,
  () => {
    updateApplicableRates();
    autoSelectPeriods();
  }
);

watch(
  () => principal.value,
  () => {
    convertToChinese();
  }
);

watch(
  () => designatedLprDate.value,
  () => {
    updateDesignatedLprRate();
  }
);

watch(
  () => designatedPbocDate.value,
  () => {
    updateDesignatedPbocRate();
  }
);

// 组件挂载时执行
onMounted(() => {
  updateApplicableRates();
  updateDesignatedLprRate();
  updateDesignatedPbocRate();
  convertToChinese();
});
</script>

<style scoped>
/* 日期选择器样式 */
.date-input-wrapper {
  position: relative;
  cursor: pointer;
}

.date-input-wrapper input {
  cursor: pointer;
}

/* 隐藏原生日期输入框的日历图标（Chrome） */
input[type="date"]::-webkit-calendar-picker-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
</style>
