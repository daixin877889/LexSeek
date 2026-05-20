<template>
  <section class="bg-muted/30 px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-12 text-center">
        <BrandEyebrow class="mb-3">
          THE SOLUTION · 解决方案
        </BrandEyebrow>
        <h2 class="mb-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          <GradientText>AI 原生办案工作台</GradientText>
        </h2>
        <p class="mx-auto max-w-[640px] text-base leading-[1.6] text-muted-foreground">
          我们用全流程的智能体工作流，将复杂诉讼化繁为简，打破效能天花板。
        </p>
      </div>

      <div class="grid gap-5 md:grid-cols-3">
        <div v-for="item in PILLARS" :key="item.title"
          class="rounded-2xl border bg-card p-8 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
          <div class="mb-5 flex size-12 items-center justify-center rounded-[12px]"
            :style="{ background: item.tintBg, color: item.tintFg }">
            <component :is="item.icon" class="size-[26px]" />
          </div>
          <h3 class="mb-2 text-xl font-semibold leading-[1.3]">{{ item.title }}</h3>
          <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ item.body }}</p>
        </div>
      </div>

      <div class="mt-10 flex justify-center">
        <NuxtLink to="/dashboard/cases/create"
          class="rounded-md bg-linear-to-br from-[#1E9EED] to-[#090380] px-7 py-[13px] text-base font-medium text-white shadow-[0_14px_30px_-10px_rgba(9,3,128,0.45),0_4px_8px_rgba(30,158,237,0.2)] transition hover:brightness-110 active:scale-[0.98]">
          {{ btnText }}</NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Cpu, FileText, Users } from "lucide-vue-next"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import { useCtaText } from "~/composables/useCtaText"

const btnText = useCtaText()

const PILLARS = [
  {
    icon: Cpu,
    title: "「小索」全流程研判引擎",
    body: "深度复刻资深律师思维，支持从复杂案卷、图片到多模态录音输入，秒级重构 7 大诉讼研判要件。",
    tintBg: "var(--tint-mint-bg)",
    tintFg: "var(--tint-mint-fg)",
  },
  {
    icon: FileText,
    title: "90+ 标杆诉讼文书生成",
    body: "深度融合最高院裁判规范与事实要件，一键自动适配生成起诉状、答辩状及核心抗辩思路。",
    tintBg: "var(--tint-sky-bg)",
    tintFg: "var(--tint-sky-fg)",
  },
  {
    icon: Users,
    title: "“一案一项目”双层记忆空间",
    body: "行业首发工作记忆与案件记忆并行方案，彻底终结通用 AI 对话中的易失忆缺陷，实现案件全生命周期动态协同。",
    tintBg: "var(--tint-navy-bg)",
    tintFg: "var(--tint-navy-fg)",
  },
]
</script>
