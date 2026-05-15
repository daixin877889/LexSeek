<template>
  <div>
    <!-- 页面标题 -->
    <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pt-[72px] pb-20">
      <HeroGlow />
      <div class="relative z-[1] mx-auto max-w-[900px] text-center">
        <BrandEyebrow class="mb-3.5">FEATURES</BrandEyebrow>
        <h1 class="mb-4 text-[36px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[48px]">
          全方位<span class="bg-gradient-brand bg-clip-text text-transparent">法律分析工具</span>
        </h1>
        <p class="mx-auto max-w-[680px] text-[19px] leading-[1.6] text-muted-foreground">
          了解 LexSeek 如何通过 AI 技术赋能法律分析，提升您的工作效率
        </p>
      </div>
    </section>

    <!-- 核心模块 -->
    <section class="bg-background px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-14 text-center">
          <BrandEyebrow class="mb-3">CORE MODULES · 核心模块</BrandEyebrow>
          <h2 class="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[36px]">
            围绕案件全生命周期的<GradientText>四大能力</GradientText>
          </h2>
        </div>
        <div class="flex flex-col gap-6">
          <div
            v-for="(f, i) in MAIN_FEATURES"
            :key="f.title"
            class="grid items-center gap-9 rounded-[18px] border bg-card p-7 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:shadow-md lg:grid-cols-2"
          >
            <div :class="i % 2 === 1 ? 'lg:order-2' : ''">
              <div class="mb-3 flex items-center gap-3.5">
                <div
                  class="flex size-12 shrink-0 items-center justify-center rounded-[12px]"
                  :style="{ background: f.tintBg, color: f.tintFg }"
                >
                  <component :is="f.icon" class="size-[22px]" />
                </div>
                <h3 class="text-[24px] font-bold leading-[1.25]">{{ f.title }}</h3>
              </div>
              <p class="mb-4 text-[15px] leading-[1.65] text-muted-foreground">{{ f.body }}</p>
              <ul class="flex flex-col gap-2">
                <li v-for="b in f.bullets" :key="b" class="flex items-start gap-2 text-[14px] leading-[1.5]">
                  <CircleCheck class="mt-px size-[18px] shrink-0 text-green-500" />
                  {{ b }}
                </li>
              </ul>
            </div>
            <div
              class="overflow-hidden rounded-[14px] bg-gradient-brand p-0.5"
              :class="i % 2 === 1 ? 'lg:order-1' : ''"
            >
              <img :src="f.img" :alt="f.title" class="block aspect-[16/10] h-full w-full rounded-[12px] object-cover">
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 拓展能力 -->
    <section class="bg-muted/30 px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-12 text-center">
          <BrandEyebrow class="mb-3">EXTENDED · 拓展能力</BrandEyebrow>
          <h2 class="text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            更多<GradientText>辅助办案能力</GradientText>
          </h2>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="f in EXTRA_FEATURES"
            :key="f.title"
            class="rounded-[14px] border bg-card p-[22px] shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:shadow-md"
          >
            <div
              class="mb-3.5 flex size-11 items-center justify-center rounded-[11px]"
              :style="{ background: f.tintBg, color: f.tintFg }"
            >
              <component :is="f.icon" class="size-[22px]" />
            </div>
            <h3 class="mb-1.5 text-[17px] font-semibold leading-[1.3]">{{ f.title }}</h3>
            <p class="text-[13.5px] leading-[1.65] text-muted-foreground">{{ f.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 技术优势 -->
    <section class="bg-background px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-12 text-center">
          <BrandEyebrow class="mb-3">TECHNOLOGY · 技术优势</BrandEyebrow>
          <h2 class="text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            基于最新 AI 技术的<GradientText>行业领先能力</GradientText>
          </h2>
        </div>
        <div class="grid grid-cols-1 gap-[18px] md:grid-cols-3">
          <div
            v-for="f in TECH"
            :key="f.title"
            class="rounded-2xl border bg-card p-7 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:shadow-md"
          >
            <div
              class="mb-4 flex size-12 items-center justify-center rounded-[12px]"
              :style="{ background: f.tintBg, color: f.tintFg }"
            >
              <component :is="f.icon" class="size-[22px]" />
            </div>
            <h3 class="mb-2 text-[19px] font-semibold leading-[1.3]">{{ f.title }}</h3>
            <p class="text-[14.5px] leading-[1.65] text-muted-foreground">{{ f.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 客户声音 -->
    <section class="bg-muted/30 px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-12 text-center">
          <BrandEyebrow class="mb-3">VOICES · 客户声音</BrandEyebrow>
          <h2 class="text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            来自<GradientText>一线办案者的反馈</GradientText>
          </h2>
        </div>
        <div class="grid grid-cols-1 gap-[18px] md:grid-cols-3">
          <div
            v-for="t in TESTIMONIALS"
            :key="t.name"
            class="flex flex-col gap-3.5 rounded-2xl border bg-card p-6 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition hover:-translate-y-1 hover:shadow-md"
          >
            <Quote class="size-7 text-primary opacity-40" />
            <p class="text-[15px] font-medium leading-[1.65]">{{ t.quote }}</p>
            <div class="mt-auto">
              <div class="text-[14px] font-semibold">{{ t.name }}</div>
              <div class="mt-1 text-[12.5px] text-muted-foreground">{{ t.role }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { FileText, Calendar, Gavel, ClipboardList, Shield, Layers, TrendingUp, History, Cpu, Database, Key, Quote, CircleCheck } from "lucide-vue-next"
import { useSiteSeo } from "~/composables/useSiteSeo"
import { breadcrumbLd, itemListLd } from "#shared/utils/seo/jsonLd"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import HeroGlow from "~/components/general/HeroGlow.vue"
import summaryImg from "@/assets/features/summary.jpg"
import timelineImg from "@/assets/features/timeline.jpg"
import causeImg from "@/assets/features/cause.jpg"
import rightsImg from "@/assets/features/rights.jpg"

definePageMeta({
  layout: "base-layout",
  title: "产品功能",
})

const MINT = { tintBg: "var(--tint-mint-bg)", tintFg: "var(--tint-mint-fg)" }
const SKY = { tintBg: "var(--tint-sky-bg)", tintFg: "var(--tint-sky-fg)" }
const NAVY = { tintBg: "var(--tint-navy-bg)", tintFg: "var(--tint-navy-fg)" }
const AMBER = { tintBg: "var(--tint-amber-bg)", tintFg: "var(--tint-amber-fg)" }

const MAIN_FEATURES = [
  { icon: FileText, img: summaryImg, title: "案情概要生成", body: "AI 自动分析案件材料，提取关键信息并生成简洁明了的案情概要，帮助您快速把握案件要点。", bullets: ["自动识别关键案情要素", "结构化呈现案件事实与争议", "突出案件中的关键证据"], ...SKY },
  { icon: Calendar, img: timelineImg, title: "案件大事记", body: "自动整理案件中的重要时间点与事件，按时间顺序呈现关键事件，便于您全面了解案件发展过程。", bullets: ["精准提取时间信息", "清晰的时间线显示", "关联事件与证据材料"], ...MINT },
  { icon: Gavel, img: causeImg, title: "案由确认", body: "智能识别案件类型与案由，提供法律依据和典型案件参考，帮助您准确定位案件性质。", bullets: ["准确识别案件类型和案由", "提供相关法条参考", "匹配类似案件判例"], ...NAVY },
  { icon: ClipboardList, img: rightsImg, title: "请求权生成与分析", body: "根据案情自动生成可能的请求权，并提供详细分析和法律依据，帮助您制定更有力的诉讼策略。", bullets: ["智能推荐适用请求权", "分析构成要件的事实支持", "提供法条和判例支持"], ...AMBER },
]

const EXTRA_FEATURES = [
  { icon: Shield, title: "对方抗辩预测", body: "预测对方可能的抗辩理由和策略，帮助您提前准备应对方案，针对性地加强自身案件准备。", ...SKY },
  { icon: Layers, title: "证据清单", body: "分析并整理案件所需证据清单建议，让您胸有成竹地走进法庭。", ...MINT },
  { icon: TrendingUp, title: "判决趋势预测", body: "法律合理性审查、预测判决趋势，助您及时调整诉讼策略。", ...NAVY },
  { icon: History, title: "分析历史记录", body: "保存所有分析结果，随时查阅和比较，持续跟踪案件进展，支持团队协作共享。", ...AMBER },
]

const TECH = [
  { icon: Cpu, title: "大语言模型", body: "采用最新的大语言模型技术，深度理解法律语言，准确把握案件细节和法律概念。", ...SKY },
  { icon: Database, title: "法律知识库", body: "内置丰富的法律知识库，涵盖法条、判例和专业文献，为分析提供权威支持。", ...MINT },
  { icon: Key, title: "安全可靠", body: "端到端加密技术，确保您的案件数据安全，符合法律职业保密要求。", ...NAVY },
]

const TESTIMONIALS = [
  { name: "某知名律师事务所", role: "张律师 · 合伙人", quote: "LexSeek 帮我们节省了大量整理和分析案件的时间，让律师可以更专注于策略制定和客户沟通。" },
  { name: "某企业法务部", role: "李总监 · 法务负责人", quote: "通过 LexSeek 的分析，我们能够更快速地评估法律风险，为公司决策提供更及时的法律支持。" },
  { name: "独立执业律师", role: "王律师 · 专职律师", quote: "作为独立律师，LexSeek 就像我的虚拟助手，帮助我处理更多案件，提供专业水准的分析支持。" },
]

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: "产品功能 - AI 案件分析、合同审查、法律文书生成",
  description: "LexSeek 法索 AI 全功能介绍：AI 案情概要、案件大事记、请求权分析、对方抗辩预测、证据清单、合同审查 AI、起诉状/答辩状一键生成，深度赋能律师办案全流程。",
  path: "/features",
  keywords: ["AI案件分析", "案情概要", "案件大事记", "请求权分析", "抗辩预测", "证据清单", "合同审查AI", "起诉状生成", "答辩状生成", "法律文书AI"],
  ogImage: "/og/features.png",
  jsonLd: [
    breadcrumbLd([
      { name: "首页", path: "/" },
      { name: "产品功能", path: "/features" },
    ], siteUrl),
    itemListLd([
      { name: "案情概要生成", description: "AI 自动分析案件材料，提取关键信息并生成简洁明了的案情概要" },
      { name: "案件大事记", description: "自动整理案件中的重要时间点和事件，按时间顺序呈现关键事件" },
      { name: "案由确认", description: "智能识别案件类型和案由，提供法律依据和典型案件参考" },
      { name: "请求权生成与分析", description: "根据案情自动生成可能的请求权，并提供详细分析和法律依据" },
      { name: "对方抗辩预测", description: "预测对方可能的抗辩理由和策略，帮助提前准备应对方案" },
      { name: "证据清单", description: "分析并整理案件所需证据清单建议" },
      { name: "法律合理性审查和判决趋势预测", description: "案件法律合理性审查、预测判决趋势" },
      { name: "分析历史记录", description: "保存所有分析结果，随时查阅和比较" },
    ]),
  ],
})
</script>
