<template>
  <div class="p-4 md:p-6">
    <!-- 页头 -->
    <div class="mb-6">
      <!-- <p class="mb-2.5 text-xs font-medium uppercase tracking-[0.08em] text-primary">UTILITY TOOLS · 办案工具</p> -->
      <h1 class="mb-1.5 text-[28px] font-bold tracking-tight text-foreground">专业办案工具</h1>
      <p class="max-w-[720px] text-sm text-muted-foreground">
        丰富的计算工具集合，帮助您精确计算各类费用和数据。所有工具对会员免费开放。
      </p>
    </div>

    <!-- 分组 -->
    <div class="flex flex-col gap-7">
      <section v-for="group in toolGroups" :key="group.title">
        <h2 class="mb-3.5 text-base font-semibold text-muted-foreground">{{ group.title }}</h2>
        <div class="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          <button v-for="tool in group.tools" :key="tool.id" type="button"
            class="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            @click="navigateToTool(tool)">
            <div :class="['flex size-11 shrink-0 items-center justify-center rounded-[11px]', TINTS[tool.tint]]">
              <component :is="tool.icon" class="size-[22px]" />
            </div>
            <div class="min-w-0">
              <h3 class="mb-0.5 text-[15px] font-semibold text-foreground">{{ tool.title }}</h3>
              <p class="truncate text-[12.5px] text-muted-foreground">{{ tool.description }}</p>
            </div>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Component } from "vue";
import { Calculator, Clock, BadgePercent, Calendar, Briefcase, HeartHandshake, Shield } from "lucide-vue-next";
import MoneyBag from "@/components/icons/MoneyBag.vue";
import MoneyIcon from "@/components/icons/MoneyIcon.vue";
import Litigation from "@/components/icons/Litigation.vue";

definePageMeta({
  title: "办案工具",
  layout: "dashboard-layout",
});

type Tint = "sky" | "mint" | "navy" | "amber";

interface Tool {
  id: string;
  title: string;
  icon: Component;
  description: string;
  path: string;
  tint: Tint;
}

// 彩色图标块的底色 + 前景色（token 定义在 app/assets/css/tailwind.css，含深色值）
const TINTS: Record<Tint, string> = {
  sky: "bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]",
  mint: "bg-[image:var(--tint-mint-bg)] text-[color:var(--tint-mint-fg)]",
  navy: "bg-[image:var(--tint-navy-bg)] text-[color:var(--tint-navy-fg)]",
  amber: "bg-[image:var(--tint-amber-bg)] text-[color:var(--tint-amber-fg)]",
};

// 工具按分类分组
const toolGroups: { title: string; tools: Tool[] }[] = [
  {
    title: "财务计算",
    tools: [
      { id: "interest", title: "利息计算", icon: Calculator, description: "计算各类借款、欠款的利息", path: "/dashboard/tools/interest", tint: "sky" },
      { id: "court-fee", title: "诉讼费用", icon: Litigation, description: "计算诉讼案件的诉讼费用", path: "/dashboard/tools/court-fee", tint: "mint" },
      { id: "lawyer-fee", title: "律师费用计算", icon: MoneyBag, description: "计算律师费用", path: "/dashboard/tools/lawyer-fee", tint: "navy" },
      { id: "delay-interest", title: "延迟履行利息", icon: Clock, description: "计算延迟履行的利息", path: "/dashboard/tools/delay-interest", tint: "amber" },
      { id: "bank-rate", title: "银行利率查询", icon: BadgePercent, description: "查询银行的最新利率", path: "/dashboard/tools/bank-rate", tint: "sky" },
    ],
  },
  {
    title: "时限 & 日期",
    tools: [
      { id: "date-calculator", title: "日期推算", icon: Calendar, description: "计算特定日期间隔或推算日期", path: "/dashboard/tools/date-calculator", tint: "mint" },
      { id: "overtime", title: "加班计算", icon: Briefcase, description: "计算加班费用", path: "/dashboard/tools/overtime", tint: "navy" },
    ],
  },
  {
    title: "人身损害 & 家事",
    tools: [
      { id: "compensation", title: "赔偿计算器", icon: MoneyIcon, description: "计算各类赔偿金额", path: "/dashboard/tools/compensation", tint: "sky" },
      { id: "divorce-property", title: "离婚财产分割", icon: HeartHandshake, description: "离婚财产分割计算", path: "/dashboard/tools/divorce-property", tint: "mint" },
      { id: "social-insurance", title: "社保追缴", icon: Shield, description: "计算社保追缴金额", path: "/dashboard/tools/social-insurance", tint: "amber" },
    ],
  },
];

/** 跳转到对应工具页 */
function navigateToTool(tool: Tool) {
  navigateTo(tool.path);
}
</script>
