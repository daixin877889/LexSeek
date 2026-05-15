<template>
  <section class="bg-background px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-12 text-center">
        <p class="mb-3 text-[13px] font-medium uppercase tracking-[0.08em] text-primary">
          UTILITY TOOLS
        </p>
        <h2 class="mb-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          专业<span class="bg-linear-to-br from-[#1E9EED] to-[#090380] bg-clip-text text-transparent">办案工具</span>
        </h2>
        <p class="mx-auto max-w-[640px] text-base leading-[1.6] text-muted-foreground">
          丰富的计算工具集合，帮助您精确计算各类费用和数据，提升办案效率
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <NuxtLink
          v-for="tool in TOOLS"
          :key="tool.to"
          :to="tool.to"
          class="group flex flex-col items-center rounded-[12px] border bg-card p-6 text-center shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
        >
          <div class="mb-3.5 flex size-12 items-center justify-center rounded-[12px] bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]">
            <component :is="tool.icon" class="size-7 transition group-hover:scale-110" />
          </div>
          <h3 class="mb-1 text-[15px] font-semibold leading-[1.3]">{{ tool.title }}</h3>
          <p class="text-[12.5px] leading-[1.5] text-muted-foreground">{{ tool.body }}</p>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Calculator, Clock, BadgePercent, Calendar, Briefcase, HeartHandshake, Shield } from "lucide-vue-next"
import LitigationIcon from "~/components/icons/Litigation.vue"
import MoneyBagIcon from "~/components/icons/MoneyBag.vue"
import MoneyIcon from "~/components/icons/MoneyIcon.vue"

const TOOLS = [
  { to: "/dashboard/tools/interest", icon: Calculator, title: "利息计算", body: "计算各类借款、欠款的利息" },
  { to: "/dashboard/tools/court-fee", icon: LitigationIcon, title: "诉讼费用", body: "计算诉讼案件的诉讼费用" },
  { to: "/dashboard/tools/lawyer-fee", icon: MoneyBagIcon, title: "律师费计算", body: "计算律师费用" },
  { to: "/dashboard/tools/delay-interest", icon: Clock, title: "延迟履行利息", body: "计算延迟履行的利息" },
  { to: "/dashboard/tools/bank-rate", icon: BadgePercent, title: "银行利率查询", body: "查询银行的最新利率" },
  { to: "/dashboard/tools/date-calculator", icon: Calendar, title: "日期推算", body: "计算特定日期间隔或推算日期" },
  { to: "/dashboard/tools/compensation", icon: MoneyIcon, title: "赔偿计算器", body: "计算各类赔偿金额" },
  { to: "/dashboard/tools/overtime", icon: Briefcase, title: "加班计算", body: "计算加班费用" },
  { to: "/dashboard/tools/divorce-property", icon: HeartHandshake, title: "离婚财产分割", body: "离婚财产分割计算" },
  { to: "/dashboard/tools/social-insurance", icon: Shield, title: "社保追缴", body: "计算社保追缴金额" },
]
</script>
