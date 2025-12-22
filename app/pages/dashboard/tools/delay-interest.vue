<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">迟延履行利息计算器</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <img src="@/assets/icon/help.svg" alt="帮助" class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-white rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">功能说明</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <img src="@/assets/icon/close.svg" alt="关闭" class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">迟延履行利息说明：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li><strong>自动分段计算</strong>：系统将根据日期自动采用对应的计算标准</li>
                <li><strong>LPR利率</strong>：2019年8月20日后按照一年期贷款市场报价利率(LPR)的4倍计算</li>
                <li><strong>基准利率</strong>：2019年8月20日前按照中国人民银行同期同类贷款基准利率的1.5倍计算</li>
              </ul>
            </div>

            <div class="bg-destructive/10 p-2 rounded text-destructive">
              <p><strong>注意：</strong>根据《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》，2019年8月20日前后的迟延履行利息计算标准有所不同。系统会自动判断日期并应用相应的计算标准。</p>
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
              <!-- 本金输入 -->
              <div>
                <label class="text-sm font-medium leading-none">本金（元）</label>
                <Input type="number" v-model="principal" placeholder="请输入本金金额" class="mt-1.5" @input="convertToChinese" />
                <p v-if="chineseAmount" class="text-xs text-muted-foreground mt-1">大写：{{ chineseAmount }}</p>
              </div>

              <!-- 日期选择 -->
              <div>
                <label class="text-sm font-medium leading-none">计息开始日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="startDate" class="w-full pl-10" />
                  </div>
                </div>
                <p v-if="startDate && new Date(startDate) < new Date('2014-01-01')" class="text-xs text-yellow-500 mt-1"><AlertTriangleIcon class="h-3 w-3 inline-block mr-1" />您选择的日期较早，请确认是否需要从这个日期开始计算。</p>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">计息结束日期</label>
                <div class="relative mt-1.5">
                  <div class="date-input-wrapper">
                    <CalendarIcon class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input type="date" v-model="endDate" class="w-full pl-10" />
                  </div>
                </div>
                <p v-if="endDate && new Date(endDate) > new Date(new Date().setFullYear(new Date().getFullYear() + 3))" class="text-xs text-yellow-500 mt-1"><AlertTriangleIcon class="h-3 w-3 inline-block mr-1" />您选择的结束日期较远，系统将使用最新利率进行估算。</p>
              </div>

              <!-- 年天数选择 -->
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
        <Card v-if="result" class="shadow-none border">
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
            <Alert v-if="result.details && result.details.length > 0 && result.details[2]?.includes('跨越')" class="mb-4 block">
              <p class="mb-1">
                <strong>计算说明：</strong>本次计算从<strong>{{ result.startDate }}</strong
                >开始，跨越了2019年8月20日的利率政策变更点，系统自动分段计算：
              </p>
              <ul class="list-disc list-inside space-y-1 pl-2">
                <li>
                  第一阶段：<strong>{{ result.startDate }}</strong> 至 2019-08-19，使用人民银行基准利率的1.5倍计算
                </li>
                <li>第二阶段：2019-08-20 至 {{ result.endDate }}，使用LPR利率的4倍计算</li>
              </ul>
              <p class="text-xs text-muted-foreground mt-1">注：根据《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》进行计算</p>
            </Alert>

            <Alert v-else class="mb-4 block">
              <p>
                <strong>计算说明：</strong>
                本次计算使用
                <span v-if="isAfterLPRDate(result.startDate)">LPR利率的4倍</span>
                <span v-else>人民银行基准利率的1.5倍</span>
                计算 <strong>{{ result.startDate }}</strong> 至 {{ result.endDate }} 期间的迟延履行利息
              </p>
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

            <!-- 详细结果 -->
            <Accordion type="single" collapsible class="w-full">
              <!-- 计息明细 -->
              <AccordionItem value="interest-details">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">计息明细</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="overflow-x-auto">
                    <table class="w-full border-collapse">
                      <thead>
                        <tr class="bg-muted/50">
                          <th class="p-2 text-left border">计息区间</th>
                          <th class="p-2 text-left border">基础利率</th>
                          <th class="p-2 text-left border">计算利率</th>
                          <th class="p-2 text-left border">计息天数</th>
                          <th class="p-2 text-left border">利息金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        <!-- 使用interestDetails字段显示明细，按照相同利率合并 -->
                        <template v-if="result && result.interestDetails && result.interestDetails.length > 0">
                          <tr v-for="(detail, index) in mergeDetailsByRate(result.interestDetails)" :key="index" class="border-b hover:bg-muted/20">
                            <td class="p-2 border">{{ detail.startDate }} 至 {{ detail.endDate }}</td>
                            <td class="p-2 border">{{ detail.rate.toFixed(2) }}%</td>
                            <td class="p-2 border">{{ detail.adjustedRate.toFixed(2) }}%</td>
                            <td class="p-2 border">{{ detail.days }}天</td>
                            <td class="p-2 border">{{ formatCurrency(detail.interest) }}元</td>
                          </tr>
                          <tr class="font-semibold bg-primary/10">
                            <td class="p-2 border" colspan="3"><strong>合计</strong></td>
                            <td class="p-2 border">
                              <strong>{{ result.days }}天</strong>
                            </td>
                            <td class="p-2 border">
                              <strong>{{ formatCurrency(result.totalInterest) }}元</strong>
                            </td>
                          </tr>
                        </template>
                        <!-- 兼容无interestDetails情况，可能是旧版结果格式 -->
                        <template v-else-if="result && result.details">
                          <!-- 跨越2019年8月20日的情况 -->
                          <template v-if="result.details.length > 5 && result.details[2].includes('跨越')">
                            <tr class="border-b hover:bg-muted/20">
                              <td class="p-2 border">{{ result.startDate }} 至 2019-08-19</td>
                              <td class="p-2 border">{{ extractBaseRate(result.details, 0) }}%</td>
                              <td class="p-2 border">{{ extractAdjustedRate(result.details, 0) }}%</td>
                              <td class="p-2 border">{{ extractDaysFromDetails(result.details, 0) }}天</td>
                              <td class="p-2 border">{{ extractInterestFromDetails(result.details, 0) }}元</td>
                            </tr>
                            <tr class="border-b hover:bg-muted/20">
                              <td class="p-2 border">2019-08-20 至 {{ result.endDate }}</td>
                              <td class="p-2 border">{{ extractBaseRate(result.details, 1) }}%</td>
                              <td class="p-2 border">{{ extractAdjustedRate(result.details, 1) }}%</td>
                              <td class="p-2 border">{{ extractDaysFromDetails(result.details, 1) }}天</td>
                              <td class="p-2 border">{{ extractInterestFromDetails(result.details, 1) }}元</td>
                            </tr>
                            <tr class="font-semibold bg-primary/10">
                              <td class="p-2 border" colspan="3"><strong>合计</strong></td>
                              <td class="p-2 border">
                                <strong>{{ result.days }}天</strong>
                              </td>
                              <td class="p-2 border">
                                <strong>{{ formatCurrency(result.totalInterest) }}元</strong>
                              </td>
                            </tr>
                          </template>
                          <!-- 其他情况，只有一个计算阶段 -->
                          <template v-else>
                            <tr class="border-b hover:bg-muted/20">
                              <td class="p-2 border">{{ result.startDate }} 至 {{ result.endDate }}</td>
                              <td class="p-2 border">{{ extractBaseRate(result.details, -1) }}%</td>
                              <td class="p-2 border">{{ extractAdjustedRate(result.details, -1) }}%</td>
                              <td class="p-2 border">{{ result.days }}天</td>
                              <td class="p-2 border">{{ formatCurrency(result.totalInterest) }}元</td>
                            </tr>
                          </template>
                        </template>
                      </tbody>
                    </table>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 计算明细 -->
              <AccordionItem value="calculation-details" v-if="result.details && result.details.length > 0">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">计算过程</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="bg-muted/30 p-4 rounded font-mono text-sm whitespace-pre-wrap wrap-break-word">
                    {{ result.details.join("\n") }}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <!-- 空状态 -->
        <div v-if="!result" class="h-full flex items-center justify-center rounded-lg border border-dashed p-8">
          <div class="text-center">
            <div class="text-muted-foreground mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 opacity-50">
                <path d="M11.7 2C7.5 2 4 5.5 4 9.7v.2C4 14.5 7.5 18 11.7 18h.2c4.2 0 7.7-3.5 7.7-7.7v-.1C19.6 5.6 16.4 2 11.7 2Z" />
                <path d="M12 18v4" />
                <path d="M8 22h8" />
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
  title: "延迟履行利息",
  layout: "dashboard-layout",
});

import { CalendarIcon, AlertTriangleIcon } from "lucide-vue-next";
import { calculateDelayInterest } from "#shared/utils/tools/delayInterestService";
import { formatDate, daysBetween } from "#shared/utils/tools/utils/date";
import { exportDelayInterestToExcel } from "#shared/utils/tools/utils/excelExport";

// 状态管理
const isHelpOpen = ref(false);
const principal = ref(100000);
const yearDays = ref(365);
const chineseAmount = ref("");
const startDate = ref(formatDate(new Date(new Date().setFullYear(new Date().getFullYear() - 1))));
const endDate = ref(formatDate(new Date()));
const result = ref(null);

// 检查日期是否在LPR起始日期之后
function isAfterLPRDate(dateStr) {
  return new Date(dateStr) >= new Date("2019-08-20");
}

// 方法
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

function calculateInterest() {
  if (!startDate.value || !endDate.value || !principal.value) {
    toast.error("请填写完整信息后再计算");
    return;
  }

  const principalValue = parseFloat(principal.value);
  const startDateValue = startDate.value;
  const endDateValue = endDate.value;

  // 检查日期顺序
  if (new Date(startDateValue) > new Date(endDateValue)) {
    toast.error("开始日期不能晚于结束日期");
    return;
  }

  logger.debug("计算参数:", {
    本金: principalValue,
    开始日期: startDateValue,
    结束日期: endDateValue,
    年天数: yearDays.value,
  });

  // 使用迟延履行利息计算函数 - 始终使用自动分段计算
  const calculationResult = calculateDelayInterest(principalValue, startDateValue, endDateValue, yearDays.value);
  logger.debug("迟延履行利息计算结果:", calculationResult);

  // 更新计算结果
  result.value = calculationResult;
}

function exportToExcel() {
  if (!result.value) return;
  exportDelayInterestToExcel(result.value);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(parseFloat(value).toFixed(2));
}

// 从计算明细中提取天数信息
function extractDaysFromDetails(details, segment) {
  try {
    if (segment === 0) {
      // 提取第一段天数，格式: "- 2019年8月20日前XX天："
      const match = details[3].match(/(\d+)天/);
      return match ? match[1] : "0";
    } else {
      // 提取第二段天数，格式: "- 2019年8月20日后XX天："
      const match = details[6].match(/(\d+)天/);
      return match ? match[1] : "0";
    }
  } catch (e) {
    logger.error("提取天数失败", e);
    return "0";
  }
}

// 从计算明细中提取利息金额
function extractInterestFromDetails(details, segment) {
  try {
    if (segment === 0) {
      // 提取第一段利息，格式: "计算公式：... = XX.XX元"
      const match = details[5].match(/= (\d+\.\d+)元/);
      return match ? match[1] : "0";
    } else {
      // 提取第二段利息，格式: "计算公式：... = XX.XX元"
      const match = details[8].match(/= (\d+\.\d+)元/);
      return match ? match[1] : "0";
    }
  } catch (e) {
    logger.error("提取利息失败", e);
    return "0.00";
  }
}

// 从计算明细中提取基础利率
function extractBaseRate(details, segment) {
  try {
    if (segment === -1) {
      // 单阶段计算
      if (details[2].includes("LPR")) {
        const match = details[3].match(/LPR利率：(\d+\.?\d*)%/);
        return match ? match[1] : "0";
      } else {
        const match = details[3].match(/基准利率：(\d+\.?\d*)%/);
        return match ? match[1] : "0";
      }
    } else if (segment === 0) {
      // 提取第一段基础利率
      const match = details[4].match(/基准利率：(\d+\.?\d*)%/);
      return match ? match[1] : "0";
    } else {
      // 提取第二段基础利率
      const match = details[7].match(/LPR利率：(\d+\.?\d*)%/);
      return match ? match[1] : "0";
    }
  } catch (e) {
    logger.error("提取基础利率失败", e);
    return "0";
  }
}

// 从计算明细中提取调整后利率
function extractAdjustedRate(details, segment) {
  try {
    if (segment === -1) {
      // 单阶段计算
      if (details[2].includes("LPR")) {
        const match = details[3].match(/迟延履行利率：(\d+\.?\d*)%/);
        return match ? match[1] : "0";
      } else {
        const match = details[3].match(/迟延履行利率：(\d+\.?\d*)%/);
        return match ? match[1] : "0";
      }
    } else if (segment === 0) {
      // 提取第一段调整利率
      const match = details[4].match(/迟延履行利率：(\d+\.?\d*)%/);
      return match ? match[1] : "0";
    } else {
      // 提取第二段调整利率
      const match = details[7].match(/迟延履行利率：(\d+\.?\d*)%/);
      return match ? match[1] : "0";
    }
  } catch (e) {
    logger.error("提取调整后利率失败", e);
    return "0";
  }
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

      // 如果当前项和下一项的利率相同，则合并它们
      if (Math.abs(detail.adjustedRate - nextDetail.adjustedRate) < 0.00001) {
        // 开始一个新的组
        let group = {
          startDate: detail.startDate,
          endDate: detail.endDate,
          days: detail.days,
          rate: detail.rate,
          adjustedRate: detail.adjustedRate,
          interest: detail.interest,
        };

        // 向后合并所有具有相同利率的项
        let j = i + 1;
        while (j < details.length && Math.abs(details[j].adjustedRate - detail.adjustedRate) < 0.00001) {
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
          adjustedRate: detail.adjustedRate,
          interest: detail.interest,
        });
      }
    } else {
      // 最后一项，检查是否能与前一个组合并
      if (mergedDetails.length > 0 && Math.abs(mergedDetails[mergedDetails.length - 1].adjustedRate - detail.adjustedRate) < 0.00001) {
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
          adjustedRate: detail.adjustedRate,
          interest: detail.interest,
        });
      }
    }
  }

  return mergedDetails;
}

// 监听变化
watch(
  () => principal.value,
  () => {
    convertToChinese();
  }
);

// 组件挂载时执行
onMounted(() => {
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
