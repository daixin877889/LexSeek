<template>
  <section class="bg-background px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-12 text-center">
        <p class="mb-3 text-[13px] font-medium uppercase tracking-[0.08em] text-primary">
          THE PROBLEM · 行业痛点
        </p>
        <h2 class="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          资源受限的<span class="bg-linear-to-br from-[#1E9EED] to-[#090380] bg-clip-text text-transparent">“大多数”</span>
        </h2>
      </div>

      <div class="grid gap-5 md:grid-cols-3">
        <div
          v-for="item in ITEMS"
          :key="item.title"
          class="relative overflow-hidden rounded-2xl border bg-card px-8 pb-8 pt-9 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
        >
          <!-- 顶部渐变描边 -->
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-[3px]" :style="{ background: item.stroke }" />
          <!-- 角落淡晕 -->
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 h-[60%]"
            :style="{ background: `linear-gradient(180deg, ${item.wash} 0%, transparent 100%)` }"
          />
          <div class="relative">
            <div
              class="mb-4 bg-clip-text text-[64px] font-bold leading-none tracking-[-0.04em] text-transparent"
              :style="{ backgroundImage: item.stroke }"
            >{{ item.stat }}</div>
            <h3 class="mb-2 text-xl font-semibold leading-[1.3]">{{ item.title }}</h3>
            <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ item.body }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
const ITEMS = [
  {
    stat: "50%",
    title: "时间浪费",
    body: "法律专业人士高达一半的工作时间被耗费在重复性的文书审阅和信息检索上。",
    stroke: "linear-gradient(90deg, #1EEDC4, #1E9EED)",
    wash: "color-mix(in srgb, #1EEDC4 12%, transparent)",
  },
  {
    stat: "75%",
    title: "经验鸿沟",
    body: "青年律师的成长和办案质量高度受限于个人经验，行业知识难以标准化传承。",
    stroke: "linear-gradient(90deg, #1E9EED, #0A4DA8)",
    wash: "color-mix(in srgb, #1E9EED 12%, transparent)",
  },
  {
    stat: "50%",
    title: "人才困局",
    body: "一半的小型律所难以吸引和留住人才，高强度的重复性工作是职业倦怠的主要原因。",
    stroke: "linear-gradient(90deg, #0A4DA8, #090380)",
    wash: "color-mix(in srgb, #4A45B0 12%, transparent)",
  },
]
</script>
