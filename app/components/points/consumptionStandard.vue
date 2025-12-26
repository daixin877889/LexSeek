<template>
  <div class="space-y-4">
    <!-- <div class="text-center mb-6">
      <h3 class="text-lg font-semibold mb-2">积分消耗标准</h3>
      <p class="text-sm text-muted-foreground">以下为各功能模块的积分消耗标准</p>
    </div> -->

    <!-- 桌面端表格 -->
    <div class="hidden md:block">
      <div class="border rounded-lg overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="border-b bg-muted/50">
              <th class="px-4 py-3 text-left text-sm font-medium w-24">功能分类</th>
              <th class="px-4 py-3 text-left text-sm font-medium w-48">功能名称</th>
              <th class="px-4 py-3 text-center text-sm font-medium w-20">单位</th>
              <th class="px-4 py-3 text-center text-sm font-medium w-24">消耗积分</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(category, categoryIndex) in consumptionStandards" :key="categoryIndex">
              <tr v-for="(item, itemIndex) in category.items" :key="`${categoryIndex}-${itemIndex}`" class="border-b last:border-b-0 hover:bg-muted/30">
                <td v-if="itemIndex === 0" :rowspan="category.items.length" class="px-4 py-3 text-sm font-medium border-r bg-muted/20 align-middle text-center">
                  {{ category.name }}
                </td>
                <td class="px-4 py-3 text-sm">{{ item.name }}</td>
                <td class="px-4 py-3 text-center text-sm">{{ item.unit }}</td>
                <td class="px-4 py-3 text-center text-sm font-bold text-primary">{{ item.points }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
      <div v-for="(category, categoryIndex) in consumptionStandards" :key="categoryIndex" class="border rounded-lg">
        <h4 class="font-semibold text-sm mb-3 text-primary px-4 py-3 border-b bg-muted/50">{{ category.name }}</h4>
        <div class="space-y-3 p-4 pt-0">
          <div v-for="(item, itemIndex) in category.items" :key="itemIndex" class="flex justify-between items-center py-2 border-b border-dashed last:border-b-0">
            <div class="flex-1">
              <p class="text-sm font-medium">{{ item.name }}</p>
              <p class="text-xs text-muted-foreground">单位：{{ item.unit }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm font-bold text-primary">{{ item.points }}</p>
              <p class="text-xs text-muted-foreground">积分</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-6 p-4 bg-muted/30 rounded-lg">
      <p class="text-xs text-muted-foreground text-center">* 以上消耗标准可能会根据功能优化进行调整，请以实际消耗为准</p>
    </div>
  </div>
</template>

<script setup>
// 积分消耗标准数据
const consumptionStandards = ref([
  {
    name: "案件分析",
    items: [
      { name: "提取案件标题", unit: "次", points: 0 },
      { name: "生成案情概要", unit: "次", points: 3 },
      { name: "提取案件大事记", unit: "次", points: 2 },
      { name: "预分析案件请求权", unit: "次", points: 7 },
      { name: "法律合理性审查和判决决策预测", unit: "次", points: 7 },
      { name: "预选案由", unit: "次", points: 7 },
      { name: "抗辩分析及策略预测", unit: "次", points: 5 },
      { name: "证据清单梳理", unit: "次", points: 5 },
    ],
  },
  {
    name: "办案工具",
    items: [
      { name: "录音可视化(限时 3 折)", unit: "分钟", points: "1 × 0.3" },
      { name: "利息计算工具", unit: "次", points: 0 },
      { name: "诉讼费用计算工具", unit: "次", points: 0 },
      { name: "律师费用计算工具", unit: "次", points: 0 },
      { name: "延迟履行利息计算工具", unit: "次", points: 0 },
      { name: "银行利率查询工具", unit: "次", points: 0 },
      { name: "日期推算工具", unit: "次", points: 0 },
      { name: "赔偿计算器", unit: "次", points: 0 },
      { name: "加班计算工具", unit: "次", points: 0 },
      { name: "离婚财产分割工具", unit: "次", points: 0 },
      { name: "社保追缴工具", unit: "次", points: 0 },
    ],
  },
]);
</script>
