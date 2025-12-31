<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">经济补偿金/赔偿金计算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <HelpIcon class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">功能说明</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <CloseIcon class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">经济补偿金(N)适用情形：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>协商一致解除劳动合同</li>
                <li>用人单位提出解除并与劳动者协商一致</li>
                <li>经济性裁员</li>
                <li>劳动合同到期，单位不续签</li>
                <li>企业破产、吊销营业执照等</li>
              </ul>
            </div>

            <div>
              <h4 class="font-semibold mb-1">经济赔偿金(2N)适用情形：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>用人单位违法解除劳动合同</li>
                <li>未经法定程序解除合同</li>
                <li>强制解除劳动合同</li>
                <li>特殊时期违法解除（如孕期、工伤期）</li>
              </ul>
            </div>

            <div class="bg-destructive/10 p-2 rounded text-destructive">
              <p><strong>注意：</strong>两种赔偿不可同时主张，若属违法解除，可选择赔偿金(2N)或要求继续履行合同。该工具仅供参考。</p>
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
              <!-- 赔偿类型选择 -->
              <div>
                <label class="text-sm font-medium leading-none">赔偿类型</label>
                <Select v-model="selectedTypeIndex" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="selectedTypeIndex === 0 ? '经济补偿金(N)' : '经济赔偿金(2N)'" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="0">经济补偿金(N)</SelectItem>
                    <SelectItem :value="1">经济赔偿金(2N)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 工资超限选择 -->
              <div>
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium leading-none flex items-center gap-2">
                    离职前12个月平均工资是否超过社会平均工资3倍
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" class="h-5 w-5 p-0">
                            <HelpIcon class="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent class="max-w-80 p-4">
                          <p>
                            劳动者月工资高于用人单位所在直辖市、设区的市级人民政府公布的本地区上年度职工月平均工资三倍的，向其支付经济补偿的标准按职工月平均工资三倍的数额支付，向其支付经济补偿的年限最高不超过十二年。
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                  <Switch v-model="isWageExceed" @update:model-value="onWageExceedChange" />
                </div>
              </div>

              <!-- 社会平均工资 - 仅在超过时显示 -->
              <div v-if="isWageExceed">
                <label class="text-sm font-medium leading-none">社会平均工资（元）</label>
                <Input type="number" v-model="socialAverageWage" placeholder="广州13193元，深圳14553元，珠海11156元"
                  class="mt-1.5" />
                <p class="text-xs text-muted-foreground mt-1">
                  最高计算基数为社会平均工资的3倍（{{ (parseFloat(socialAverageWage) * 3).toFixed(2) }}元）。<br />
                  参考数值：广州13193元，深圳14553元，珠海11156元
                  <Button variant="link" size="sm" class="p-0 h-auto" @click="showSocialWageInfo">查看数据来源</Button>
                </p>
              </div>

              <!-- 月工资输入 -->
              <div>
                <label class="text-sm font-medium leading-none">离职前12个月平均工资（元）</label>
                <Input type="number" v-model="monthlyWage" :placeholder="isWageExceed ? '社会平均三倍工资' : '月平均工资（未超社平3倍）'"
                  class="mt-1.5" />
              </div>

              <!-- 起始时间和结束时间 -->
              <div>
                <label class="text-sm font-medium leading-none">入职日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="startDate" class="w-full pl-10" />
                  </div>
                </div>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">离职日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="endDate" class="w-full pl-10" />
                  </div>
                </div>
              </div>

              <!-- 是否属于特定情形 - 仅在经济补偿金时显示 -->
              <div v-if="isCompensation">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium leading-none flex items-center gap-2">
                    是否属于第四十条情形
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" class="h-5 w-5 p-0">
                            <HelpIcon class="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent class="max-w-80 p-4">
                          <p class="font-semibold">第四十条情形说明</p>
                          <p class="mt-1">有下列情形之一的，用人单位提前三十日以书面形式通知劳动者本人或者额外支付劳动者一个月工资后，可以解除劳动合同:</p>
                          <p class="mt-1">(一) 劳动者患病或者非因工负伤，在规定的医疗期满后不能从事原工作，也不能从事由用人单位另行安排的工作的；</p>
                          <p class="mt-1">(二) 劳动者不能胜任工作，经过培训或者调整工作岗位，仍不能胜任工作的；</p>
                          <p class="mt-1">(三) 劳动合同订立时所依据的客观情况发生重大变化，致使劳动合同无法履行，经用人单位与劳动者协商，未能就变更劳动合同内容达成协议的。</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                  <Switch v-model="isArticle40" @update:model-value="onArticle40Change" />
                </div>
              </div>

              <!-- 最后一个月工资 - 仅在经济补偿金且选择第四十条情形时显示 -->
              <div v-if="isCompensation && isArticle40">
                <label class="text-sm font-medium leading-none">离职前最后一个月工资（元）</label>
                <Input type="number" v-model="lastMonthWage" placeholder="请输入最后一个月工资" class="mt-1.5" />
              </div>

              <div class="pt-4">
                <Button class="w-full" @click="calculate">计算</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="showResult" class="shadow-none border">
          <CardHeader>
            <div class="flex justify-between items-center">
              <CardTitle>计算结果</CardTitle>
              <Button variant="outline" @click="exportToExcel" class="flex items-center gap-1">
                <span>导出Excel</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible class="w-full space-y-2">
              <!-- 工作年限计算 -->
              <AccordionItem value="work-years">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">工作年限计算</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center">
                      <span>起始日期：</span>
                      <span>{{ startDate }}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>结束日期：</span>
                      <span>{{ endDate }}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>工作时长：</span>
                      <span>{{ totalYears }}年{{ totalMonths }}个月{{ totalDays }}天</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>计算年限：</span>
                      <span class="font-medium">{{ calculatedYears }}年</span>
                    </div>
                    <Alert variant="secondary" class="mt-2 block">
                      <p class="text-xs">
                        {{ !isCompensation ? "* 赔偿金计算：不满一年的按一年计算" : "* 补偿金计算：每满一年支付一个月工资，不满半年按0.5个月计算，满半年不满一年按一年计算" }}
                      </p>
                    </Alert>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 计算过程 -->
              <AccordionItem value="calculation-process">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">计算过程</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center">
                      <span>实际月工资：</span>
                      <span>{{ formatCurrency(effectiveMonthlyWage) }}元</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>补偿基数：</span>
                      <span>{{ calculatedYears }}年 × {{ formatCurrency(effectiveMonthlyWage) }}元</span>
                    </div>
                    <div v-if="isCompensation && isArticle40" class="flex justify-between items-center">
                      <span>第四十条额外补偿：</span>
                      <span>{{ formatCurrency(lastMonthWage) }}元</span>
                    </div>
                    <div v-if="!isCompensation" class="flex justify-between items-center">
                      <span>赔偿金系数：</span>
                      <span>2倍</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <!-- 总计 -->
            <Alert variant="success" class="mt-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">{{ isCompensation ? "经济补偿金：" : "经济赔偿金：" }}</span>
                <span class="text-lg font-bold">{{ formatCurrency(totalAmount) }}元</span>
              </div>
            </Alert>
          </CardContent>
        </Card>

        <div v-if="!showResult" class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
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
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算"按钮查看结果</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "赔偿计算器",
  layout: "dashboard-layout",
});

import { exportCompensationToExcel } from "#shared/utils/tools/utils/excelExport";
import { CalendarIcon } from "lucide-vue-next";

const alertDialogStore = useAlertDialogStore();

// 状态管理
const isHelpOpen = ref(false);
const showResult = ref(false);
const socialAverageWage = ref("13193"); // 设置参考值
const isWageExceed = ref(false);
const selectedTypeIndex = ref(0);
const monthlyWage = ref("");
const startDate = ref("");
const endDate = ref("");
const isArticle40 = ref(false);
const effectiveMonthlyWage = ref(0);
const calculatedYears = ref(0);
const totalAmount = ref(0);
const isAboveLimit = ref(false);
const totalYears = ref(0);
const totalMonths = ref(0);
const totalDays = ref(0);
const lastMonthWage = ref("");

// 计算属性
const isCompensation = computed(() => {
  return selectedTypeIndex.value === 0;
});

// 方法
function toggleHelp() {
  isHelpOpen.value = !isHelpOpen.value;
}

function onWageExceedChange() {
  monthlyWage.value = "";
  socialAverageWage.value = "13193";
  showResult.value = false;
}

function onArticle40Change() {
  if (showResult.value) {
    calculate();
  }
}

function showSocialWageInfo() {
  alertDialogStore.showSuccessDialog({
    title: "数据来源",
    message: "数据来源：国家统计局\n查询网址：https://data.stats.gov.cn/search.htm",
  });
}

function calculateDateDifference(startDateStr, endDateStr) {
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  let years = endDate.getFullYear() - startDate.getFullYear();
  let months = endDate.getMonth() - startDate.getMonth();
  let days = endDate.getDate() - startDate.getDate();

  if (days < 0) {
    months--;
    const lastDayOfLastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 0).getDate();
    days += lastDayOfLastMonth;
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months, days };
}

function calculateCompensationYears(years, months, days) {
  const totalMonthCount = years * 12 + months + (days > 0 ? 1 : 0);

  let calculatedYears;

  if (isCompensation.value) {
    // 经济补偿金：不满6个月按0.5年，满6个月不满1年按1年
    if (totalMonthCount % 12 === 0) {
      calculatedYears = totalMonthCount / 12;
    } else if (totalMonthCount % 12 < 6) {
      calculatedYears = Math.floor(totalMonthCount / 12) + 0.5;
    } else {
      calculatedYears = Math.ceil(totalMonthCount / 12);
    }
  } else {
    // 经济赔偿金：不满一年的按一年计算
    calculatedYears = Math.ceil(totalMonthCount / 12);
  }

  // 限制最大年限为12年
  return Math.min(calculatedYears, 12);
}

function calculate() {
  // 基本验证
  if (!monthlyWage.value || !startDate.value || !endDate.value) {
    // 添加全局Toast错误提示
    toast.error("请填写完整信息");
    return;
  }

  // 验证社会平均工资（如果需要）
  if (isWageExceed.value && !socialAverageWage.value) {
    // 添加全局Toast错误提示
    toast.error("请填写社会平均工资");
    return;
  }

  // 验证最后一个月工资（如果是第四十条情形）
  if (isCompensation.value && isArticle40.value && !lastMonthWage.value) {
    // 添加全局Toast错误提示
    toast.error("请填写最后一个月工资");
    return;
  }

  // 验证结束日期不早于开始日期
  if (new Date(endDate.value) < new Date(startDate.value)) {
    // 添加全局Toast错误提示
    toast.error("结束日期不能早于开始日期");
    return;
  }

  // 计算工作时长
  const { years, months, days } = calculateDateDifference(startDate.value, endDate.value);
  totalYears.value = years;
  totalMonths.value = months;
  totalDays.value = days;

  // 计算补偿/赔偿年限
  calculatedYears.value = calculateCompensationYears(years, months, days);

  const wage = parseFloat(monthlyWage.value);

  // 根据是否超过社平工资三倍确定实际工资
  if (isWageExceed.value) {
    const maxWage = parseFloat(socialAverageWage.value) * 3;
    isAboveLimit.value = wage > maxWage;
    effectiveMonthlyWage.value = Math.min(wage, maxWage);
  } else {
    isAboveLimit.value = false;
    effectiveMonthlyWage.value = wage;
  }

  // 计算基础金额
  let baseAmount = effectiveMonthlyWage.value * calculatedYears.value;

  // 计算最终金额
  if (isCompensation.value) {
    if (isArticle40.value) {
      // 经济补偿金 (N+1)，使用最后一个月工资作为加1
      const lastMonthAmount = parseFloat(lastMonthWage.value);
      totalAmount.value = baseAmount + lastMonthAmount;
    } else {
      // 普通经济补偿金 (N)
      totalAmount.value = baseAmount;
    }
  } else {
    // 经济赔偿金 (2N)
    totalAmount.value = baseAmount * 2;
  }

  // 四舍五入到2位小数
  totalAmount.value = Number(totalAmount.value.toFixed(2));
  showResult.value = true;
}

function exportToExcel() {
  if (!showResult.value) return;

  // 准备导出数据
  const exportData = {
    isCompensation: isCompensation.value,
    startDate: startDate.value,
    endDate: endDate.value,
    totalYears: totalYears.value,
    totalMonths: totalMonths.value,
    totalDays: totalDays.value,
    calculatedYears: calculatedYears.value,
    effectiveMonthlyWage: effectiveMonthlyWage.value,
    isArticle40: isArticle40.value,
    lastMonthWage: lastMonthWage.value,
    totalAmount: totalAmount.value,
  };

  exportCompensationToExcel(exportData);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
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
