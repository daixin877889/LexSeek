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
          法索 AI提供全面的案件分析工具，帮助您高效地处理法律实务案件
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="item in FEATURES" :key="item.title"
          class="rounded-[14px] border bg-card p-6 transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
          <div class="mb-4 flex size-12 items-center justify-center rounded-[12px]"
            :style="{ background: item.tintBg }">
            <div class="size-[26px]" :style="{
              backgroundColor: item.tintFg,
              WebkitMask: `url(/images/module_icon/${item.icon}.svg) center / contain no-repeat`,
              mask: `url(/images/module_icon/${item.icon}.svg) center / contain no-repeat`,
            }" />
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
  { icon: "summary", title: "案情概要生成", body: "智能解构复杂案卷与多模态碎料，秒级生成结构化事实概要，快速建立全局认知。", ...MINT },
  { icon: "chronicle", title: "案件大事记", body: "自动梳理案情时序脉络，精准锚定争议焦点、诉讼时效等关键程序性节点。", ...SKY },
  { icon: "cause", title: "核心案由甄别", body: "深度关联国家标准案由规定，智能推荐并判定最符合案件事实的法定诉讼案由。", ...SKY },
  { icon: "claim", title: "请求权基础研判", body: "系统级拆解支持诉求的核心构成要件，自动匹配对应实体法规范，夯实诉讼根基。", ...NAVY },
  { icon: "defense", title: "对方抗辩预测", body: "模拟复盘对方当事人可能的答辩思路与抗辩焦点，辅助代理人提前筹备反驳论据。", ...MINT },
  { icon: "evidence", title: "证据清单构建", body: "依据诉讼请求与争议要件，智能推荐符合法定证明标准的关键证据并梳理证明链条。", ...SKY },
  { icon: "trend", title: "诉请法律合理性审查", body: "深度对齐法官裁判要素，无需依赖实体证据，从法律逻辑维度研判当事人陈述的合理性与支持概率。", ...NAVY },
  { icon: "lawyerLetter", title: "法律文书初稿起草", body: "一键快速适配标准格式起草专业律师函、起诉状及答辩状初稿，沉淀核心法律事实要点。", ...SKY },
]
</script>
