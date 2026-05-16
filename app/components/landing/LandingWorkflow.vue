<template>
  <section class="bg-muted/30 px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-14 text-center">
        <BrandEyebrow class="mb-3">
          HOW IT WORKS
        </BrandEyebrow>
        <h2 class="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          简单三步，<span class="bg-linear-to-br from-[#1EEDC4] to-[#1E9EED] bg-clip-text text-transparent">完成案件分析</span>
        </h2>
      </div>

      <div class="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-0">
        <template v-for="(step, i) in STEPS" :key="step.n">
          <div class="relative min-h-[220px] overflow-hidden rounded-[18px] border bg-card px-7 pb-7 pt-8 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
            <!-- 柔光晕 -->
            <div
              aria-hidden="true"
              class="pointer-events-none absolute -left-[60px] -top-[60px] h-[200px] w-[200px] rounded-full"
              :style="{ background: `radial-gradient(circle, ${step.glow} 0%, transparent 70%)`, filter: 'blur(30px)' }"
            />
            <!-- 编号水印 -->
            <div
              aria-hidden="true"
              class="pointer-events-none absolute right-[18px] top-[14px] bg-clip-text text-[64px] font-extrabold leading-none tracking-[-0.04em] text-transparent opacity-70"
              :style="{ backgroundImage: step.tintBg }"
            >{{ step.n }}</div>

            <div class="relative">
              <div
                class="mb-5 flex size-14 items-center justify-center rounded-[14px]"
                :style="{ background: step.tintBg, color: step.tintFg }"
              >
                <component :is="step.icon" class="size-[26px]" />
              </div>
              <h3 class="mb-2 text-[22px] font-semibold leading-[1.3]">{{ step.title }}</h3>
              <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ step.body }}</p>
            </div>
          </div>

          <!-- 连接箭头（仅桌面） -->
          <div
            v-if="i < STEPS.length - 1"
            aria-hidden="true"
            class="hidden w-14 items-center justify-center text-muted-foreground opacity-50 lg:flex"
          >
            <svg width="36" height="14" viewBox="0 0 36 14" fill="none">
              <path d="M0 7 L30 7" stroke="url(#workflowArrowGrad)" stroke-width="1.5" stroke-dasharray="3 3" />
              <path d="M26 2 L34 7 L26 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
              <defs>
                <linearGradient id="workflowArrowGrad" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#1EEDC4" />
                  <stop offset="1" stop-color="#1E9EED" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { FilePlusIcon, CpuIcon, CheckCircleIcon } from "lucide-vue-next"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"

const STEPS = [
  {
    n: "01",
    icon: FilePlusIcon,
    title: "输入案情",
    body: "输入或上传案件材料，包括事实描述、证据材料等关键信息。",
    tintBg: "var(--tint-mint-bg)",
    tintFg: "var(--tint-mint-fg)",
    glow: "rgba(30,237,196,0.18)",
  },
  {
    n: "02",
    icon: CpuIcon,
    title: "AI 分析",
    body: "我们的 AI 系统会自动分析案情，提取关键信息，生成分析结果。",
    tintBg: "var(--tint-sky-bg)",
    tintFg: "var(--tint-sky-fg)",
    glow: "rgba(30,158,237,0.18)",
  },
  {
    n: "03",
    icon: CheckCircleIcon,
    title: "获取结果",
    body: "查看分析结果，包括案情概要、大事记、案由、请求权分析等内容。",
    tintBg: "var(--tint-navy-bg)",
    tintFg: "var(--tint-navy-fg)",
    glow: "rgba(80,72,192,0.18)",
  },
]
</script>
