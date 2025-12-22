<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">社保追缴计算</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <img src="@/assets/icon/help.svg" alt="帮助" class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-white rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">社保追缴计算指引</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <img src="@/assets/icon/close.svg" alt="关闭" class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">如何查询原缴纳基数？</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>登录当地社保官网，查看"缴费基数"</li>
                <li>支付宝/微信搜"社保查询"，绑定后查看</li>
                <li>查看工资条或联系企业HR</li>
              </ul>
            </div>

            <div>
              <h4 class="font-semibold mb-1">费率说明（以下为参考值）：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>养老保险：单位16%，个人8%</li>
                <li>医疗保险：单位8%，个人2%</li>
                <li>失业保险：单位1.5%，个人0.5%</li>
                <li>工伤保险：单位0.5%，个人0%</li>
                <li>生育保险：单位1%，个人0%</li>
                <li>住房公积金：单位7%，个人7%</li>
              </ul>
            </div>

            <div class="bg-muted/30 p-2 rounded">
              <p><strong>提示：</strong>企业有义务提供缴费记录（依据《社会保险法》第74条）。该工具仅供参考，实际费率请以当地政策为准。</p>
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
                <label class="text-sm font-medium leading-none">月工资（元）</label>
                <Input type="number" v-model.number="monthlySalary" placeholder="请输入月工资金额" class="mt-1.5" />
              </div>

              <div>
                <label class="text-sm font-medium leading-none">追缴月数</label>
                <Input type="number" v-model.number="months" placeholder="请输入需要追缴的月数" class="mt-1.5" />
              </div>

              <div>
                <label class="text-sm font-medium leading-none">是否包含单位部分</label>
                <div class="flex items-center space-x-2 mt-1.5">
                  <div class="custom-checkbox">
                    <Checkbox class="w-5 h-5" type="checkbox" id="includeEmployerPart" v-model="includeEmployerPart" />
                  </div>
                  <label for="includeEmployerPart">{{ includeEmployerPart ? "包含单位部分" : "仅计算个人部分" }}</label>
                </div>
              </div>
            </div>

            <!-- <pre class="text-xs mt-2">DEBUG: includeEmployerPart = {{ includeEmployerPart }}</pre> -->

            <Separator class="my-6" />

            <h3 class="text-xl font-semibold mb-4">缴费比例设置</h3>

            <Accordion type="single" collapsible class="w-full">
              <!-- 养老保险 -->
              <AccordionItem value="pension">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>养老保险费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.pension.employee }}% 单位: {{ rates.pension.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.pension.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.pension.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 医疗保险 -->
              <AccordionItem value="medical">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>医疗保险费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.medical.employee }}% 单位: {{ rates.medical.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.medical.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.medical.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 失业保险 -->
              <AccordionItem value="unemployment">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>失业保险费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.unemployment.employee }}% 单位: {{ rates.unemployment.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.unemployment.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.unemployment.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 工伤保险 -->
              <AccordionItem value="injury">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>工伤保险费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.injury.employee }}% 单位: {{ rates.injury.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.injury.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.injury.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 生育保险 -->
              <AccordionItem value="maternity">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>生育保险费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.maternity.employee }}% 单位: {{ rates.maternity.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.maternity.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.maternity.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 住房公积金 -->
              <AccordionItem value="housing">
                <AccordionTrigger>
                  <div class="flex items-center gap-2">
                    <span>住房公积金费率</span>
                    <span class="text-sm text-muted-foreground">(个人: {{ rates.housing.employee }}% 单位: {{ rates.housing.employer }}%)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium leading-none">个人缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.housing.employee" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                    <div>
                      <label class="text-sm font-medium leading-none">单位缴纳比例（%）</label>
                      <Input type="number" v-model.number="rates.housing.employer" step="0.1" min="0" max="100" class="mt-1.5" />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div class="mt-6">
              <Button class="w-full h-10" @click="calculate">计算追缴金额</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border">
          <CardHeader>
            <CardTitle>追缴金额计算结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert class="mb-4 block">
              <div class="flex justify-between items-center mb-1">
                <span>月工资：</span>
                <span class="font-semibold">{{ formatCurrency(monthlySalary) }} 元</span>
              </div>
              <div class="flex justify-between items-center">
                <span>追缴月数：</span>
                <span class="font-semibold">{{ months }} 个月</span>
              </div>
              <div class="flex justify-between items-center">
                <span>计算方式：</span>
                <span class="font-semibold">{{ calculatedWithEmployerPart ? "包含单位部分" : "仅计算个人部分" }}</span>
              </div>
            </Alert>

            <Alert variant="success" class="mb-4 border border-primary block">
              <div class="flex justify-between items-center">
                <span class="text-lg font-bold">追缴总额：</span>
                <span class="text-lg font-bold">{{ formatCurrency(calculatedTotalAmount) }} 元</span>
              </div>
            </Alert>

            <Accordion type="single" collapsible class="w-full space-y-2">
              <!-- 个人缴纳部分 -->
              <AccordionItem value="employee-part">
                <AccordionTrigger>
                  <div class="flex w-full justify-between items-center">
                    <h3 class="text-lg font-semibold">个人缴纳部分</h3>
                    <span class="text-base font-medium">{{ formatCurrency(result.employeePart.total) }} 元</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center" v-if="rates.pension.employee > 0">
                      <span>养老保险（{{ rates.pension.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.pension) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.medical.employee > 0">
                      <span>医疗保险（{{ rates.medical.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.medical) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.unemployment.employee > 0">
                      <span>失业保险（{{ rates.unemployment.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.unemployment) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.injury.employee > 0">
                      <span>工伤保险（{{ rates.injury.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.injury) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.maternity.employee > 0">
                      <span>生育保险（{{ rates.maternity.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.maternity) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.housing.employee > 0">
                      <span>住房公积金（{{ rates.housing.employee }}%）：</span>
                      <span>{{ formatCurrency(result.employeePart.housing) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center font-semibold pt-2 border-t">
                      <span>个人缴纳总额：</span>
                      <span>{{ formatCurrency(result.employeePart.total) }} 元</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 单位缴纳部分 -->
              <AccordionItem v-if="calculatedWithEmployerPart" value="employer-part">
                <AccordionTrigger>
                  <div class="flex w-full justify-between items-center">
                    <h3 class="text-lg font-semibold">单位缴纳部分</h3>
                    <span class="text-base font-medium">{{ formatCurrency(result.employerPart.total) }} 元</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center" v-if="rates.pension.employer > 0">
                      <span>养老保险（{{ rates.pension.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.pension) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.medical.employer > 0">
                      <span>医疗保险（{{ rates.medical.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.medical) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.unemployment.employer > 0">
                      <span>失业保险（{{ rates.unemployment.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.unemployment) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.injury.employer > 0">
                      <span>工伤保险（{{ rates.injury.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.injury) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.maternity.employer > 0">
                      <span>生育保险（{{ rates.maternity.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.maternity) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center" v-if="rates.housing.employer > 0">
                      <span>住房公积金（{{ rates.housing.employer }}%）：</span>
                      <span>{{ formatCurrency(result.employerPart.housing) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center font-semibold pt-2 border-t">
                      <span>单位缴纳总额：</span>
                      <span>{{ formatCurrency(result.employerPart.total) }} 元</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 计算明细 -->
              <AccordionItem value="calculation-details">
                <AccordionTrigger>
                  <h3 class="text-lg font-semibold">计算明细</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="bg-muted/50 p-4 rounded text-sm">
                    <!-- 基本信息 -->
                    <div class="mb-1">月工资：{{ monthlySalary }}元</div>
                    <div class="mb-1">追缴月数：{{ months }}个月</div>
                    <div class="mb-1"></div>

                    <!-- 个人缴纳部分 -->
                    <div class="mb-1">个人缴纳部分：</div>
                    <div class="mb-1" v-if="rates.pension.employee > 0">- 养老保险：{{ monthlySalary }}元 × {{ rates.pension.employee }}% × {{ months }}个月 = {{ result.employeePart.pension.toFixed(2) }}元</div>
                    <div class="mb-1" v-if="rates.medical.employee > 0">- 医疗保险：{{ monthlySalary }}元 × {{ rates.medical.employee }}% × {{ months }}个月 = {{ result.employeePart.medical.toFixed(2) }}元</div>
                    <div class="mb-1" v-if="rates.unemployment.employee > 0">- 失业保险：{{ monthlySalary }}元 × {{ rates.unemployment.employee }}% × {{ months }}个月 = {{ result.employeePart.unemployment.toFixed(2) }}元</div>
                    <div class="mb-1" v-if="rates.injury.employee > 0">- 工伤保险：{{ monthlySalary }}元 × {{ rates.injury.employee }}% × {{ months }}个月 = {{ result.employeePart.injury.toFixed(2) }}元</div>
                    <div class="mb-1" v-if="rates.maternity.employee > 0">- 生育保险：{{ monthlySalary }}元 × {{ rates.maternity.employee }}% × {{ months }}个月 = {{ result.employeePart.maternity.toFixed(2) }}元</div>
                    <div class="mb-1" v-if="rates.housing.employee > 0">- 住房公积金：{{ monthlySalary }}元 × {{ rates.housing.employee }}% × {{ months }}个月 = {{ result.employeePart.housing.toFixed(2) }}元</div>
                    <div class="mb-1">个人缴纳总额：{{ result.employeePart.total.toFixed(2) }}元</div>

                    <!-- 单位缴纳部分（如果包含） -->
                    <template v-if="calculatedWithEmployerPart">
                      <div class="mb-1"></div>
                      <div class="mb-1">单位缴纳部分：</div>
                      <div class="mb-1" v-if="rates.pension.employer > 0">- 养老保险：{{ monthlySalary }}元 × {{ rates.pension.employer }}% × {{ months }}个月 = {{ result.employerPart.pension.toFixed(2) }}元</div>
                      <div class="mb-1" v-if="rates.medical.employer > 0">- 医疗保险：{{ monthlySalary }}元 × {{ rates.medical.employer }}% × {{ months }}个月 = {{ result.employerPart.medical.toFixed(2) }}元</div>
                      <div class="mb-1" v-if="rates.unemployment.employer > 0">- 失业保险：{{ monthlySalary }}元 × {{ rates.unemployment.employer }}% × {{ months }}个月 = {{ result.employerPart.unemployment.toFixed(2) }}元</div>
                      <div class="mb-1" v-if="rates.injury.employer > 0">- 工伤保险：{{ monthlySalary }}元 × {{ rates.injury.employer }}% × {{ months }}个月 = {{ result.employerPart.injury.toFixed(2) }}元</div>
                      <div class="mb-1" v-if="rates.maternity.employer > 0">- 生育保险：{{ monthlySalary }}元 × {{ rates.maternity.employer }}% × {{ months }}个月 = {{ result.employerPart.maternity.toFixed(2) }}元</div>
                      <div class="mb-1" v-if="rates.housing.employer > 0">- 住房公积金：{{ monthlySalary }}元 × {{ rates.housing.employer }}% × {{ months }}个月 = {{ result.employerPart.housing.toFixed(2) }}元</div>
                      <div class="mb-1">单位缴纳总额：{{ result.employerPart.total.toFixed(2) }}元</div>
                    </template>

                    <!-- 追缴总额 -->
                    <div class="mb-1"></div>
                    <div class="mb-1 font-bold">追缴总额：{{ calculatedTotalAmount.toFixed(2) }}元</div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

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
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算追缴金额"按钮查看结果</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "社保追缴计算器",
  layout: "dashboard",
});
// import { ref, reactive, computed } from "vue";
import { calculateSocialInsuranceBackpay } from "#shared/utils/tools/socialInsuranceService";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Alert } from "@/components/ui/alert";
// import { Separator } from "@/components/ui/separator";
// import { Checkbox } from "@/components/ui/checkbox";

const monthlySalary = ref(5000);
const months = ref(12);
const includeEmployerPart = ref(true);
const calculatedWithEmployerPart = ref(true); // 存储计算时的开关状态
const isHelpOpen = ref(false); // 帮助指引的显示状态
const rates = reactive({
  pension: { employee: 8, employer: 16 },
  medical: { employee: 2, employer: 8 },
  unemployment: { employee: 0.5, employer: 1.5 },
  injury: { employee: 0, employer: 0.5 },
  maternity: { employee: 0, employer: 1 },
  housing: { employee: 7, employer: 7 },
});
const result = ref(null);

// 计算总金额
const calculatedTotalAmount = computed(() => {
  if (!result.value) return 0;

  return calculatedWithEmployerPart.value ? result.value.employeePart.total + result.value.employerPart.total : result.value.employeePart.total;
});

function calculate() {
  if (!validateInput()) return;

  // 将百分比转换为小数
  const ratesForCalculation = {
    pension: {
      employee: rates.pension.employee / 100,
      employer: rates.pension.employer / 100,
    },
    medical: {
      employee: rates.medical.employee / 100,
      employer: rates.medical.employer / 100,
    },
    unemployment: {
      employee: rates.unemployment.employee / 100,
      employer: rates.unemployment.employer / 100,
    },
    injury: {
      employee: rates.injury.employee / 100,
      employer: rates.injury.employer / 100,
    },
    maternity: {
      employee: rates.maternity.employee / 100,
      employer: rates.maternity.employer / 100,
    },
    housing: {
      employee: rates.housing.employee / 100,
      employer: rates.housing.employer / 100,
    },
  };

  // 记录计算时的开关状态
  calculatedWithEmployerPart.value = includeEmployerPart.value;

  // 始终计算全部内容，便于切换显示
  result.value = calculateSocialInsuranceBackpay(
    monthlySalary.value,
    months.value,
    ratesForCalculation,
    true // 始终计算全部数据
  );
}

function validateInput() {
  if (!monthlySalary.value || monthlySalary.value <= 0) {
    alert("请输入有效的月工资");
    return false;
  }

  if (!months.value || months.value <= 0) {
    alert("请输入有效的追缴月数");
    return false;
  }

  return true;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
</script>

<style scoped>
/* 自定义checkbox样式 */
.custom-checkbox {
  position: relative;
  width: 20px;
  height: 20px;
}

.custom-checkbox input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  cursor: pointer;
}

.checkbox-indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: transparent;
  border: 2px solid #ccc;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.custom-checkbox input:checked + .checkbox-indicator {
  background-color: hsl(var(--primary));
  border-color: hsl(var(--primary));
}

.custom-checkbox input:checked + .checkbox-indicator::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.custom-checkbox input:focus + .checkbox-indicator {
  box-shadow: 0 0 0 2px hsla(var(--primary), 0.2);
}
</style>
