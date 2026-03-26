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
            <h3 class="text-3xl font-bold text-card-foreground">{{ stats.totalCases }}</h3>
          </div>
          <div class="bg-muted text-muted-foreground p-2 rounded-md">
            <FileText class="h-6 w-6" />
          </div>
        </div>
        <div class="mt-4">
          <p class="text-sm text-muted-foreground flex items-center">
            <TrendingUp class="h-4 w-4 mr-1 text-green-500" />
            <span class="text-green-500">+{{ stats.caseIncrease }} 本月</span>
          </p>
        </div>
      </div>

      <div class="bg-card rounded-lg p-6 shadow-sm border border-border">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">分析次数</p>
            <h3 class="text-3xl font-bold text-card-foreground">{{ stats.totalAnalysis }}</h3>
          </div>
          <div class="bg-muted text-muted-foreground p-2 rounded-md">
            <BarChart3 class="h-6 w-6" />
          </div>
        </div>
        <div class="mt-4">
          <p class="text-sm text-muted-foreground flex items-center">
            <TrendingUp class="h-4 w-4 mr-1 text-green-500" />
            <span class="text-green-500">+{{ stats.analysisIncrease }} 本月</span>
          </p>
        </div>
      </div>

      <NuxtLink to="/dashboard/membership" class="block">
        <div class="bg-card rounded-lg p-6 shadow-sm border border-border hover:border-primary transition-colors h-full">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-sm font-medium text-muted-foreground mb-1">可用积分</p>
              <h3 class="text-3xl font-bold text-card-foreground">{{ pointInfo.remaining }}</h3>
            </div>
            <div class="bg-muted text-muted-foreground p-2 rounded-md">
              <Coins class="h-6 w-6" />
            </div>
          </div>
          <div class="mt-4">
            <p class="text-sm text-muted-foreground flex items-center">
              <Coins class="h-4 w-4 mr-1" />
              <span>购买: {{ pointInfo.purchasePoint }}，赠送: {{ pointInfo.otherPoint }}</span>
            </p>
          </div>
        </div>
      </NuxtLink>

      <NuxtLink to="/dashboard/membership" class="block">
        <div class="bg-card rounded-lg p-6 shadow-sm border border-border hover:border-primary transition-colors h-full">
          <div class="flex items-start justify-between">
            <div>
              <p class="text-sm font-medium text-muted-foreground mb-1">会员等级</p>
              <h3 class="text-2xl font-bold text-card-foreground">旗舰版</h3>
            </div>
            <div class="bg-muted text-muted-foreground p-2 rounded-md">
              <Crown class="h-6 w-6 text-orange-500" />
            </div>
          </div>
          <div class="mt-4">
            <div class="flex items-center text-sm text-muted-foreground">
              <span>有效期至：2029-06-15</span>
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
        <div v-for="analysis in recentAnalysis" :key="analysis.id">
          <NuxtLink :to="`/dashboard/cases/${analysis.id}`" class="block">
            <div class="bg-card rounded-lg p-4 border border-border hover:border-primary transition-colors shadow-sm">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-medium mb-1 text-foreground">{{ analysis.title }}</h3>
                  <div class="flex items-center gap-3">
                    <p class="text-sm text-muted-foreground">{{ analysis.date }}</p>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-secondary text-secondary-foreground font-normal">
                      {{ analysis.type }}
                    </span>
                    <span v-if="analysis.status === 'completed'" class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 font-normal">
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

// 模拟状态
const showAnalysisLimits = true;
const loading = false;

const stats = {
  totalCases: 38,
  caseIncrease: 2,
  totalAnalysis: 329,
  analysisIncrease: 4
};

const pointInfo = {
  remaining: "6,236",
  purchasePoint: 0,
  otherPoint: "6,236"
};

// 最新案件 (Mock)
const recentAnalysis = [
  {
    id: 1,
    title: "王某月诉薛某亮案",
    date: "2026-03-20 14:22",
    type: "民商事案件",
    status: "completed"
  },
  {
    id: 2,
    title: "王某月诉薛某亮案",
    date: "2026-03-13 23:13",
    type: "民商事案件",
    status: "completed"
  },
  {
    id: 3,
    title: "赵某诉孙某案",
    date: "2026-02-23 20:30",
    type: "民商事案件",
    status: "completed"
  },
  {
    id: 4,
    title: "某传媒公司诉葛某飞合同纠纷案",
    date: "2025-12-24 10:52",
    type: "民商事案件",
    status: "completed"
  },
  {
    id: 5,
    title: "湖北同济堂投资控股有限公司、张美华、李青诉深圳前海君创资产管理有限公司合伙协议纠纷再审审查案",
    date: "2025-12-17 00:16",
    type: "民商事案件",
    status: "completed"
  }
];
</script>
