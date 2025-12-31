<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">律师费用计算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <HelpIcon class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">律师费用计算指引</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <CloseIcon class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">律师费用说明：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>本计算器根据不同案件类型、复杂程度、地区等因素计算律师费用</li>
                <li>计算结果仅供参考，实际收费标准可能因律师事务所和个人律师而有所不同</li>
                <li>建议您在选择律师服务前先咨询相关律师，确认具体费用</li>
              </ul>
            </div>

            <div class="bg-muted/30 p-2 rounded">
              <p><strong>提示：</strong>本计算结果仅为参考，具体费用以律师事务所实际报价为准。</p>
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
                <label class="text-sm font-medium leading-none">服务类型</label>
                <Select v-model="caseType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择服务类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="civil">民事案件</SelectItem>
                    <SelectItem value="criminal">刑事案件</SelectItem>
                    <SelectItem value="administrative">行政案件</SelectItem>
                    <SelectItem value="consultation">法律咨询</SelectItem>
                    <SelectItem value="document">法律文书</SelectItem>
                    <SelectItem value="commercial">商事法律服务</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 民事案件特有选项 -->
              <div v-if="caseType === 'civil'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">争议金额（元）</label>
                  <Input type="number" v-model.number="disputeAmount" placeholder="请输入争议金额" class="mt-1.5" />
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">案件复杂程度</label>
                  <Select v-model="complexity" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择复杂程度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">简单</SelectItem>
                      <SelectItem value="medium">一般</SelectItem>
                      <SelectItem value="complex">复杂</SelectItem>
                      <SelectItem value="very-complex">特别复杂</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">代理阶段</label>
                  <div class="flex items-center space-x-2 mt-1.5">
                    <div class="custom-checkbox">
                      <Checkbox id="allStages" v-model="allStages" @update:model-value="toggleAllStages" />
                    </div>
                    <label for="allStages">全程代理</label>
                  </div>

                  <div v-if="!allStages" class="grid grid-cols-2 gap-2 mt-2">
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-preparation" value="preparation" v-model="selectedStages" />
                      </div>
                      <label for="stage-preparation">准备阶段</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-evidence" value="evidence" v-model="selectedStages" />
                      </div>
                      <label for="stage-evidence">举证阶段</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-court" value="court" v-model="selectedStages" />
                      </div>
                      <label for="stage-court">庭审阶段</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-settlement" value="settlement" v-model="selectedStages" />
                      </div>
                      <label for="stage-settlement">调解阶段</label>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">是否包含上诉阶段</label>
                  <div class="flex items-center space-x-2 mt-1.5">
                    <div class="custom-checkbox">
                      <Checkbox id="hasAppeal" v-model="hasAppeal" />
                    </div>
                    <label for="hasAppeal">包含上诉阶段（费用增加30%）</label>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">是否包含执行阶段</label>
                  <div class="flex items-center space-x-2 mt-1.5">
                    <div class="custom-checkbox">
                      <Checkbox id="hasExecution" v-model="hasExecution" />
                    </div>
                    <label for="hasExecution">包含执行阶段（费用增加20%）</label>
                  </div>
                </div>
              </div>

              <!-- 刑事案件特有选项 -->
              <div v-if="caseType === 'criminal'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">案件复杂程度</label>
                  <Select v-model="complexity" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择复杂程度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">简单</SelectItem>
                      <SelectItem value="medium">一般</SelectItem>
                      <SelectItem value="complex">复杂</SelectItem>
                      <SelectItem value="very-complex">特别复杂</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">案件预计持续时间（月）</label>
                  <Input type="number" v-model.number="caseDuration" min="1" placeholder="请输入案件预计持续时间" class="mt-1.5" />
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">辩护阶段</label>
                  <div class="flex items-center space-x-2 mt-1.5">
                    <div class="custom-checkbox">
                      <Checkbox id="allStages" v-model="allStages" @update:model-value="toggleAllStages" />
                    </div>
                    <label for="allStages">全程辩护</label>
                  </div>

                  <div v-if="!allStages" class="grid grid-cols-2 gap-2 mt-2">
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-investigation" value="investigation" v-model="selectedStages" />
                      </div>
                      <label for="stage-investigation">侦查阶段</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-prosecution" value="prosecution" v-model="selectedStages" />
                      </div>
                      <label for="stage-prosecution">审查起诉阶段</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <div class="custom-checkbox">
                        <Checkbox id="stage-trial" value="trial" v-model="selectedStages" />
                      </div>
                      <label for="stage-trial">审判阶段</label>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 行政案件特有选项 -->
              <div v-if="caseType === 'administrative'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">行政案件类型</label>
                  <Select v-model="administrativeType" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择行政案件类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">一般行政案件</SelectItem>
                      <SelectItem value="land">土地行政案件</SelectItem>
                      <SelectItem value="planning">规划行政案件</SelectItem>
                      <SelectItem value="environmental">环境行政案件</SelectItem>
                      <SelectItem value="licensing">行政许可案件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">是否包含上诉阶段</label>
                  <div class="flex items-center space-x-2 mt-1.5">
                    <div class="custom-checkbox">
                      <Checkbox id="hasAppeal" v-model="hasAppeal" />
                    </div>
                    <label for="hasAppeal">包含上诉阶段（费用增加30%）</label>
                  </div>
                </div>
              </div>

              <!-- 法律咨询特有选项 -->
              <div v-if="caseType === 'consultation'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">咨询时长（小时）</label>
                  <Input type="number" v-model.number="consultationHours" placeholder="请输入咨询时长" class="mt-1.5" />
                </div>
              </div>

              <!-- 法律文书特有选项 -->
              <div v-if="caseType === 'document'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">文书类型</label>
                  <Select v-model="documentType" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择文书类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">合同文书</SelectItem>
                      <SelectItem value="lawsuit">诉讼文书</SelectItem>
                      <SelectItem value="opinion">法律意见书</SelectItem>
                      <SelectItem value="will">遗嘱</SelectItem>
                      <SelectItem value="corporate">公司法律文件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">文书复杂程度</label>
                  <Select v-model="documentComplexity" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择复杂程度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">简单</SelectItem>
                      <SelectItem value="medium">一般</SelectItem>
                      <SelectItem value="complex">复杂</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <!-- 商事法律服务特有选项 -->
              <div v-if="caseType === 'commercial'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">服务类型</label>
                  <Select v-model="commercialType" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="请选择服务类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract_review">合同审查</SelectItem>
                      <SelectItem value="negotiation">商务谈判</SelectItem>
                      <SelectItem value="due_diligence">尽职调查</SelectItem>
                      <SelectItem value="ipo_advisory">上市法律顾问</SelectItem>
                      <SelectItem value="compliance">合规服务</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">涉及金额（元）</label>
                  <Input type="number" v-model.number="disputeAmount" placeholder="请输入涉及金额（可选）" class="mt-1.5" />
                </div>
              </div>

              <!-- 通用选项 - 地区 -->
              <div>
                <label class="text-sm font-medium leading-none">地区</label>
                <Select v-model="region" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择地区" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tier1">一线城市（北上广深）</SelectItem>
                    <SelectItem value="tier2">二线城市</SelectItem>
                    <SelectItem value="tier3">三线及以下城市</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="mt-2">
                <Button class="w-full h-10" @click="calculateFee">计算律师费用</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border">
          <CardHeader>
            <CardTitle>律师费用计算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="success" class="mb-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">律师费用：</span>
                <span class="text-lg font-bold">{{ formatCurrency(result.fee) }} 元</span>
              </div>
            </Alert>

            <Accordion type="single" collapsible class="w-full">
              <AccordionItem value="calculation-details">
                <AccordionTrigger>
                  <h3 class="text-lg font-semibold">计算明细</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="bg-muted/50 p-4 rounded text-sm">
                    <div v-for="(detail, index) in result.details" :key="index" class="mb-1">
                      {{ detail }}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <div v-if="!result" class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
          <div class="text-center">
            <div class="text-muted-foreground mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"
                class="mx-auto mb-4 opacity-50">
                <path
                  d="M11.7 2C7.5 2 4 5.5 4 9.7v.2C4 14.5 7.5 18 11.7 18h.2c4.2 0 7.7-3.5 7.7-7.7v-.1C19.6 5.6 16.4 2 11.7 2Z" />
                <path d="M12 18v4" />
                <path d="M8 22h8" />
              </svg>
              <h3 class="text-lg font-medium">计算结果将在这里显示</h3>
            </div>
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算律师费用"按钮查看结果</p>
          </div>
        </div>

        <Card class="mt-4 shadow-none border">
          <CardHeader>
            <CardTitle>注意事项</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-sm space-y-2">
              <p>1. 本计算器根据《律师服务收费管理办法》及地方律师协会指导标准计算律师费用，仅供参考。</p>
              <p>2. 律师费用会因地区、律师资历、案件具体情况等因素有所不同。</p>
              <p>3. 实际律师费用建议直接咨询您要委托的律师或律师事务所。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "律师费用计算",
  layout: "dashboard-layout",
});

import { calculateLawyerFee } from "#shared/utils/tools/lawyerFeeService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// 基本数据
const isHelpOpen = ref(false);
const caseType = ref("civil");
const disputeAmount = ref(100000);
const complexity = ref("medium");
const administrativeType = ref("basic");
const consultationHours = ref(2);
const caseDuration = ref(1);
const region = ref("tier2");
const hasAppeal = ref(false);
const hasExecution = ref(false);
const allStages = ref(true);
const selectedStages = ref([]);
const documentType = ref("contract");
const documentComplexity = ref("medium");
const commercialType = ref("contract_review");
const result = ref(null);

// 切换全部阶段选择
function toggleAllStages() {
  if (allStages.value) {
    selectedStages.value = [];
  }
}

// 格式化金额
function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

// 验证输入
function validateInputs() {
  if (caseType.value === "civil" && (!disputeAmount.value || disputeAmount.value <= 0)) {
    alert("请输入有效的争议金额");
    return false;
  }

  if (caseType.value === "consultation" && (!consultationHours.value || consultationHours.value <= 0)) {
    alert("请输入有效的咨询时长");
    return false;
  }

  if (caseType.value === "criminal" && (!caseDuration.value || caseDuration.value < 1)) {
    alert("请输入有效的案件持续时间");
    return false;
  }

  return true;
}

// 计算律师费用
function calculateFee() {
  if (!validateInputs()) {
    return;
  }

  // 组装计算选项
  const options = {
    disputeAmount: disputeAmount.value,
    complexity: complexity.value,
    administrativeType: administrativeType.value,
    consultationHours: consultationHours.value,
    region: region.value,
    hasAppeal: hasAppeal.value,
    hasExecution: hasExecution.value,
    stages: allStages.value ? [] : selectedStages.value,
    caseDuration: caseDuration.value,
    documentType: documentType.value,
    documentComplexity: documentComplexity.value,
    commercialType: commercialType.value,
  };

  // 计算律师费用
  result.value = calculateLawyerFee(caseType.value, options);
}

// 监听选项变化
watch(selectedStages, (val) => {
  if (val && val.length > 0) {
    allStages.value = false;
  }
});

watch(caseType, () => {
  // 重置一些选项
  hasAppeal.value = false;
  hasExecution.value = false;
  allStages.value = true;
  selectedStages.value = [];
});
</script>

<style scoped>
/* 自定义checkbox样式 */
.custom-checkbox {
  position: relative;
  width: 20px;
  height: 20px;
}
</style>
