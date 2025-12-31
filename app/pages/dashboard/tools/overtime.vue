<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">加班费/调休计算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <HelpIcon class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">加班费计算指引</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <CloseIcon class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">加班费计算标准：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>工作日加班：不低于工资的1.5倍</li>
                <li>休息日加班：不低于工资的2倍</li>
                <li>法定节假日加班：不低于工资的3倍</li>
              </ul>
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
                <label class="text-sm font-medium leading-none">月基本工资（元）</label>
                <Input type="number" v-model="baseSalary" placeholder="请输入月基本工资" class="mt-1.5" />
              </div>

              <div>
                <label class="text-sm font-medium leading-none">工作日加班时间（小时）</label>
                <Input type="number" v-model="workdayOvertimeHours" placeholder="请输入工作日加班时间" class="mt-1.5" />
              </div>

              <div>
                <label class="text-sm font-medium leading-none">休息日加班时间（小时）</label>
                <Input type="number" v-model="weekendOvertimeHours" placeholder="请输入休息日加班时间" class="mt-1.5" />
              </div>

              <div>
                <label class="text-sm font-medium leading-none">法定节假日加班时间（小时）</label>
                <Input type="number" v-model="holidayOvertimeHours" placeholder="请输入法定节假日加班时间" class="mt-1.5" />
              </div>

              <Separator />

              <div>
                <label class="text-sm font-medium leading-none">月工作日天数</label>
                <Input type="number" v-model="workdaysPerMonth" placeholder="默认21.75天" class="mt-1.5" />
                <p class="text-xs text-muted-foreground mt-1">国家标准为21.75天/月</p>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">每天工作时间（小时）</label>
                <Input type="number" v-model="hoursPerDay" placeholder="默认8小时" class="mt-1.5" />
                <p class="text-xs text-muted-foreground mt-1">国家标准为8小时/天</p>
              </div>

              <div class="flex flex-col gap-3 pt-2">
                <Button @click="calculatePay">计算加班费</Button>
                <Button variant="outline" @click="calculateTime">计算调休时间</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <!-- 加班费计算结果 -->
        <Card v-if="payResult" class="shadow-none border mb-6">
          <CardHeader>
            <CardTitle>加班费计算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert class="block">
              <div class="flex justify-between items-center">
                <span>小时工资：</span>
                <span class="font-semibold">{{ formatCurrency(payResult.hourlyRate) }} 元/小时</span>
              </div>
            </Alert>

            <div class="mt-4 space-y-3">
              <div v-if="workdayOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>工作日加班费（1.5倍）：</span>
                  <span class="font-semibold">{{ formatCurrency(payResult.workdayOvertimePay) }} 元</span>
                </div>
              </div>

              <div v-if="weekendOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>休息日加班费（2倍）：</span>
                  <span class="font-semibold">{{ formatCurrency(payResult.weekendOvertimePay) }} 元</span>
                </div>
              </div>

              <div v-if="holidayOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>法定节假日加班费（3倍）：</span>
                  <span class="font-semibold">{{ formatCurrency(payResult.holidayOvertimePay) }} 元</span>
                </div>
              </div>
            </div>

            <Alert variant="success" class="mt-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">总加班费：</span>
                <span class="text-lg font-bold">{{ formatCurrency(payResult.totalOvertimePay) }} 元</span>
              </div>
            </Alert>

            <div class="mt-4">
              <Accordion type="single" collapsible class="w-full space-y-2">
                <AccordionItem value="calculation-details">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">计算明细</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="bg-muted/50 p-4 rounded text-sm space-y-1">
                      <div v-for="(detail, index) in payResult.details" :key="index">{{ detail }}</div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </CardContent>
        </Card>

        <!-- 调休时间计算结果 -->
        <Card v-if="timeResult" class="shadow-none border mb-6">
          <CardHeader>
            <CardTitle>调休时间计算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div v-if="workdayOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>工作日加班调休（1:1）：</span>
                  <span class="font-semibold">{{ timeResult.workdayCompensatoryHours }} 小时</span>
                </div>
              </div>

              <div v-if="weekendOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>休息日加班调休（1:1）：</span>
                  <span class="font-semibold">{{ timeResult.weekendCompensatoryHours }} 小时</span>
                </div>
              </div>

              <div v-if="holidayOvertimeHours > 0" class="p-3 bg-muted/30 rounded">
                <div class="flex justify-between items-center">
                  <span>法定节假日加班调休（1:3）：</span>
                  <span class="font-semibold">{{ timeResult.holidayCompensatoryHours }} 小时</span>
                </div>
              </div>
            </div>

            <Alert variant="success" class="mt-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">总调休时间：</span>
                <span class="text-lg font-bold">{{ timeResult.totalCompensatoryHours }} 小时（约 {{
                  timeResult.totalCompensatoryDays }} 天）</span>
              </div>
            </Alert>

            <div class="mt-4">
              <Accordion type="single" collapsible class="w-full space-y-2">
                <AccordionItem value="calculation-details">
                  <AccordionTrigger>
                    <h3 class="text-base font-semibold">计算明细</h3>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div class="bg-muted/50 p-4 rounded text-sm space-y-1">
                      <div v-for="(detail, index) in timeResult.details" :key="index">{{ detail }}</div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </CardContent>
        </Card>

        <!-- 空状态 -->
        <div v-if="!payResult && !timeResult"
          class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
          <div class="text-center">
            <div class="text-muted-foreground mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"
                class="mx-auto mb-4 opacity-50">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="6" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3 class="text-lg font-medium">计算结果将在这里显示</h3>
            </div>
            <p class="text-sm text-muted-foreground">填写左侧表单并点击相应按钮查看结果</p>
          </div>
        </div>

        <!-- 相关法规 -->
        <Card class="shadow-none border mt-4">
          <CardHeader>
            <CardTitle>相关法规</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-sm">
              <h3 class="font-semibold text-base mb-2">《中华人民共和国劳动法》相关规定：</h3>
              <div class="space-y-1 pl-4">
                <p>第四十四条 有下列情形之一的，用人单位应当按照下列标准支付高于劳动者正常工作时间工资的工资报酬：</p>
                <p class="pl-4">（一）安排劳动者延长工作时间的，支付不低于工资的百分之一百五十的工资报酬；</p>
                <p class="pl-4">（二）休息日安排劳动者工作又不能安排补休的，支付不低于工资的百分之二百的工资报酬；</p>
                <p class="pl-4">（三）法定休假日安排劳动者工作的，支付不低于工资的百分之三百的工资报酬。</p>
              </div>
              <Alert variant="warning" class="mt-4 block">
                <p class="text-xs">注意：本计算器结果仅供参考，实际支付标准请以公司规定或劳动合同约定为准。</p>
              </Alert>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "加班费/调休计算器",
  layout: "dashboard-layout",
});

import { calculateOvertimePay, calculateCompensatoryTime } from "#shared/utils/tools/overtimePayService";

// 全局状态管理
const alertDialogStore = useAlertDialogStore();

// 状态管理
const isHelpOpen = ref(false);
const baseSalary = ref(5000);
const workdayOvertimeHours = ref(0);
const weekendOvertimeHours = ref(0);
const holidayOvertimeHours = ref(0);
const workdaysPerMonth = ref(21.75);
const hoursPerDay = ref(8);
const payResult = ref(null);
const timeResult = ref(null);

// 方法
function validateInput(checkSalary = true) {
  if (checkSalary && (!baseSalary.value || baseSalary.value <= 0)) {
    toast.error("请输入有效的月基本工资");
    return false;
  }

  if (!workdayOvertimeHours.value && !weekendOvertimeHours.value && !holidayOvertimeHours.value) {
    toast.error("请至少输入一种加班时间");
    return false;
  }

  if (!workdaysPerMonth.value || workdaysPerMonth.value <= 0) {
    workdaysPerMonth.value = 21.75;
  }

  if (!hoursPerDay.value || hoursPerDay.value <= 0) {
    hoursPerDay.value = 8;
  }

  return true;
}

function calculatePay() {
  if (!validateInput()) return;

  payResult.value = calculateOvertimePay(baseSalary.value, workdayOvertimeHours.value, weekendOvertimeHours.value, holidayOvertimeHours.value, workdaysPerMonth.value, hoursPerDay.value);

  // 清除之前的调休结果
  timeResult.value = null;
}

function calculateTime() {
  if (!validateInput(false)) return;

  timeResult.value = calculateCompensatoryTime(workdayOvertimeHours.value, weekendOvertimeHours.value, holidayOvertimeHours.value, hoursPerDay.value);

  // 清除之前的加班费结果
  payResult.value = null;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
</script>
