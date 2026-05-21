<template>
  <section class="bg-background px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-12 text-center">
        <BrandEyebrow class="mb-3">
          THE PROBLEM · 行业痛点
        </BrandEyebrow>
        <h2 class="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          通用 AI 在法律实务中的<GradientText>“三大硬伤”</GradientText>
        </h2>
      </div>

      <div class="grid gap-5 md:grid-cols-3">
        <div v-for="item in ITEMS" :key="item.title"
          class="relative overflow-hidden rounded-2xl border bg-card px-8 pb-8 pt-9 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
          <!-- 顶部渐变描边 -->
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-[3px]" :style="{ background: item.stroke }" />
          <!-- 角落淡晕 -->
          <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-[60%]"
            :style="{ background: `linear-gradient(180deg, ${item.wash} 0%, transparent 100%)` }" />
          <div class="relative">
            <div class="mb-4 bg-clip-text text-[64px] font-bold leading-none tracking-[-0.04em] text-transparent"
              :style="{ backgroundImage: item.stroke }">{{ item.stat }}</div>
            <h3 class="mb-2 text-xl font-semibold leading-[1.3]">{{ item.title }}</h3>
            <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ item.body }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"

const ITEMS = [
  {
    stat: "50%",
    title: "校验内耗",
    body: "通用 AI 频繁伪造法条与案例，导致律师必须耗费过半精力进行人工复核，极易带来执业风险。",
    stroke: "linear-gradient(90deg, #1EEDC4, #1E9EED)",
    wash: "color-mix(in srgb, #1EEDC4 12%, transparent)",
  },
  {
    stat: "75%",
    title: "逻辑断层",
    body: "通用 AI 缺乏真实的法律实务推演逻辑，无法直接输出符合实务标准的专业研判方案。",
    stroke: "linear-gradient(90deg, #1E9EED, #0A4DA8)",
    wash: "color-mix(in srgb, #1E9EED 12%, transparent)",
  },
  {
    stat: "50%",
    title: "记忆流失",
    body: " 受限于单次对话的上下文极限，多轮交流中极易遗忘基础案件事实，难以应对长周期办案需求。",
    stroke: "linear-gradient(90deg, #0A4DA8, #090380)",
    wash: "color-mix(in srgb, #4A45B0 12%, transparent)",
  },
]
</script>
