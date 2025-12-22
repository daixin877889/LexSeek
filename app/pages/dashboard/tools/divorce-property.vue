<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">财产分割计算器</h1>
      <div class="relative">
        <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
          <img src="@/assets/icon/help.svg" alt="帮助" class="h-5 w-5" />
          <span class="sr-only">帮助</span>
        </Button>
        <div v-if="isHelpOpen" class="absolute right-0 z-50 w-80 mt-2 p-4 bg-white rounded-lg border shadow-lg">
          <div class="flex justify-between items-center mb-3">
            <h3 class="font-semibold text-base">适用情况说明</h3>
            <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
              <img src="@/assets/icon/close.svg" alt="关闭" class="h-5 w-5" />
              <span class="sr-only">关闭</span>
            </Button>
          </div>

          <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
            <div>
              <h4 class="font-semibold mb-1">基础分配规则：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>夫妻共同财产原则上平均分配</li>
                <li>共同债务由双方共同承担</li>
                <li>分割时先扣除债务后再分配净资产</li>
                <li>负债超过资产时按债务比例分担</li>
              </ul>
            </div>

            <div>
              <h4 class="font-semibold mb-1">调整因素及影响（依据《民法典》）：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li>转移/隐匿财产：对方可多分20%-30%</li>
                <li>家暴/出轨等过错：无过错方可多分10%-20%</li>
                <li>子女抚养：抚养方可多分5%-10%</li>
              </ul>
            </div>

            <div class="bg-destructive/10 p-2 rounded text-destructive">
              <p><strong>声明：</strong>本计算器结果仅供参考，实际分割需由法院根据案件具体情况判定，或由双方协商一致确定。</p>
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
            <CardTitle>共同财产与债务</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div>
                <label class="text-sm font-medium leading-none">共同财产总额</label>
                <div class="relative mt-1.5">
                  <Input type="number" v-model="assets.total" placeholder="请输入财产总额" class="pr-12" />
                  <div class="absolute inset-y-0 right-0 flex items-center p-0">
                    <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                  </div>
                </div>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">共同债务总额</label>
                <div class="relative mt-1.5">
                  <Input type="number" v-model="debts.total" placeholder="请输入债务总额" class="pr-12" />
                  <div class="absolute inset-y-0 right-0 flex items-center p-0">
                    <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Accordion type="single" collapsible class="w-full mb-6">
          <AccordionItem value="assets">
            <AccordionTrigger>
              <h3 class="text-base font-semibold">财产明细（可选）</h3>
            </AccordionTrigger>
            <AccordionContent>
              <div class="space-y-4 pt-2">
                <div>
                  <label class="text-sm font-medium leading-none">房产价值</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="assets.house" placeholder="请输入房产价值" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">车辆价值</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="assets.car" placeholder="请输入车辆价值" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">存款</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="assets.savings" placeholder="请输入存款金额" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">投资理财</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="assets.investments" placeholder="请输入投资理财金额" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">其他财产</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="assets.other" placeholder="请输入其他财产金额" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Accordion type="single" collapsible class="w-full mb-6">
          <AccordionItem value="debts">
            <AccordionTrigger>
              <h3 class="text-base font-semibold">债务明细（可选）</h3>
            </AccordionTrigger>
            <AccordionContent>
              <div class="space-y-4 pt-2">
                <div>
                  <label class="text-sm font-medium leading-none">房贷余额</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="debts.mortgage" placeholder="请输入房贷余额" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">车贷余额</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="debts.carLoan" placeholder="请输入车贷余额" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">信用卡债务</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="debts.creditCard" placeholder="请输入信用卡债务" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="text-sm font-medium leading-none">其他债务</label>
                  <div class="relative mt-1.5">
                    <Input type="number" v-model="debts.other" placeholder="请输入其他债务" class="pr-12" />
                    <div class="absolute inset-y-0 right-0 flex items-center p-0">
                      <span class="py-2 px-3 text-sm text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Card class="mb-6 shadow-none border">
          <CardHeader>
            <CardTitle>分割比例与子女抚养</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div>
                <label class="text-sm font-medium leading-none">丈夫分割比例</label>
                <div class="relative mt-1.5">
                  <Input type="number" v-model="options.husbandRatio" min="0" max="1" step="0.05" placeholder="0.5" class="pr-20" />
                  <div class="absolute inset-y-0 right-0 flex items-center p-0">
                    <span class="py-2 px-3 text-sm text-muted-foreground">（0-1）</span>
                  </div>
                </div>
              </div>

              <div>
                <label class="text-sm font-medium leading-none">妻子分割比例</label>
                <div class="relative mt-1.5">
                  <Input type="number" v-model="options.wifeRatio" min="0" max="1" step="0.05" placeholder="0.5" class="pr-20" />
                  <div class="absolute inset-y-0 right-0 flex items-center p-0">
                    <span class="py-2 px-3 text-sm text-muted-foreground">（0-1）</span>
                  </div>
                </div>
              </div>

              <div>
                <label class="text-sm font-medium leading-none mb-1.5 block">是否有子女</label>
                <RadioGroup :model-value="options.hasChildren ? 'true' : 'false'" @update:model-value="(value) => (options.hasChildren = value === 'true')">
                  <div class="flex items-center space-x-4">
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="true" id="hasChildrenYes" />
                      <label for="hasChildrenYes" class="text-sm leading-none">是</label>
                    </div>
                    <div class="flex items-center space-x-2">
                      <RadioGroupItem value="false" id="hasChildrenNo" />
                      <label for="hasChildrenNo" class="text-sm leading-none">否</label>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              <div v-if="options.hasChildren">
                <label class="text-sm font-medium leading-none">子女抚养权</label>
                <Select v-model="options.childCustody" class="mt-1.5">
                  <SelectTrigger>
                    <SelectValue :placeholder="getChildCustodyText()" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="husband">归丈夫</SelectItem>
                    <SelectItem value="wife">归妻子</SelectItem>
                    <SelectItem value="shared">共同抚养</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="pt-2">
                <Button class="w-full" @click="calculate">计算分割结果</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 右侧：计算结果区 -->
      <div class="w-full lg:w-7/12">
        <Card v-if="result" class="shadow-none border">
          <CardHeader>
            <CardTitle>财产分割结果</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" class="w-full space-y-2" :defaultValue="['overview', 'distribution']">
              <!-- 财产概览 -->
              <AccordionItem value="overview">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">财产概览</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center">
                      <span>共同财产总额：</span>
                      <span>{{ formatCurrency(result.totalAssets) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>共同债务总额：</span>
                      <span>{{ formatCurrency(result.totalDebts) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center font-semibold">
                      <span>净资产：</span>
                      <span>{{ formatCurrency(result.netAssets) }} 元</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 分割结果 -->
              <AccordionItem value="distribution">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">分割结果</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center">
                      <span>丈夫分得比例：</span>
                      <span>{{ (options.husbandRatio * 100).toFixed(0) }}%</span>
                    </div>
                    <div class="flex justify-between items-center font-semibold">
                      <span>丈夫分得金额：</span>
                      <span>{{ formatCurrency(result.husbandNetAssets) }} 元</span>
                    </div>
                    <Separator class="my-2" />
                    <div class="flex justify-between items-center">
                      <span>妻子分得比例：</span>
                      <span>{{ (options.wifeRatio * 100).toFixed(0) }}%</span>
                    </div>
                    <div class="flex justify-between items-center font-semibold">
                      <span>妻子分得金额：</span>
                      <span>{{ formatCurrency(result.wifeNetAssets) }} 元</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 子女抚养 -->
              <AccordionItem v-if="options.hasChildren && result.childSupportAmount > 0" value="child-support">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">子女抚养</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="space-y-2 pt-2">
                    <div class="flex justify-between items-center">
                      <span>子女抚养费：</span>
                      <span>{{ formatCurrency(result.childSupportAmount) }} 元</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>支付方：</span>
                      <span>{{ result.childSupportPayer }}</span>
                    </div>
                    <div class="flex justify-between items-center">
                      <span>接收方：</span>
                      <span>{{ result.childSupportReceiver }}</span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <!-- 详细说明 -->
              <AccordionItem value="details">
                <AccordionTrigger>
                  <h3 class="text-base font-semibold">详细说明</h3>
                </AccordionTrigger>
                <AccordionContent>
                  <div class="bg-muted/50 p-4 rounded text-sm space-y-1">
                    <div v-for="(detail, index) in result.details" :key="index">{{ detail }}</div>
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
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
              <h3 class="text-lg font-medium">计算结果将在这里显示</h3>
            </div>
            <p class="text-sm text-muted-foreground">填写左侧表单并点击"计算分割结果"按钮查看结果</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "离婚财产分割计算器",
  layout: "dashboard-layout",
});

import { calculateDivorceProperty } from "#shared/utils/tools/divorcePropertyService";

// 状态管理
const isHelpOpen = ref(false);
const assets = ref({
  total: 1000000,
  house: 0,
  car: 0,
  savings: 0,
  investments: 0,
  other: 0,
});

const debts = ref({
  total: 300000,
  mortgage: 0,
  carLoan: 0,
  creditCard: 0,
  other: 0,
});

const options = ref({
  husbandRatio: 0.5,
  wifeRatio: 0.5,
  hasChildren: false,
  childCustody: "shared",
});

const result = ref(null);

// 方法
function getChildCustodyText() {
  switch (options.value.childCustody) {
    case "husband":
      return "归丈夫";
    case "wife":
      return "归妻子";
    case "shared":
      return "共同抚养";
    default:
      return "请选择";
  }
}

function calculate() {
  // 检查分割比例
  if (options.value.husbandRatio + options.value.wifeRatio !== 1) {
    toast.error("丈夫和妻子的分割比例之和必须等于1");
    return;
  }

  // 提取明细资产和债务
  const detailedAssets = {
    house: Number(assets.value.house) || 0,
    car: Number(assets.value.car) || 0,
    savings: Number(assets.value.savings) || 0,
    investments: Number(assets.value.investments) || 0,
    other: Number(assets.value.other) || 0,
  };

  const detailedDebts = {
    mortgage: Number(debts.value.mortgage) || 0,
    carLoan: Number(debts.value.carLoan) || 0,
    creditCard: Number(debts.value.creditCard) || 0,
    other: Number(debts.value.other) || 0,
  };

  // 更新总额
  const totalDetailedAssets = Object.values(detailedAssets).reduce((sum, val) => sum + val, 0);
  const totalDetailedDebts = Object.values(detailedDebts).reduce((sum, val) => sum + val, 0);

  if (totalDetailedAssets > 0 && assets.value.total === 0) {
    assets.value.total = totalDetailedAssets;
  }

  if (totalDetailedDebts > 0 && debts.value.total === 0) {
    debts.value.total = totalDetailedDebts;
  }

  // 确保总额有值
  if (assets.value.total === 0 && totalDetailedAssets === 0) {
    toast.error("请输入共同财产总额或填写明细资产");
    return;
  }

  // 计算分割结果
  result.value = calculateDivorceProperty(
    {
      house: assets.value.house || 0,
      car: assets.value.car || 0,
      savings: assets.value.savings || 0,
      investments: assets.value.investments || 0,
      other: assets.value.total > 0 && assets.value.total !== totalDetailedAssets ? assets.value.total - totalDetailedAssets + (assets.value.other || 0) : assets.value.other || 0,
    },
    {
      mortgage: debts.value.mortgage || 0,
      carLoan: debts.value.carLoan || 0,
      creditCard: debts.value.creditCard || 0,
      other: debts.value.total > 0 && debts.value.total !== totalDetailedDebts ? debts.value.total - totalDetailedDebts + (debts.value.other || 0) : debts.value.other || 0,
    },
    options.value
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
</script>
