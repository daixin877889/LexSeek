<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">日期推算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <HelpIcon class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">日期推算指引</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <CloseIcon class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">功能说明：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li><strong>目标日期推算</strong>：从起始日期推算指定天数/月数/年数后的日期</li>
                <li><strong>日期间隔推算</strong>：推算两个日期之间的间隔天数</li>
                <li><strong>工作日推算</strong>：推算两个日期之间的工作日天数（不含周末）</li>
                <li><strong>诉讼时效推算</strong>：根据不同案件类型推算诉讼时效到期日</li>
              </ul>
            </div>

            <div class="bg-muted/30 p-2 rounded">
              <p><strong>提示：</strong>推算结果仅供参考，实际法律效力以相关法律法规为准。</p>
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
            <CardTitle>日期推算工具</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div>
                <label class="text-sm font-medium leading-none">功能选择</label>
                <Select v-model="selectedFunction" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择推算功能" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="targetDate">目标日期推算</SelectItem>
                    <SelectItem value="dateInterval">日期间隔推算</SelectItem>
                    <SelectItem value="workingDays">工作日推算</SelectItem>
                    <SelectItem value="limitationPeriod">诉讼时效推算</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 起始日期选择（所有功能都需要） -->
              <div>
                <label class="text-sm font-medium leading-none">起始日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="startDate" class="w-full pl-10" />
                  </div>
                </div>
              </div>

              <!-- 目标日期推算 -->
              <div v-if="selectedFunction === 'targetDate'" class="space-y-4">
                <div>
                  <label class="text-sm font-medium leading-none">时间单位</label>
                  <Select v-model="timeUnit" class="mt-1.5">
                    <SelectTrigger class="w-full">
                      <SelectValue placeholder="选择时间单位" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">天</SelectItem>
                      <SelectItem value="months">月</SelectItem>
                      <SelectItem value="years">年</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">推算数值</label>
                  <Input type="number" v-model.number="timeValue" placeholder="可以输入负数" class="mt-1.5" />
                </div>
              </div>

              <!-- 日期间隔推算和工作日推算 -->
              <div v-if="selectedFunction === 'dateInterval' || selectedFunction === 'workingDays'">
                <label class="text-sm font-medium leading-none">结束日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon
                      class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="endDate" class="w-full pl-10" />
                  </div>
                </div>
              </div>

              <!-- 诉讼时效推算 -->
              <div v-if="selectedFunction === 'limitationPeriod'">
                <label class="text-sm font-medium leading-none">诉讼类型</label>
                <Select v-model="limitationType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择诉讼类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">一般民事（3年）</SelectItem>
                    <SelectItem value="contract">合同纠纷（3年）</SelectItem>
                    <SelectItem value="personal">人身伤害（1年）</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="mt-2">
                <Button class="w-full h-10" @click="calculate">推算</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：推算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border">
          <CardHeader>
            <CardTitle>推算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert class="block">
              <div class="flex justify-between items-center mb-1">
                <span>起始日期：</span>
                <span class="font-semibold">{{ result.startDate }}</span>
              </div>
              <div v-if="result.endDate" class="flex justify-between items-center">
                <span>结束日期：</span>
                <span class="font-semibold">{{ result.endDate }}</span>
              </div>
            </Alert>

            <Alert variant="success" class="mt-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="font-bold">{{ result.details }}</span>
              </div>
            </Alert>

            <div v-if="result.resultDate" class="mt-4 p-4 bg-muted/30 rounded">
              <div class="flex justify-between items-center">
                <span>结果日期：</span>
                <span class="font-semibold">{{ result.resultDate }}</span>
              </div>
            </div>

            <div v-if="result.workingDays !== undefined" class="mt-4 p-4 bg-muted/30 rounded">
              <div class="flex justify-between items-center">
                <span>工作日天数：</span>
                <span class="font-semibold">{{ result.workingDays }} 天</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div v-if="!result" class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
          <div class="text-center">
            <div class="text-muted-foreground mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"
                class="mx-auto mb-4 opacity-50">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <h3 class="text-lg font-medium">推算结果将在这里显示</h3>
            </div>
            <p class="text-sm text-muted-foreground">选择日期并点击"推算"按钮查看结果</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "日期推算",
  layout: "dashboard-layout",
});
import { calculateDateAfterDays, calculateDateAfterMonths, calculateDateAfterYears, calculateWorkingDays, calculateLimitationPeriod } from "#shared/utils/tools/dateCalculatorService";
import { formatDate } from "#shared/utils/tools/utils/date";
import { CalendarIcon } from "lucide-vue-next";

// 基本数据
const isHelpOpen = ref(false);
const selectedFunction = ref("targetDate");
const startDate = ref(formatDate(new Date()));
const endDate = ref(formatDate(new Date(new Date().setDate(new Date().getDate() + 30))));
const timeUnit = ref("days");
const timeValue = ref(30);
const limitationType = ref("general");
const result = ref(null);

// 推算逻辑
function calculate() {
  if (!startDate.value) {
    alert("请选择起始日期");
    return;
  }

  if ((selectedFunction.value === "dateInterval" || selectedFunction.value === "workingDays") && !endDate.value) {
    alert("请选择结束日期");
    return;
  }

  if (selectedFunction.value === "targetDate" && !timeValue.value) {
    alert("请输入推算数值");
    return;
  }

  if (selectedFunction.value === "dateInterval" || selectedFunction.value === "workingDays") {
    if (new Date(startDate.value) > new Date(endDate.value)) {
      alert("开始日期不能晚于结束日期");
      return;
    }
  }

  // 根据不同功能推算结果
  switch (selectedFunction.value) {
    case "targetDate":
      calculateTargetDate();
      break;
    case "dateInterval":
      calculateDateInterval();
      break;
    case "workingDays":
      calculateWorkingDaysResult();
      break;
    case "limitationPeriod":
      calculateLimitationPeriodResult();
      break;
  }
}

function calculateTargetDate() {
  switch (timeUnit.value) {
    case "days":
      result.value = calculateDateAfterDays(startDate.value, timeValue.value);
      break;
    case "months":
      result.value = calculateDateAfterMonths(startDate.value, timeValue.value);
      break;
    case "years":
      result.value = calculateDateAfterYears(startDate.value, timeValue.value);
      break;
  }
}

function calculateDateInterval() {
  const start = new Date(startDate.value);
  const end = new Date(endDate.value);
  const timeDiff = end.getTime() - start.getTime();
  const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

  result.value = {
    startDate: startDate.value,
    endDate: endDate.value,
    days: daysDiff,
    details: `从起始日期到结束日期共${daysDiff}天`,
  };
}

function calculateWorkingDaysResult() {
  result.value = calculateWorkingDays(startDate.value, endDate.value);
}

function calculateLimitationPeriodResult() {
  result.value = calculateLimitationPeriod(startDate.value, limitationType.value);
}

// 初始化
onMounted(() => {
  // 初始化日期为今天
  startDate.value = formatDate(new Date());
  endDate.value = formatDate(new Date(new Date().setDate(new Date().getDate() + 30)));
});
</script>

<style scoped>
/* 自定义样式 */
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
