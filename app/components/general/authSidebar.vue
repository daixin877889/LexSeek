<template>
  <div class="relative hidden overflow-hidden bg-gradient-brand px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between">
    <!-- 装饰光晕 -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -left-[100px] -top-20 h-[400px] w-[400px] rounded-full"
      style="background: #1EEDC4; opacity: 0.35; filter: blur(70px);"
    />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-[100px] -right-[50px] h-[380px] w-[380px] rounded-full"
      style="background: #090380; opacity: 0.6; filter: blur(60px);"
    />
    <img
      src="/logo-white.svg"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-20 -left-10 h-[360px] w-[360px] opacity-[0.06]"
    >

    <!-- logo lockup -->
    <div class="relative z-[1] flex items-center gap-3">
      <div class="flex size-11 items-center justify-center rounded-[12px] bg-white shadow-[0_8px_22px_-6px_rgba(0,0,0,0.25)]">
        <img src="/logo.svg" alt="" class="size-[30px]">
      </div>
      <h1 translate="no" class="text-[22px] font-bold">
        LexSeek <span class="font-medium opacity-80">｜ 法索 AI</span>
      </h1>
    </div>

    <!-- 标语 -->
    <div class="relative z-[1] max-w-[460px]">
      <p class="mb-4 text-[13px] font-medium uppercase tracking-[0.08em] opacity-85">FOR LEGAL PROFESSIONALS</p>
      <h2 class="mb-[18px] text-[38px] font-bold leading-[1.25] tracking-[-0.025em]">
        让法律工作<br>
        <span class="bg-linear-to-r from-white to-[#C8E4FB] bg-clip-text text-transparent">更高效、更精准</span>
      </h2>
      <p class="text-[16px] leading-[1.65] opacity-90">
        数万律师与企业法务的选择。从案情概要到判决趋势预测，让 AI 成为您可靠的办案伙伴。
      </p>
    </div>

    <!-- 信任数据 -->
    <div class="relative z-[1] flex gap-8">
      <div v-for="s in STATS" :key="s.label">
        <div class="text-[28px] font-bold">{{ s.value }}</div>
        <div class="mt-1.5 text-[12px] font-medium opacity-85">{{ s.label }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const STATS = [
  { value: "3万+", label: "注册律师" },
  { value: "120万", label: "累计案件" },
  { value: "98%", label: "用户满意度" },
]
</script>
