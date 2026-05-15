<template>
  <section class="bg-background px-4 py-20">
    <div class="mx-auto max-w-[1200px]">
      <div class="mb-14 text-center">
        <BrandEyebrow class="mb-3">
          FEATURES · 核心能力
        </BrandEyebrow>
        <h2 class="mb-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
          强大的功能，<GradientText>简化您的工作流程</GradientText>
        </h2>
        <p class="mx-auto max-w-[640px] text-[18px] leading-[1.6] text-muted-foreground">
          LexSeek 提供全面的案件分析工具，帮助您更高效地处理法律案件
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="item in FEATURES"
          :key="item.title"
          class="rounded-[14px] border bg-card p-6 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
        >
          <div
            class="mb-4 flex size-12 items-center justify-center rounded-[12px]"
            :style="{ background: item.tintBg }"
          >
            <div
              class="size-[26px]"
              :style="{
                backgroundColor: item.tintFg,
                WebkitMask: `url(/images/module_icon/${item.icon}.svg) center / contain no-repeat`,
                mask: `url(/images/module_icon/${item.icon}.svg) center / contain no-repeat`,
              }"
            />
          </div>
          <h3 class="mb-1.5 text-[17px] font-semibold leading-[1.3]">{{ item.title }}</h3>
          <p class="text-[13.5px] leading-[1.65] text-muted-foreground">{{ item.body }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"

const MINT = { tintBg: "var(--tint-mint-bg)", tintFg: "var(--tint-mint-fg)" }
const SKY = { tintBg: "var(--tint-sky-bg)", tintFg: "var(--tint-sky-fg)" }
const NAVY = { tintBg: "var(--tint-navy-bg)", tintFg: "var(--tint-navy-fg)" }

const FEATURES = [
  { icon: "summary", title: "案情概要生成", body: "自动分析案件材料，生成简洁明了的案情概要，帮助您快速把握案件要点。", ...MINT },
  { icon: "chronicle", title: "案件大事记", body: "自动整理案件时间线，按时间顺序呈现关键事件，便于您全面了解案件发展过程。", ...SKY },
  { icon: "cause", title: "案由确认", body: "智能识别案件类型和案由，提供法律依据，帮助您准确定位案件性质。", ...SKY },
  { icon: "claim", title: "请求权生成与分析", body: "根据案情自动生成可能的请求权，并提供详细分析和法律依据。", ...NAVY },
  { icon: "defense", title: "对方抗辩预测", body: "预测对方可能的抗辩理由和策略，帮助您提前准备应对方案。", ...MINT },
  { icon: "evidence", title: "证据清单", body: "分析并整理案件所需证据清单建议，让您胸有成竹。", ...SKY },
  { icon: "trend", title: "判决趋势预测", body: "案件法律合理性审查、预测判决趋势，助您及时调整诉讼策略。", ...NAVY },
  { icon: "lawyerLetter", title: "律师函生成", body: "一键生成专业律师函，自定义抬头与签章。", ...SKY },
]
</script>
