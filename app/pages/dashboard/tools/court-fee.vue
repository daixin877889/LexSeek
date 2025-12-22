<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">诉讼费用计算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <img src="@/assets/icon/help.svg" alt="帮助" class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-white rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">诉讼费用计算指引</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <img src="@/assets/icon/close.svg" alt="关闭" class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">诉讼费用分类：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li><strong>受理费</strong>：包括财产案件、非财产案件、知识产权民事案件、劳动争议案件、行政案件等</li>
                <li><strong>申请费</strong>：包括申请执行、申请保全、申请支付令、申请公示催告等</li>
                <li><strong>其他费用</strong>：案件管辖权异议费、破产费等</li>
              </ul>
            </div>

            <div class="bg-muted/30 p-2 rounded">
              <p><strong>提示：</strong>本计算器结果仅供参考，实际诉讼费用应以法院收取为准。</p>
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
                <label class="text-sm font-medium leading-none">金额（元）</label>
                <Input type="number" v-model.number="amount" placeholder="请输入争议金额/执行金额" class="mt-1.5"
                  @input="convertToChinese" />
                <small class="text-xs text-muted-foreground mt-1 block" v-if="chineseAmount">大写：{{ chineseAmount
                }}</small>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">费用类型</label>
                <Select v-model="feeTypeLevel1" @update:model-value="resetSubTypes" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择费用类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caseFee">受理费</SelectItem>
                    <SelectItem value="applicationFee">申请费</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 受理费子类型 -->
              <div v-if="feeTypeLevel1 === 'caseFee'">
                <label class="text-sm font-medium leading-none">受理费类型</label>
                <Select v-model="caseFeeType" @update:model-value="resetLevel3Types" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择受理费类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="property">（一）财产案件</SelectItem>
                    <SelectItem value="nonProperty">（二）非财产案件</SelectItem>
                    <SelectItem value="intellectualProperty">（三）知识产权民事案件</SelectItem>
                    <SelectItem value="labor">（四）劳动争议案件</SelectItem>
                    <SelectItem value="administrative">（五）行政案件</SelectItem>
                    <SelectItem value="jurisdiction">（六）当事人提出案件管辖权异议</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 申请费子类型 -->
              <div v-if="feeTypeLevel1 === 'applicationFee'">
                <label class="text-sm font-medium leading-none">申请费类型</label>
                <Select v-model="applicationFeeType" @update:model-value="resetLevel3Types" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择申请费类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="execution">（一）申请执行</SelectItem>
                    <SelectItem value="preservation">（二）申请保全</SelectItem>
                    <SelectItem value="paymentOrder">（三）申请支付令</SelectItem>
                    <SelectItem value="publicNotice">（四）申请公示催告</SelectItem>
                    <SelectItem value="arbitration">（五）申请撤销仲裁裁决或认定仲裁协议效力</SelectItem>
                    <SelectItem value="bankruptcy">（六）申请破产</SelectItem>
                    <SelectItem value="maritime">（七）海事案件申请</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 非财产案件子类型 -->
              <div v-if="feeTypeLevel1 === 'caseFee' && caseFeeType === 'nonProperty'">
                <label class="text-sm font-medium leading-none">非财产案件类型</label>
                <Select v-model="nonPropertyType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择非财产案件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="divorce">1.离婚案件</SelectItem>
                    <SelectItem value="personality">2.侵姓名权、名称权、肖像权、名誉权等人格权案件</SelectItem>
                    <SelectItem value="other">3.其他非财产案件</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 离婚案件特殊设置 -->
              <div v-if="feeTypeLevel1 === 'caseFee' && caseFeeType === 'nonProperty' && nonPropertyType === 'divorce'">
                <label class="text-sm font-medium leading-none">是否涉及财产分割</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" id="hasProperty" v-model="hasProperty" />
                  </div>
                  <label for="hasProperty">{{ hasProperty ? "是" : "否" }}</label>
                </div>
              </div>

              <!-- 人格权案件特殊设置 -->
              <div
                v-if="feeTypeLevel1 === 'caseFee' && caseFeeType === 'nonProperty' && nonPropertyType === 'personality'">
                <label class="text-sm font-medium leading-none">是否涉及损害赔偿</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" id="hasDamages" v-model="hasDamages" />
                  </div>
                  <label for="hasDamages">{{ hasDamages ? "是" : "否" }}</label>
                </div>
              </div>

              <!-- 知识产权案件特殊设置 -->
              <div v-if="feeTypeLevel1 === 'caseFee' && caseFeeType === 'intellectualProperty'">
                <label class="text-sm font-medium leading-none">是否有争议金额或价额</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" id="hasDisputeAmount" v-model="hasDisputeAmount" />
                  </div>
                  <label for="hasDisputeAmount">{{ hasDisputeAmount ? "是" : "否" }}</label>
                </div>
              </div>

              <!-- 行政案件特殊设置 -->
              <div v-if="feeTypeLevel1 === 'caseFee' && caseFeeType === 'administrative'">
                <label class="text-sm font-medium leading-none">行政案件类型</label>
                <Select v-model="administrativeType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择行政案件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="special">商标、专利、海事行政案件</SelectItem>
                    <SelectItem value="general">其他行政案件</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- 申请执行特殊设置 -->
              <div v-if="feeTypeLevel1 === 'applicationFee' && applicationFeeType === 'execution'">
                <label class="text-sm font-medium leading-none">是否有执行金额或价额</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" id="hasExecutionAmount" v-model="hasExecutionAmount" />
                  </div>
                  <label for="hasExecutionAmount">{{ hasExecutionAmount ? "是" : "否" }}</label>
                </div>
              </div>

              <!-- 申请保全特殊设置 -->
              <div v-if="feeTypeLevel1 === 'applicationFee' && applicationFeeType === 'preservation'">
                <label class="text-sm font-medium leading-none">是否涉及财产</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" id="hasPreservationProperty" v-model="hasPreservationProperty" />
                  </div>
                  <label for="hasPreservationProperty">{{ hasPreservationProperty ? "是" : "否" }}</label>
                </div>
              </div>

              <!-- 海事案件特殊设置 -->
              <div v-if="feeTypeLevel1 === 'applicationFee' && applicationFeeType === 'maritime'">
                <label class="text-sm font-medium leading-none">海事申请类型</label>
                <Select v-model="maritimeType" class="mt-1.5">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="请选择海事申请类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fund">1.申请设立海事赔偿责任限制基金</SelectItem>
                    <SelectItem value="order">2.申请海事强制令</SelectItem>
                    <SelectItem value="notice">3.申请船舶优先权催告</SelectItem>
                    <SelectItem value="register">4.申请海事债权登记</SelectItem>
                    <SelectItem value="average">5.申请共同海损理算</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Alert class="block">
                <div class="text-sm"><strong>当前选择：</strong> {{ getCurrentSelectionText() }}</div>
              </Alert>

              <div class="mt-2">
                <Button class="w-full h-10" @click="calculateFee">计算诉讼费用</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border">
          <CardHeader>
            <CardTitle>诉讼费用计算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert class="mb-4 block">
              <div class="flex justify-between items-center mb-1">
                <span>争议/执行金额：</span>
                <span class="font-semibold">{{ formatCurrency(amount) }} 元</span>
              </div>
              <div class="flex justify-between items-center">
                <span>计算类型：</span>
                <span class="font-semibold">{{ getCurrentSelectionText() }}</span>
              </div>
            </Alert>

            <Alert variant="success" class="mb-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">应缴纳诉讼费用：</span>
                <span class="text-lg font-bold">{{ formatCurrency(result.totalFee) }} 元</span>
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
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算诉讼费用"按钮查看结果</p>
          </div>
        </div>

        <Card class="mt-4 shadow-none border">
          <CardHeader>
            <CardTitle>注意事项</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="text-sm space-y-2">
              <p>1. 本计算器根据《诉讼费用交纳办法》提供计算结果，仅供参考。</p>
              <p>2. 实际诉讼费用可能因地区差异和案件特殊情况有所不同，请以法院实际收取为准。</p>
              <p>3. 如有疑问，请咨询专业律师或法院立案庭。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "诉讼费用计算",
  layout: "dashboard",
});
import { calculateCourtFee } from "#shared/utils/tools/courtFeeService";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Alert } from "@/components/ui/alert";
// import { Checkbox } from "@/components/ui/checkbox";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// 基本数据
const amount = ref(10000);
const chineseAmount = ref("");
const feeTypeLevel1 = ref("caseFee");
const caseFeeType = ref("property");
const applicationFeeType = ref("execution");
const nonPropertyType = ref("divorce");
const hasProperty = ref(false);
const hasDamages = ref(false);
const hasDisputeAmount = ref(true);
const administrativeType = ref("general");
const hasExecutionAmount = ref(true);
const hasPreservationProperty = ref(true);
const maritimeType = ref("fund");
const result = ref(null);
const isHelpOpen = ref(false);

// 格式化金额
function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

// 获取当前选择文本
function getCurrentSelectionText() {
  if (feeTypeLevel1.value === "caseFee") {
    let text = "受理费 - ";

    switch (caseFeeType.value) {
      case "property":
        return text + "财产案件";
      case "nonProperty":
        text += "非财产案件 - ";
        if (nonPropertyType.value === "divorce") {
          return text + "离婚案件" + (hasProperty.value ? "(涉及财产分割)" : "(不涉及财产分割)");
        } else if (nonPropertyType.value === "personality") {
          return text + "人格权案件" + (hasDamages.value ? "(涉及损害赔偿)" : "(不涉及损害赔偿)");
        } else {
          return text + "其他非财产案件";
        }
      case "intellectualProperty":
        return text + "知识产权民事案件" + (hasDisputeAmount.value ? "(有争议金额)" : "(无争议金额)");
      case "labor":
        return text + "劳动争议案件";
      case "administrative":
        return text + "行政案件 - " + (administrativeType.value === "special" ? "商标、专利、海事行政案件" : "其他行政案件");
      case "jurisdiction":
        return text + "当事人提出案件管辖权异议";
      default:
        return text;
    }
  } else {
    let text = "申请费 - ";

    switch (applicationFeeType.value) {
      case "execution":
        return text + "申请执行" + (hasExecutionAmount.value ? "(有执行金额)" : "(无执行金额)");
      case "preservation":
        return text + "申请保全" + (hasPreservationProperty.value ? "(涉及财产)" : "(不涉及财产)");
      case "paymentOrder":
        return text + "申请支付令";
      case "publicNotice":
        return text + "申请公示催告";
      case "arbitration":
        return text + "申请撤销仲裁裁决或认定仲裁协议效力";
      case "bankruptcy":
        return text + "申请破产";
      case "maritime":
        text += "海事案件申请 - ";
        switch (maritimeType.value) {
          case "fund":
            return text + "设立海事赔偿责任限制基金";
          case "order":
            return text + "申请海事强制令";
          case "notice":
            return text + "申请船舶优先权催告";
          case "register":
            return text + "申请海事债权登记";
          case "average":
            return text + "申请共同海损理算";
          default:
            return text;
        }
      default:
        return text;
    }
  }
}

// 转换为中文大写金额
function convertToChinese() {
  if (!amount.value) {
    chineseAmount.value = "";
    return;
  }

  chineseAmount.value = toChineseBig(amount.value);
}

function toChineseBig(num) {
  if (num >= 1000000000000) {
    return "大于一万亿";
  }

  const strNum = String(num);
  const unit = ["", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿", "拾", "佰", "仟"];
  const chineseBigNum = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];

  let result = [];
  let unitNo = 0;
  let zeroCount = 0;

  for (let i = strNum.length - 1; i >= 0; i--) {
    const currentNum = strNum[i];
    if (currentNum === "0") {
      zeroCount++;
    } else {
      if (zeroCount > 0) {
        result.unshift("零");
        zeroCount = 0;
      }
      result.unshift(unit[unitNo]);
      result.unshift(chineseBigNum[parseInt(currentNum, 10)]);
    }
    unitNo++;
  }

  return result
    .join("")
    .replace(/零{2,}/g, "零")
    .replace(/零([万亿])/g, "$1")
    .replace(/亿万/g, "亿")
    .replace(/零+$/g, "")
    .replace(/^壹拾/, "拾");
}

// 重置子类型
function resetSubTypes() {
  if (feeTypeLevel1.value === "caseFee") {
    caseFeeType.value = "property";
  } else {
    applicationFeeType.value = "execution";
  }
  resetLevel3Types();
}

// 重置三级类型
function resetLevel3Types() {
  nonPropertyType.value = "divorce";
  hasProperty.value = false;
  hasDamages.value = false;
  hasDisputeAmount.value = true;
  administrativeType.value = "general";
  hasExecutionAmount.value = true;
  hasPreservationProperty.value = true;
  maritimeType.value = "fund";
}

// 计算诉讼费用
function calculateFee() {
  if (feeTypeLevel1.value === "caseFee") {
    calculateCaseFee();
  } else {
    calculateApplicationFee();
  }
}

// 计算案件受理费
function calculateCaseFee() {
  let options = {};

  switch (caseFeeType.value) {
    case "property":
      if (!amount.value || amount.value <= 0) {
        alert("请输入有效的争议金额");
        return;
      }
      break;
    case "nonProperty":
      options.nonPropertyType = nonPropertyType.value;
      if (nonPropertyType.value === "divorce") {
        options.hasProperty = hasProperty.value;
        if (hasProperty.value && (!amount.value || amount.value <= 0)) {
          alert("请输入有效的财产分割金额");
          return;
        }
      } else if (nonPropertyType.value === "personality") {
        options.hasDamages = hasDamages.value;
        if (hasDamages.value && (!amount.value || amount.value <= 0)) {
          alert("请输入有效的损害赔偿金额");
          return;
        }
      }
      break;
    case "intellectualProperty":
      options.hasDisputeAmount = hasDisputeAmount.value;
      if (hasDisputeAmount.value && (!amount.value || amount.value <= 0)) {
        alert("请输入有效的争议金额");
        return;
      }
      break;
    case "administrative":
      options.administrativeType = administrativeType.value;
      break;
  }

  result.value = calculateCourtFee("caseFee", caseFeeType.value, amount.value, options);
}

// 计算申请费
function calculateApplicationFee() {
  let options = {};

  switch (applicationFeeType.value) {
    case "execution":
      options.hasExecutionAmount = hasExecutionAmount.value;
      if (hasExecutionAmount.value && (!amount.value || amount.value <= 0)) {
        alert("请输入有效的执行金额");
        return;
      }
      break;
    case "preservation":
      options.hasPreservationProperty = hasPreservationProperty.value;
      if (hasPreservationProperty.value && (!amount.value || amount.value <= 0)) {
        alert("请输入有效的财产金额");
        return;
      }
      break;
    case "maritime":
      options.maritimeType = maritimeType.value;
      if (maritimeType.value === "fund" && (!amount.value || amount.value <= 0)) {
        alert("请输入有效的基金金额");
        return;
      }
      break;
  }

  result.value = calculateCourtFee("applicationFee", applicationFeeType.value, amount.value, options);
}

// 初始化
convertToChinese();
</script>

<style scoped>
/* 自定义checkbox样式 */
.custom-checkbox {
  position: relative;
  width: 20px;
  height: 20px;
}
</style>
