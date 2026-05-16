<template>
  <div class="p-4 md:p-6 lg:p-8 w-full">
    <!-- 分析次数限制提示 -->
    <div v-if="showAnalysisLimits" class="w-full p-4 mb-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
      <p class="text-sm text-foreground">
        您正在使用的是 <strong class="text-primary">{{ dashboardData?.membership?.levelName ?? '免费版' }}</strong>，今日可用分析次数 <strong>{{ 0 }} / {{ 10 }}</strong> ，本月可用分析次数 <strong>{{ 0 }} / {{ 100 }}</strong>。
      </p>
      <Button variant="default" size="sm">立即升级</Button>
    </div>

    <!-- 活动横幅 -->
    <button
      type="button"
      class="relative mb-8 w-full overflow-hidden rounded-xl bg-gradient-brand px-5 py-3.5 text-left text-white shadow-[0_10px_25px_-10px_rgba(9,3,128,0.4)] transition hover:brightness-105"
      @click="wxSupportStore.showQrCode()"
    >
      <span aria-hidden="true" class="pointer-events-none absolute -top-8 right-16 size-36 rounded-full bg-white/[0.08]" />
      <span aria-hidden="true" class="pointer-events-none absolute top-2.5 -right-5 size-16 rounded-full bg-white/[0.06]" />
      <span class="relative flex items-center justify-between gap-4">
        <span class="flex items-center gap-3.5">
          <span class="inline-flex shrink-0 items-center rounded-full bg-white px-3 py-[5px] text-[11px] font-bold tracking-[0.08em] text-[#0A4DA8]">限时活动</span>
          <span class="text-[15px] font-semibold leading-snug">联系客服可领取 7 天延长使用兑换码</span>
        </span>
        <span class="hidden shrink-0 items-center gap-1 rounded-md bg-white/95 px-4 py-2 text-[13px] font-semibold text-[#0A4DA8] sm:inline-flex">
          点此联系客服
          <ArrowRight class="size-3.5" />
        </span>
      </span>
    </button>

    <!-- 欢迎语 -->
    <div class="mb-8">
      <h1 class="mb-2 text-3xl font-bold tracking-tight text-foreground">
        欢迎回来，<GradientText>{{ userStore.userInfo?.name || '' }}</GradientText>
      </h1>
      <p class="text-muted-foreground">查看您的案件分析概览和最近活动 · 今天是 {{ today }}</p>
    </div>

    <!-- 数据概览卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
      <component
        :is="stat.to ? NuxtLinkComp : 'div'"
        v-for="stat in stats"
        :key="stat.label"
        :to="stat.to"
        class="group block rounded-xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="mb-1 text-sm font-medium text-muted-foreground">{{ stat.label }}</p>
            <h3 class="truncate text-3xl font-bold text-card-foreground">{{ stat.value }}</h3>
          </div>
          <div :class="['flex size-10 shrink-0 items-center justify-center rounded-[10px]', TINTS[stat.tint]]">
            <component :is="stat.icon" class="size-[22px]" />
          </div>
        </div>
        <div class="mt-4">
          <p v-if="stat.trend" class="flex items-center gap-1 text-[12.5px] font-medium text-green-600">
            <TrendingUp class="size-3.5" />
            <span>{{ stat.trend }}</span>
          </p>
          <p v-else-if="stat.sub" class="text-[12.5px] font-medium text-muted-foreground">{{ stat.sub }}</p>
        </div>
      </component>
    </div>

    <!-- 快速操作 -->
    <div class="mb-8">
      <h2 class="mb-4 text-xl font-semibold text-foreground">快速操作</h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <component
          :is="action.to ? NuxtLinkComp : 'button'"
          v-for="action in QUICK_ACTIONS"
          :key="action.title"
          :to="action.to"
          :type="action.to ? undefined : 'button'"
          class="flex items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
          @click="action.action === 'help' && wxSupportStore.showQrCode()"
        >
          <div :class="['flex size-10 shrink-0 items-center justify-center rounded-[10px]', TINTS[action.tint]]">
            <component :is="action.icon" class="size-5" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">{{ action.title }}</h3>
            <p class="mt-0.5 text-sm text-muted-foreground">{{ action.body }}</p>
          </div>
        </component>
      </div>
    </div>

    <!-- 最新案件 -->
    <div class="mb-8">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-xl font-semibold text-foreground">最新案件</h2>
        <NuxtLink to="/dashboard/cases" class="text-sm font-medium text-primary hover:underline">查看全部</NuxtLink>
      </div>
      <div class="flex flex-col gap-3">
        <NuxtLink
          v-for="c in dashboardData?.recentCases"
          :key="c.id"
          :to="`/dashboard/cases/${c.id}`"
          class="block rounded-lg border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="mb-1.5 truncate font-medium text-foreground">{{ c.title }}</h3>
              <div class="flex items-center gap-3">
                <span class="text-sm text-muted-foreground">{{ c.date }}</span>
                <span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-normal bg-secondary text-secondary-foreground">{{ c.type }}</span>
                <span v-if="c.status === 'in_progress'" class="inline-flex items-center rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-normal text-blue-600 dark:text-blue-400">进行中</span>
                <span v-else class="inline-flex items-center rounded border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-normal text-green-600 dark:text-green-400">已完成</span>
              </div>
            </div>
            <ExternalLink class="size-4 shrink-0 text-muted-foreground" />
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Component } from 'vue'
import type { DashboardResponse } from '#shared/types/dashboard'
import {
  FileText,
  BarChart3,
  Coins,
  Crown,
  FilePlus,
  FolderOpen,
  HelpCircle,
  TrendingUp,
  ExternalLink,
  ArrowRight,
} from "lucide-vue-next";
import dayjs from 'dayjs'
import { useApi } from '~/composables/useApi'
import { useUserStore } from '~/store/user'
import { useWxSupportStore } from '~/store/wxSupport'
import GradientText from '~/components/general/GradientText.vue'

definePageMeta({
  title: "工作台",
  layout: "dashboard-layout",
  userMenu: { group: 'home', title: '首页', icon: 'Home', order: 0 },
});

const userStore = useUserStore();
const wxSupportStore = useWxSupportStore();

const { data: dashboardData } = await useApi<DashboardResponse>('/api/v1/dashboard')

// 暂时隐藏，等 API 支持后再启用
const showAnalysisLimits = false;

// 动态组件：可点击的卡片用 NuxtLink，其余用原生元素
const NuxtLinkComp = resolveComponent('NuxtLink')

const today = dayjs().format('YYYY 年 M 月 D 日')

type Tint = 'sky' | 'mint' | 'navy' | 'amber'

/** 品牌四色淡彩图标块 —— bg/fg 取自 .theme-brand 的 --tint-* token */
const TINTS: Record<Tint, string> = {
  sky: 'bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]',
  mint: 'bg-[image:var(--tint-mint-bg)] text-[color:var(--tint-mint-fg)]',
  navy: 'bg-[image:var(--tint-navy-bg)] text-[color:var(--tint-navy-fg)]',
  amber: 'bg-[image:var(--tint-amber-bg)] text-[color:var(--tint-amber-fg)]',
}

interface StatItem {
  label: string
  value: string | number
  icon: Component
  tint: Tint
  trend?: string
  sub?: string
  to?: string
}

const stats = computed<StatItem[]>(() => [
  {
    label: '总案件数',
    value: dashboardData.value?.statistics.totalCases ?? 0,
    icon: FileText,
    tint: 'sky',
    trend: `+${dashboardData.value?.statistics.caseIncrease ?? 0} 本月`,
  },
  {
    label: '分析次数',
    value: dashboardData.value?.statistics.totalAnalysis ?? 0,
    icon: BarChart3,
    tint: 'mint',
    trend: `+${dashboardData.value?.statistics.analysisIncrease ?? 0} 本月`,
  },
  {
    label: '可用积分',
    value: dashboardData.value?.points.remaining ?? 0,
    icon: Coins,
    tint: 'navy',
    sub: `购买: ${dashboardData.value?.points.purchasePoint ?? 0}，赠送: ${dashboardData.value?.points.otherPoint ?? 0}`,
    to: '/dashboard/membership/point',
  },
  {
    label: '会员等级',
    value: dashboardData.value?.membership?.levelName ?? '免费版',
    icon: Crown,
    tint: 'amber',
    sub: `有效期至：${dashboardData.value?.membership?.expiresAt ?? '-'}`,
    to: '/dashboard/membership',
  },
])

interface QuickAction {
  icon: Component
  title: string
  body: string
  tint: Tint
  to?: string
  action?: 'help'
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: FilePlus, title: '新建分析', body: '分析新的案件', tint: 'sky', to: '/dashboard/cases/create' },
  { icon: FolderOpen, title: '我的案件', body: '查看所有案件', tint: 'mint', to: '/dashboard/cases' },
  { icon: Crown, title: '会员中心', body: '管理套餐和积分', tint: 'amber', to: '/dashboard/membership' },
  { icon: HelpCircle, title: '获取帮助', body: '联系客服支持', tint: 'navy', action: 'help' },
]
</script>
