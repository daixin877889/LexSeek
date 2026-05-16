<template>
  <section class="bg-muted/30 px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-12 text-center">
        <BrandEyebrow class="mb-3">
          THE SOLUTION · 解决方案
        </BrandEyebrow>
        <h2 class="mb-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          一站式<GradientText>智慧法律AI</GradientText>
        </h2>
        <p class="mx-auto max-w-[640px] text-base leading-[1.6] text-muted-foreground">
          我们用一个平台，三大支柱，彻底解决行业痛点，将法律工作化繁为简。
        </p>
      </div>

      <div class="grid gap-5 md:grid-cols-3">
        <div
          v-for="item in PILLARS"
          :key="item.title"
          class="rounded-2xl border bg-card p-8 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
        >
          <div
            class="mb-5 flex size-12 items-center justify-center rounded-[12px]"
            :style="{ background: item.tintBg, color: item.tintFg }"
          >
            <component :is="item.icon" class="size-[26px]" />
          </div>
          <h3 class="mb-2 text-xl font-semibold leading-[1.3]">{{ item.title }}</h3>
          <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ item.body }}</p>
        </div>
      </div>

      <div class="mt-10 flex justify-center">
        <NuxtLink
          to="/dashboard/cases/create"
          class="rounded-md bg-linear-to-br from-[#1E9EED] to-[#090380] px-7 py-[13px] text-base font-medium text-white shadow-[0_14px_30px_-10px_rgba(9,3,128,0.45),0_4px_8px_rgba(30,158,237,0.2)] transition hover:brightness-110 active:scale-[0.98]"
        >{{ btnText }}</NuxtLink>
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
    title: "分析引擎",
    body: "多模态AI驱动，深度分析案情与合同，提供数据驱动的决策洞见。",
    tintBg: "var(--tint-mint-bg)",
    tintFg: "var(--tint-mint-fg)",
  },
  {
    icon: FileText,
    title: "智能生成系统",
    body: "一键生成标准化法律文书，将律师从重复性写作中解放，效率倍增。",
    tintBg: "var(--tint-sky-bg)",
    tintFg: "var(--tint-sky-fg)",
  },
  {
    icon: Users,
    title: "协同管理平台",
    body: "案件、文档、任务云端管理，打破团队信息壁垒，实现无缝协同。(即将上线)",
    tintBg: "var(--tint-navy-bg)",
    tintFg: "var(--tint-navy-fg)",
  },
]
</script>
