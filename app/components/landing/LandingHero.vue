<template>
  <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pt-12 pb-16 md:pt-16 md:pb-20">
    <!-- 背景品牌光晕 -->
    <div aria-hidden="true"
      class="pointer-events-none absolute -left-[200px] -top-[200px] h-[600px] w-[600px] rounded-full"
      style="background: radial-gradient(circle, #1EEDC4 0%, transparent 70%); opacity: 0.18; filter: blur(60px);" />
    <div aria-hidden="true"
      class="pointer-events-none absolute -bottom-[250px] -right-[150px] h-[700px] w-[700px] rounded-full"
      style="background: radial-gradient(circle, #1E9EED 0%, transparent 70%); opacity: 0.22; filter: blur(80px);" />

    <div class="relative z-[1] mx-auto grid max-w-[1200px] items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
      <!-- 左栏 -->
      <div>
        <div
          class="mb-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-card/70 py-[5px] pl-[5px] pr-3 text-[13px] font-medium backdrop-blur-sm">
          <span
            class="rounded-full bg-linear-to-br from-[#1EEDC4] to-[#1E9EED] px-2 py-[3px] text-[11px] font-semibold text-white">NEW</span>
          <span class="text-foreground">合同审查 · quote 字符级高亮已上线</span>
        </div>

        <h1 class="mb-4 text-[36px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[46px]">
          专为法律人打造的<br>
          <span class="bg-gradient-brand bg-clip-text text-transparent">案情分析与诉讼辅助 AI 平台</span>
        </h1>

        <p class="mb-8 max-w-[500px] text-[19px] leading-[1.65] text-muted-foreground">
          LexSeek 帮助律师精炼案件信息，洞悉复杂案情脉络，提供从概要梳理到策略预判的深度分析，助您高效决策，掌控全局。
        </p>

        <div class="flex flex-wrap gap-3">
          <NuxtLink to="/dashboard/cases/create"
            class="rounded-md bg-linear-to-br from-[#1E9EED] to-[#090380] px-7 py-[13px] text-base font-medium text-white shadow-[0_14px_30px_-10px_rgba(9,3,128,0.45),0_4px_8px_rgba(30,158,237,0.2)] transition hover:brightness-110 active:scale-[0.98]">
            {{ btnText }}</NuxtLink>
          <NuxtLink to="/features"
            class="rounded-md border border-primary/20 bg-card/70 px-7 py-[13px] text-base font-medium text-foreground backdrop-blur-sm transition hover:bg-card">
            了解更多</NuxtLink>
        </div>

        <!-- 信任行 -->
        <div class="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-muted-foreground">
          <span v-for="t in TRUST" :key="t" class="flex items-center gap-2">
            <span class="size-1.5 shrink-0 rounded-full bg-linear-to-br from-[#1EEDC4] to-[#1E9EED]" />
            {{ t }}
          </span>
        </div>
      </div>

      <!-- 右栏：视频井 -->
      <div
        class="relative rounded-[18px] bg-gradient-brand p-0.5 shadow-[0_25px_60px_-20px_rgba(9,3,128,0.4),0_10px_20px_-10px_rgba(30,158,237,0.3)]">
        <div class="aspect-video overflow-hidden rounded-2xl bg-card">
          <video src="https://lexseek.cn/video/vcr.mp4" poster="https://lexseek.cn/video/cover.png" controls playsinline
            webkit-playsinline preload="none" class="block h-full w-full bg-black object-cover" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useCtaText } from "~/composables/useCtaText"

const btnText = useCtaText()

const TRUST = ["法条核对 · 拒绝幻觉", "案件记忆 · 越用越懂你", "多模态 · 多种材料精准识别"]
</script>
