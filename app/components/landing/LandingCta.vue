<template>
  <section class="relative overflow-hidden bg-gradient-brand px-4 py-20 text-white">
    <!-- 装饰光晕 -->
    <div aria-hidden="true"
      class="pointer-events-none absolute -top-[100px] left-[20%] h-[400px] w-[400px] rounded-full"
      style="background: #1EEDC4; opacity: 0.25; filter: blur(80px);" />
    <div aria-hidden="true"
      class="pointer-events-none absolute -bottom-[100px] right-[15%] h-[350px] w-[350px] rounded-full"
      style="background: #090380; opacity: 0.4; filter: blur(80px);" />
    <!-- 淡 logo 水印 -->
    <img src="/logo-white.svg" alt="" aria-hidden="true"
      class="pointer-events-none absolute -bottom-[120px] -right-[60px] h-[420px] w-[420px] opacity-[0.08]">

    <div class="relative z-[1] mx-auto max-w-[920px] text-center">
      <div
        class="mb-6 inline-flex size-20 items-center justify-center rounded-full bg-white/95 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.3)]">
        <img src="/logo.svg" alt="LexSeek" class="size-12">
      </div>
      <h2 class="mb-4 text-[28px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[40px]">
        <slot name="title">立即开始使用 <span translate="no">LexSeek</span></slot>
      </h2>
      <p class="mx-auto mb-9 max-w-[650px] text-[20px] leading-[1.55] opacity-90">
        <slot name="description">加入成千上万的法律专业人士，体验法律 AI 辅助案件分析带来的效率提升</slot>
      </p>
      <div class="flex flex-wrap justify-center gap-3.5">
        <NuxtLink :to="primaryTo" :class="primaryBtnClass">
          {{ primaryText ?? defaultPrimaryText }}
        </NuxtLink>
        <button v-if="secondaryHandler" type="button" :class="secondaryBtnClass" @click="secondaryHandler">
          {{ secondaryText }}
        </button>
        <NuxtLink v-else :to="secondaryTo" :class="secondaryBtnClass">
          {{ secondaryText }}
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useCtaText } from "~/composables/useCtaText"

// 默认值匹配首页旧行为；其他营销页可通过 props/slot 自定义。
// secondaryHandler 优先于 secondaryTo：传了点击回调就渲染 button 触发自定义动作（如唤起客服弹窗）。
withDefaults(defineProps<{
  primaryText?: string
  primaryTo?: string
  secondaryText?: string
  secondaryTo?: string
  secondaryHandler?: () => void
}>(), {
  primaryTo: '/dashboard/cases/create',
  secondaryText: '了解更多',
  secondaryTo: '/features',
})

// 未传 primaryText 时跟随登录态：未登录"免费体验"，已登录"开始分析"。
const defaultPrimaryText = useCtaText()

const primaryBtnClass = 'rounded-md bg-white px-8 py-3.5 text-base font-medium text-[#0A4DA8] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3)] transition hover:brightness-95 active:scale-[0.98]'
const secondaryBtnClass = 'rounded-md border border-white/30 bg-white/[0.12] px-8 py-3.5 text-base font-medium text-white backdrop-blur-md transition hover:bg-white/20'
</script>
