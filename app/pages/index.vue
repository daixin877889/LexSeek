<template>
  <div>
    <LandingHero />
    <LandingPainPoints />
    <LandingSolutions />
    <LandingFeatures />
    <LandingWorkflow />
    <LandingTools />
    <LandingCta />
  </div>
</template>

<script setup lang="ts">
import LandingHero from '~/components/landing/LandingHero.vue'
import LandingPainPoints from '~/components/landing/LandingPainPoints.vue'
import LandingSolutions from '~/components/landing/LandingSolutions.vue'
import LandingFeatures from '~/components/landing/LandingFeatures.vue'
import LandingWorkflow from '~/components/landing/LandingWorkflow.vue'
import LandingTools from '~/components/landing/LandingTools.vue'
import LandingCta from '~/components/landing/LandingCta.vue'
import { useSiteSeo } from '~/composables/useSiteSeo'
import { softwareApplicationLd } from '#shared/utils/seo/jsonLd'

definePageMeta({
  layout: 'base-layout',
  title: '首页',
})

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '法律 AI 案件分析平台 - 律师专属 AI 工作台',
  description: 'LexSeek 法索 AI 是专为法律人打造的多模态 AI 精细化案件分析工具，告别低效梳理、专注精准判断：AI 案情分析、请求权分析、合同审查、起诉状/答辩状生成、利息/诉讼费计算等一站式办案工具。注册即享 7 天旗舰版免费试用。',
  path: '/',
  keywords: ['法律AI', '律师AI助手', '案件分析', 'AI律师', '诉讼辅助', '合同审查AI', '法律文书AI', '法律科技', '办案工具', 'LexSeek', '法索AI'],
  ogImage: '/og/home.png',
  jsonLd: softwareApplicationLd(siteUrl),
})
</script>
