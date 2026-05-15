<template>
  <div>
    <LandingHero />
    <LandingPainPoints />
    <LandingSolutions />
    <LandingFeatures />

    <LandingWorkflow />
    <LandingTools />
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
import LandingFeatures from '~/components/landing/LandingFeatures.vue'
import LandingWorkflow from '~/components/landing/LandingWorkflow.vue'
import LandingTools from '~/components/landing/LandingTools.vue'
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
