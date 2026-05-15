<template>
  <section class="relative overflow-hidden bg-gradient-brand px-4 py-20 text-white">
    <!-- 装饰光晕 -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -top-[100px] left-[20%] h-[400px] w-[400px] rounded-full"
      style="background: #1EEDC4; opacity: 0.25; filter: blur(80px);"
    />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-[100px] right-[15%] h-[350px] w-[350px] rounded-full"
      style="background: #090380; opacity: 0.4; filter: blur(80px);"
    />
    <!-- 淡 logo 水印 -->
    <img
      src="/logo-white.svg"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-[120px] -right-[60px] h-[420px] w-[420px] opacity-[0.08]"
    >

    <div class="relative z-[1] mx-auto max-w-[920px] text-center">
      <div class="mb-6 inline-flex size-20 items-center justify-center rounded-full bg-white/95 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.3)]">
        <img src="/logo.svg" alt="LexSeek" class="size-12">
      </div>
      <h2 class="mb-4 text-[28px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[40px]">
        立即开始使用 <span translate="no">LexSeek</span>
      </h2>
      <p class="mx-auto mb-9 max-w-[640px] text-[20px] leading-[1.55] opacity-90">
        加入成千上万的法律专业人士，体验法律 AI 辅助案件分析带来的效率提升
      </p>
      <div class="flex flex-wrap justify-center gap-3.5">
        <NuxtLink
          to="/dashboard/cases/create"
          class="rounded-md bg-white px-8 py-3.5 text-base font-medium text-[#0A4DA8] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3)] transition hover:brightness-95 active:scale-[0.98]"
        >{{ btnText }}</NuxtLink>
        <NuxtLink
          to="/features"
          class="rounded-md border border-white/30 bg-white/[0.12] px-8 py-3.5 text-base font-medium text-white backdrop-blur-md transition hover:bg-white/20"
        >了解更多</NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useCtaText } from "~/composables/useCtaText"

const btnText = useCtaText()
</script>
