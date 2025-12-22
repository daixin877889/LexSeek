<template>
  <div>
    <div class="container mx-auto p-4 max-w-full">
      <div>
        <h1 class="text-3xl font-bold mb-2">办案工具</h1>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-8 gap-4 mt-4">
        <div v-for="tool in tools" :key="tool.id" class="bg-white dark:bg-gray-800 p-6 rounded-lg border hover:border-primary transition-shadow duration-300 flex flex-col items-center cursor-pointer" @click="navigateToTool(tool)">
          <div class="text-primary mb-4">
            <component :is="tool.icon" class="w-12 h-12" />
          </div>
          <h2 class="text-xl font-semibold mb-2">{{ tool.title }}</h2>
          <p class="text-gray-600 dark:text-gray-300 text-center text-sm">{{ tool.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "办案工具",
  layout: "dashboard",
});
import { Calculator, DollarSign, Scale, Gavel, Clock, BadgePercent, Calendar, CircleDollarSign, Briefcase, HeartHandshake, Shield } from "lucide-vue-next";
import MoneyBag from "@/components/icons/MoneyBag.vue";
import MoneyIcon from "@/components/icons/MoneyIcon.vue";
import Litigation from "@/components/icons/Litigation.vue";
// 工具列表数据
const tools = ref([
  {
    id: "interest",
    title: "利息计算",
    icon: Calculator,
    description: "计算各类借款、欠款的利息",
    path: "/dashboard/tools/interest",
  },
  {
    id: "court-fee",
    title: "诉讼费用",
    icon: markRaw(Litigation),
    description: "计算诉讼案件的诉讼费用",
    path: "/dashboard/tools/court-fee",
  },
  {
    id: "lawyer-fee",
    title: "律师费用计算",
    icon: markRaw(MoneyBag),
    description: "计算律师费用",
    path: "/dashboard/tools/lawyer-fee",
  },
  // {
  //   id: 'arbitration-fee',
  //   title: '仲裁费',
  //   icon: Gavel,
  //   description: '计算仲裁案件的仲裁费用',
  //   path: '/tools/arbitration-fee'
  // },
  {
    id: "/delay-interest",
    title: "延迟履行利息",
    icon: Clock,
    description: "计算延迟履行的利息",
    path: "/dashboard/tools/delay-interest",
  },
  {
    id: "bank-rate",
    title: "银行利率查询",
    icon: BadgePercent,
    description: "查询银行的最新利率",
    path: "/dashboard/tools/bank-rate",
  },
  {
    id: "date-calculator",
    title: "日期推算",
    icon: Calendar,
    description: "计算特定日期间隔或推算日期",
    path: "/dashboard/tools/date-calculator",
  },
  {
    id: "compensation",
    title: "赔偿计算器",
    icon: markRaw(MoneyIcon),
    description: "计算各类赔偿金额",
    path: "/dashboard/tools/compensation",
  },
  {
    id: "overtime",
    title: "加班计算",
    icon: Briefcase,
    description: "计算加班费用",
    path: "/dashboard/tools/overtime",
  },
  {
    id: "divorce-property",
    title: "离婚财产分割",
    icon: HeartHandshake,
    description: "离婚财产分割计算",
    path: "/dashboard/tools/divorce-property",
  },
  {
    id: "social-insurance",
    title: "社保追缴",
    icon: Shield,
    description: "计算社保追缴金额",
    path: "/dashboard/tools/social-insurance",
  },
]);

/**
 * 导航到指定工具页面
 * @param {Object} tool - 工具对象
 */
const navigateToTool = (tool: any) => {
  navigateTo(tool.path);
};
</script>

<style></style>
