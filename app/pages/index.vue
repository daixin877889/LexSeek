<template>
  <div>
    <LandingHero />
    <LandingPainPoints />
    <LandingSolutions />
    <!-- 功能简介区 -->
    <section class="py-12 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">强大的功能，简化您的工作流程</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">LexSeek 提供全面的案件分析工具，帮助您更高效地处理法律案件</p>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <file-text-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">案情概要生成</h3>
            <p class="text-muted-foreground">自动分析案件材料，生成简洁明了的案情概要，帮助您快速把握案件要点。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <calendar-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">案件大事记</h3>
            <p class="text-muted-foreground">自动整理案件时间线，按时间顺序呈现关键事件，便于您全面了解案件发展过程。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <gavel-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">案由确认</h3>
            <p class="text-muted-foreground">智能识别案件类型和案由，提供法律依据，帮助您准确定位案件性质。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <clipboard-list-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">请求权生成与分析</h3>
            <p class="text-muted-foreground">根据案情自动生成可能的请求权，并提供详细分析和法律依据。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <shield-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">对方抗辩预测</h3>
            <p class="text-muted-foreground">预测对方可能的抗辩理由和策略，帮助您提前准备应对方案。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <EvidenceIcon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">证据清单</h3>
            <p class="text-muted-foreground">分析并整理案件所需证据清单建议，让您胸有成竹。</p>
          </div>
          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <TrendIcon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">法律合理性审查和判决趋势预测</h3>
            <p class="text-muted-foreground">案件法律合理性审查、预测判决趋势，助您及时调整诉讼策略。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <history-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">分析历史记录</h3>
            <p class="text-muted-foreground">保存所有分析结果，随时查阅和比较，持续跟踪案件进展。</p>
          </div>
        </div>

        <div class="flex justify-center mt-10">
          <NuxtLink to="/dashboard/cases/create"
            class="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
            {{ btnText }}</NuxtLink>
        </div>
      </div>
    </section>

    <!-- 工作流程 -->
    <section class="py-12 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">简单三步，完成案件分析</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">LexSeek 简化了案件分析流程，让您能够专注于案件策略的制定</p>
        </div>

        <div class="grid md:grid-cols-3 gap-8">
          <div class="text-center">
            <div
              class="bg-primary/10 text-primary h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <file-plus-icon class="h-8 w-8" />
            </div>
            <h3 class="text-xl font-semibold mb-2">1. 输入案情</h3>
            <p class="text-muted-foreground">输入或上传案件材料，包括事实描述、证据材料等关键信息。</p>
          </div>

          <div class="text-center">
            <div
              class="bg-primary/10 text-primary h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <cpu-icon class="h-8 w-8" />
            </div>
            <h3 class="text-xl font-semibold mb-2">2. AI 分析</h3>
            <p class="text-muted-foreground">我们的 AI 系统会自动分析案情，提取关键信息，生成分析结果。</p>
          </div>

          <div class="text-center">
            <div
              class="bg-primary/10 text-primary h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <check-circle-icon class="h-8 w-8" />
            </div>
            <h3 class="text-xl font-semibold mb-2">3. 获取结果</h3>
            <p class="text-muted-foreground">查看分析结果，包括案情概要、大事记、案由、请求权分析等内容。</p>
          </div>
        </div>

        <div class="flex justify-center mt-10">
          <NuxtLink to="/dashboard/cases/create"
            class="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
            {{ btnText }}</NuxtLink>
        </div>
      </div>
    </section>

    <!-- 办案工具 -->
    <section class="py-12 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">专业办案工具</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">丰富的计算工具集合，帮助您精确计算各类费用和数据，提升办案效率</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          <NuxtLink to="/dashboard/tools/interest"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <calculator-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">利息计算</h3>
            <p class="text-muted-foreground text-sm">计算各类借款、欠款的利息</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/court-fee"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <litigation-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">诉讼费用</h3>
            <p class="text-muted-foreground text-sm">计算诉讼案件的诉讼费用</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/lawyer-fee"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <money-bag-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">律师费计算</h3>
            <p class="text-muted-foreground text-sm">计算律师费用</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/delay-interest"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <clock-icon class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">延迟履行利息</h3>
            <p class="text-muted-foreground text-sm">计算延迟履行的利息</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/bank-rate"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <badge-percent-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">银行利率查询</h3>
            <p class="text-muted-foreground text-sm">查询银行的最新利率</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/date-calculator"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <calendar-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">日期推算</h3>
            <p class="text-muted-foreground text-sm">计算特定日期间隔或推算日期</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/compensation"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <money-icon class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">赔偿计算器</h3>
            <p class="text-muted-foreground text-sm">计算各类赔偿金额</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/overtime"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <briefcase-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">加班计算</h3>
            <p class="text-muted-foreground text-sm">计算加班费用</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/divorce-property"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <heart-handshake-icon
              class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">离婚财产分割</h3>
            <p class="text-muted-foreground text-sm">离婚财产分割计算</p>
          </NuxtLink>

          <NuxtLink to="/dashboard/tools/social-insurance"
            class="bg-card rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col items-center text-center group">
            <ShieldIcon class="h-12 w-12 text-primary mb-4 group-hover:scale-110 transition-transform duration-300" />
            <h3 class="text-lg font-semibold mb-2">社保追缴</h3>
            <p class="text-muted-foreground text-sm">计算社保追缴金额</p>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- 号召行动 -->
    <section class="py-12 bg-primary text-primary-foreground px-4">
      <div class="max-w-[1200px] mx-auto text-center">
        <h2 class="text-3xl font-bold mb-4">立即开始使用 LexSeek</h2>
        <p class="text-xl mb-8 max-w-2xl mx-auto opacity-90">加入成千上万的法律专业人士，体验法律 AI 辅助案件分析带来的效率提升</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <NuxtLink to="/dashboard/cases/create"
            class="inline-flex items-center justify-center px-6 py-3 bg-background text-foreground font-medium rounded-md hover:bg-background/90 transition-colors">
            {{ btnText }}</NuxtLink>
          <NuxtLink to="/features"
            class="inline-flex items-center justify-center px-6 py-3 bg-white/15 text-primary-foreground border border-white/30 font-medium rounded-md hover:bg-white/25 transition-colors">
            了解更多</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import LandingHero from '~/components/landing/LandingHero.vue'
import LandingPainPoints from '~/components/landing/LandingPainPoints.vue'
import LandingSolutions from '~/components/landing/LandingSolutions.vue'
import { useAuthStore } from '~/store/auth'
definePageMeta({
  layout: "base-layout",
  title: "首页",
});
import { FileTextIcon, CalendarIcon, ClipboardListIcon, ShieldIcon, HistoryIcon, FilePlusIcon, CpuIcon, CheckCircleIcon, Calculator as CalculatorIcon, Clock as ClockIcon, BadgePercent as BadgePercentIcon, Plus as PlusIcon, Briefcase as BriefcaseIcon, HeartHandshake as HeartHandshakeIcon, Shield } from "lucide-vue-next";
import { GavelIcon } from "@/components/icons/GavelIcon";
import LitigationIcon from "@/components/icons/Litigation.vue";
import MoneyBagIcon from "@/components/icons/MoneyBag.vue";
import MoneyIcon from "@/components/icons/MoneyIcon.vue";
import EvidenceIcon from "@/components/icons/EvidenceIcon.vue";
import TrendIcon from "@/components/icons/TrendIcon.vue";
import { useSiteSeo } from '~/composables/useSiteSeo'
import { softwareApplicationLd } from '#shared/utils/seo/jsonLd'

const authStore = useAuthStore();

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '法律 AI 案件分析平台 - 律师专属 AI 工作台',
  description: 'LexSeek 法索 AI 是专为法律人打造的多模态 AI 精细化案件分析工具，告别低效梳理、专注精准判断：AI 案情分析、请求权分析、合同审查、起诉状/答辩状生成、利息/诉讼费计算等一站式办案工具。注册即享 7 天旗舰版免费试用。',
  path: '/',
  keywords: ['法律AI', '律师AI助手', '案件分析', 'AI律师', '诉讼辅助', '合同审查AI', '法律文书AI', '法律科技', '办案工具', 'LexSeek', '法索AI'],
  ogImage: '/og/home.png',
  jsonLd: softwareApplicationLd(siteUrl),
})

const btnText = computed(() => {
  if (authStore.isAuthenticated) {
    return "开始分析";
  }
  return "免费体验";
});
</script>
