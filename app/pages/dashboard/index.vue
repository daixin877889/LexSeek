<template>
  <div class="p-4 md:p-6 lg:p-8 w-full">
    <!-- 分析次数限制提示 -->
    <div v-if="showAnalysisLimits" class="w-full p-4 mb-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
      <p class="text-sm text-foreground">
        您正在使用的是 <strong class="text-primary">{{ '免费版' }}</strong>，今日可用分析次数 <strong>{{ 0 }} / {{ 10 }}</strong> ，本月可用分析次数 <strong>{{ 0 }} / {{ 100 }}</strong>。
      </p>
      <Button variant="default" size="sm">立即升级</Button>
    </div>

    <!-- 活动横幅 -->
    <div class="w-full p-3 mb-8 bg-primary rounded-md text-center shadow-sm">
      <p class="text-sm md:text-base text-primary-foreground font-medium">
        <a href="javascript:void(0)" class="hover:opacity-80 transition-opacity">
          限时活动：联系客服可领取7天延长使用兑换码！<span class="underline underline-offset-4 ml-1">点此联系客服</span>
        </a>
      </p>
    </div>

    <!-- 欢迎语 -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2 text-foreground">欢迎回来，{{ userStore.userInfo?.name || '戴鑫' }}</h1>
      <p class="text-muted-foreground">查看您的案件分析概览和最近活动</p>
    </div>

    <!-- 数据概览卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-card rounded-lg p-6 shadow-sm border border-border">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">总案件数</p>
            <h3 class="text-3xl font-bold text-card-foreground">{{ dashboardData.value?.statistics.totalCases ?? 0 }}</h3>
          </div>
          <div class="bg-muted text-muted-foreground p-2 rounded-md">
            <FileText class="h-6 w-6" />
          </div>
        </div>
        <div class="mt-4">
          <p class="text-sm text-muted-foreground flex items-center">
            <TrendingUp class="h-4 w-4 mr-1 text-green-500" />
            <span class="text-green-500">+{{ dashboardData.value?.statistics.caseIncrease ?? 0 }} 本月</span>
          </p>
        </div>
      </div>

      <div class="bg-card rounded-lg p-6 shadow-sm border border-border">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">分析次数</p>
            <h3 class="text-3xl font-bold text-card-foreground">{{ dashboardData.value?.statistics.totalAnalysis ?? 0 }}</h3>
          </div>
          <div class="bg-muted text-muted-foreground p-2 rounded-md">
            <BarChart3 class="h-6 w-6" />
          </div>
        </div>
        <div class="mt-4">
          <p class="text-sm text-muted-foreground flex items-center">
            <TrendingUp class="h-4 w-4 mr-1 text-green-500" />
            <span class="text-green-500">+{{ dashboardData.value?.statistics.analysisIncrease ?? 0 }} 本月</span>
          </p>
        </div>
      </div>

      <NuxtLink to="/dashboard/membership" class="block">
        <div class="bg-card rounded-lg p-6 shadow-sm border border-border hover:border-primary transition-colors h-full">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-sm font-medium text-muted-foreground mb-1">可用积分</p>
              <h3 class="text-3xl font-bold text-card-foreground">{{ dashboardData.value?.points.remaining ?? 0 }}</h3>
            </div>
            <div class="bg-muted text-muted-foreground p-2 rounded-md">
              <Coins class="h-6 w-6" />
            </div>
          </div>
          <div class="mt-4">
            <p class="text-sm text-muted-foreground flex items-center">
              <Coins class="h-4 w-4 mr-1" />
              <span>购买: {{ dashboardData.value?.points.purchasePoint ?? 0 }}，赠送: {{ dashboardData.value?.points.otherPoint ?? 0 }}</span>
            </p>
          </div>
        </div>
      </NuxtLink>

      <NuxtLink to="/dashboard/membership" class="block">
        <div class="bg-card rounded-lg p-6 shadow-sm border border-border hover:border-primary transition-colors h-full">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-sm font-medium text-muted-foreground mb-1">会员等级</p>
              <h3 class="text-2xl font-bold text-card-foreground">{{ dashboardData.value?.membership?.levelName ?? '免费版' }}</h3>
            </div>
            <div class="bg-muted text-muted-foreground p-2 rounded-md">
              <Crown class="h-6 w-6 text-orange-500" />
            </div>
          </div>
          <div class="mt-4">
            <div class="flex items-center text-sm text-muted-foreground">
              <span>有效期至：{{ dashboardData.value?.membership?.expiresAt ?? '-' }}</span>
            </div>
          </div>
        </div>
      </NuxtLink>
    </div>

    <!-- 快速操作 -->
    <div class="mb-8">
      <h2 class="text-xl font-semibold mb-4 text-foreground">快速操作</h2>
      <div class="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <NuxtLink to="/dashboard/analysis/new" class="bg-card hover:bg-muted/50 hover:border-primary transition-colors rounded-lg p-4 border border-border flex items-center gap-4 shadow-sm">
          <div class="bg-muted p-2 rounded-md">
            <FilePlus class="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">新建分析</h3>
            <p class="text-sm text-muted-foreground mt-0.5">分析新的案件</p>
          </div>
        </NuxtLink>

        <NuxtLink to="/dashboard/cases" class="bg-card hover:bg-muted/50 hover:border-primary transition-colors rounded-lg p-4 border border-border flex items-center gap-4 shadow-sm">
          <div class="bg-muted p-2 rounded-md">
            <FolderOpen class="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">我的案件</h3>
            <p class="text-sm text-muted-foreground mt-0.5">查看所有案件</p>
          </div>
        </NuxtLink>

        <NuxtLink to="/dashboard/membership" class="bg-card hover:bg-muted/50 hover:border-primary transition-colors rounded-lg p-4 border border-border flex items-center gap-4 shadow-sm">
          <div class="bg-muted p-2 rounded-md">
            <Crown class="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">会员中心</h3>
            <p class="text-sm text-muted-foreground mt-0.5">管理套餐和积分</p>
          </div>
        </NuxtLink>

        <div class="bg-card hover:bg-muted/50 hover:border-primary transition-colors rounded-lg p-4 border border-border flex items-center gap-4 shadow-sm cursor-pointer">
          <div class="bg-muted p-2 rounded-md">
            <HelpCircle class="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 class="font-medium text-foreground">获取帮助</h3>
            <p class="text-sm text-muted-foreground mt-0.5">联系客服支持</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近分析 -->
    <div class="mb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-foreground">最新案件</h2>
        <NuxtLink to="/dashboard/cases" class="text-sm text-primary hover:underline">查看全部</NuxtLink>
      </div>

      <div class="space-y-3">
        <div v-for="c in dashboardData.value?.recentCases" :key="c.id">
          <NuxtLink :to="`/dashboard/cases/${c.id}`" class="block">
            <div class="bg-card rounded-lg p-4 border border-border hover:border-primary transition-colors shadow-sm">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-medium mb-1 text-foreground">{{ c.title }}</h3>
                  <div class="flex items-center gap-3">
                    <p class="text-sm text-muted-foreground">{{ c.date }}</p>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-secondary text-secondary-foreground font-normal">
                      {{ c.type }}
                    </span>
                    <span v-if="c.status === 'in_progress'" class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-normal">
                      进行中
                    </span>
                    <span v-else class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 font-normal">
                      已完成
                    </span>
                  </div>
                </div>
                <div class="text-muted-foreground hover:text-primary p-2">
                  <ExternalLink class="h-4 w-4" />
                </div>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
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
  TrendingDown,
  Activity,
  ExternalLink,
  UserRound
} from "lucide-vue-next";

definePageMeta({
  title: "工作台",
  layout: "dashboard-layout",
});

const userStore = useUserStore();

// 调用 Dashboard API
const { data: dashboardData } = await useApi<DashboardResponse>('/api/v1/dashboard')

// mock 状态（当前 API 未返回分析次数限制数据，保留展示）
const showAnalysisLimits = true;
</script>
