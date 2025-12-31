<template>
  <div class="hidden lg:block relative w-0 flex-1">
    <div class="absolute inset-0 bg-gradient-to-r from-primary to-primary/80 dark:from-slate-900 dark:to-slate-800">
      <div class="absolute inset-0 bg-[url('/images/login-bg.jpg')] bg-no-repeat bg-cover opacity-10 dark:opacity-5">
      </div>
      <div class="flex flex-col justify-center h-full max-w-lg mx-auto px-8 text-white space-y-6">
        <h2 class="text-3xl font-bold">AI辅助法律分析，助力专业决策</h2>
        <p class="text-lg text-white/90">LexSeek 帮助律师精炼案件信息，洞悉复杂案情脉络，提供从概要梳理到策略预判的深度分析，助您高效决策，掌控全局。</p>
        <div class="grid grid-cols-2 gap-4 mt-8">
          <div class="bg-white/10 dark:bg-white/5 backdrop-blur-sm p-4 rounded-lg border border-white/10">
            <document-chart-icon class="h-6 w-6 mb-2" />
            <h3 class="font-medium">案情分析</h3>
            <p class="text-sm text-white/80">智能提取案件关键信息，生成概要与大事记</p>
          </div>
          <div class="bg-white/10 dark:bg-white/5 backdrop-blur-sm p-4 rounded-lg border border-white/10">
            <scale-icon class="h-6 w-6 mb-2" />
            <h3 class="font-medium">法条匹配</h3>
            <p class="text-sm text-white/80">精准匹配相关法条，确定案由</p>
          </div>
          <div class="bg-white/10 dark:bg-white/5 backdrop-blur-sm p-4 rounded-lg border border-white/10">
            <lightbulb-icon class="h-6 w-6 mb-2" />
            <h3 class="font-medium">请求权生成</h3>
            <p class="text-sm text-white/80">自动识别可能的请求权，并提供法理分析</p>
          </div>
          <div class="bg-white/10 dark:bg-white/5 backdrop-blur-sm p-4 rounded-lg border border-white/10">
            <shield-icon class="h-6 w-6 mb-2" />
            <h3 class="font-medium">抗辩预测</h3>
            <p class="text-sm text-white/80">预测对方可能的抗辩，提供应对建议</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ScaleIcon, ShieldIcon, LightbulbIcon } from "lucide-vue-next";

// 使用一个自定义图标组件替代没有的DocumentChartIcon
const DocumentChartIcon = ScaleIcon; // 这里用ScaleIcon代替
</script>
