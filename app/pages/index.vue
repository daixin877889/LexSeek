<template>
  <div>
    <!-- 英雄区域 -->
    <section class="py-12 md:py-24 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 class="text-3xl md:text-5xl font-bold tracking-tight mb-4 leading-tight md:leading-normal">
              专为法律人打造的
              <br />案情分析与诉讼辅助AI平台
            </h1>
            <p class="text-xl text-muted-foreground mb-8">LexSeek 帮助律师精炼案件信息，洞悉复杂案情脉络，提供从概要梳理到策略预判的深度分析，助您高效决策，掌控全局。</p>
            <div class="flex flex-col sm:flex-row gap-4">
              <NuxtLink to="/dashboard/analysis"
                class="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
                {{ btnText }}</NuxtLink>
              <NuxtLink to="/features"
                class="inline-flex items-center justify-center px-6 py-3 bg-muted text-foreground font-medium rounded-md hover:bg-muted/80 transition-colors">
                了解更多</NuxtLink>
            </div>
          </div>
          <div class="relative">
            <div class="bg-linear-to-r from-primary/20 to-primary/10 rounded-lg">
              <video class="w-full h-full object-cover rounded-xl shadow-lg" src="https://lexseek.cn/video/vcr.mp4"
                webkit-playsinline playsinline poster="https://lexseek.cn/video/cover.png" controls></video>
            </div>
          </div>
        </div>
      </div>
    </section>
    <!-- 痛点 -->
    <section class="py-12 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">资源受限的“大多数”</h2>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <div class="text-6xl font-bold text-primary mb-4">50%</div>
            <h3 class="text-xl font-semibold mb-2">时间浪费</h3>
            <p class="text-muted-foreground">法律专业人士高达一半的工作时间被耗费在重复性的文书审阅和信息检索上。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <div class="text-6xl font-bold text-primary mb-4">75%</div>
            <h3 class="text-xl font-semibold mb-2">经验鸿沟</h3>
            <p class="text-muted-foreground">青年律师的成长和办案质量高度受限于个人经验，行业知识难以标准化传承。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <div class="text-6xl font-bold text-primary mb-4">50%</div>
            <h3 class="text-xl font-semibold mb-2">人才困局</h3>
            <p class="text-muted-foreground">一半的小型律所难以吸引和留住人才，高强度的重复性工作是职业倦怠的主要原因。</p>
          </div>
        </div>
      </div>
    </section>
    <!-- 解决方案 -->
    <section class="py-12 bg-muted/30 px-4">
      <div class="max-w-[1200px] mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">解决方案：一站式智慧法律AI</h2>
          <p class="text-lg text-muted-foreground max-w-2xl mx-auto">我们用一个平台，三大支柱，彻底解决行业痛点，将法律工作化繁为简。</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <file-text-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">分析引擎</h3>
            <p class="text-muted-foreground">多模态AI驱动，深度分析案情与合同，提供数据驱动的决策洞见。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <calendar-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">智能生成系统</h3>
            <p class="text-muted-foreground">一键生成标准化法律文书，将律师从重复性写作中解放，效率倍增。</p>
          </div>

          <div class="bg-card rounded-lg p-6 shadow-sm flex flex-col items-center text-center">
            <calendar-icon class="h-10 w-10 text-primary mb-4" />
            <h3 class="text-xl font-semibold mb-2">协同管理平台</h3>
            <p class="text-muted-foreground">案件、文档、任务云端管理，打破团队信息壁垒，实现无缝协同。(即将上线)</p>
          </div>
        </div>

        <div class="flex justify-center mt-10">
          <NuxtLink to="/dashboard/analysis"
            class="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
            {{ btnText }}</NuxtLink>
        </div>
      </div>
    </section>

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
          <NuxtLink to="/dashboard/analysis"
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
          <NuxtLink to="/dashboard/analysis"
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
          <NuxtLink to="/dashboard/analysis"
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

const authStore = useAuthStore();

const btnText = computed(() => {
  if (authStore.isAuthenticated) {
    return "开始分析";
  }
  return "免费体验";
});
</script>
