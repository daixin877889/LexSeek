<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-[22px] font-bold truncate">银行利率查询</h1>
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
              <h4 class="font-semibold mb-1">利率说明：</h4>
              <ul class="list-disc list-inside space-y-1">
                <li><strong>LPR利率</strong>：贷款市场报价利率，2019年8月20日起实施</li>
                <li><strong>贷款基准利率</strong>：中国人民银行公布的贷款基准利率</li>
                <li><strong>存款基准利率</strong>：中国人民银行公布的存款基准利率</li>
              </ul>
            </div>

            <div class="bg-muted/50 p-2 rounded">
              <p><strong>注意：</strong>本数据仅供参考，最后更新时间：2025-04-20</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Tabs defaultValue="lpr" class="w-full">
      <TabsList class="mb-4">
        <TabsTrigger class="px-4" value="lpr">LPR利率</TabsTrigger>
        <TabsTrigger class="px-4" value="loan">贷款基准利率</TabsTrigger>
        <TabsTrigger class="px-4" value="deposit">存款基准利率</TabsTrigger>
      </TabsList>

      <TabsContent value="lpr">
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>LPR利率</CardTitle>
            <CardDescription>全国银行间同业拆借中心公布的贷款市场报价利率</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>1年期（%）</TableHead>
                    <TableHead>5年期（%）</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(item, index) in lprHistory" :key="index">
                    <TableCell>{{ item.date }}</TableCell>
                    <TableCell>{{ item.oneYear }}</TableCell>
                    <TableCell>{{ item.fiveYear }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="loan">
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>贷款基准利率</CardTitle>
            <CardDescription>中国人民银行公布的贷款基准利率</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>6个月内（%）</TableHead>
                    <TableHead>1年（%）</TableHead>
                    <TableHead>1-5年（%）</TableHead>
                    <TableHead>5年以上（%）</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(item, index) in loanHistory" :key="index">
                    <TableCell>{{ item.date }}</TableCell>
                    <TableCell>{{ item.sixMonths }}</TableCell>
                    <TableCell>{{ item.oneYear }}</TableCell>
                    <TableCell>{{ item.oneToFiveYear }}</TableCell>
                    <TableCell>{{ item.fiveYear }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="deposit">
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>存款基准利率</CardTitle>
            <CardDescription>中国人民银行公布的存款基准利率</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>活期（%）</TableHead>
                    <TableHead>3个月（%）</TableHead>
                    <TableHead>6个月（%）</TableHead>
                    <TableHead>1年（%）</TableHead>
                    <TableHead>2年（%）</TableHead>
                    <TableHead>3年（%）</TableHead>
                    <TableHead>5年（%）</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(item, index) in depositHistory" :key="index">
                    <TableCell>{{ item.date }}</TableCell>
                    <TableCell>{{ item.demand }}</TableCell>
                    <TableCell>{{ item.threeMonths }}</TableCell>
                    <TableCell>{{ item.sixMonths }}</TableCell>
                    <TableCell>{{ item.oneYear }}</TableCell>
                    <TableCell>{{ item.twoYear }}</TableCell>
                    <TableCell>{{ item.threeYear }}</TableCell>
                    <TableCell>{{ item.fiveYear }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <div class="mt-4">
      <Alert variant="info" class="block">
        <p class="text-sm"><strong>说明：</strong> 数据仅供参考，最后更新时间：2025-04-20</p>
      </Alert>
    </div>
  </div>
</template>

<script setup>
definePageMeta({
  title: "银行利率查询",
  layout: "dashboard-layout",
});

import { getLPRHistory, getLoanRateHistory, getDepositRateHistory } from "#shared/utils/tools/bankRateService";

// 状态管理
const isHelpOpen = ref(false);
const lprHistory = ref([]);
const loanHistory = ref([]);
const depositHistory = ref([]);

// 方法
function loadRateData() {
  lprHistory.value = getLPRHistory();
  loanHistory.value = getLoanRateHistory();
  depositHistory.value = getDepositRateHistory();
}

// 组件挂载时执行
onMounted(() => {
  loadRateData();
});
</script>

<style scoped>
.table-responsive {
  max-height: 500px;
  overflow-y: auto;
}
</style>
