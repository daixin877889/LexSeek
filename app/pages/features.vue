<template>
  <div>
    <!-- 页面标题 -->
    <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pt-[72px] pb-20">
      <HeroGlow />
      <div class="relative z-[1] mx-auto max-w-[900px] text-center">
        <BrandEyebrow class="mb-3.5">FEATURES</BrandEyebrow>
        <h1 class="mb-4 text-[36px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[48px]">
          全方位<span class="bg-gradient-brand bg-clip-text text-transparent">法律实务研判工作台</span>
        </h1>
        <p class="mx-auto max-w-[680px] text-[19px] leading-[1.6] text-muted-foreground">
          了解 法索 AI 如何将专家级办案思维与 AI 智能体融合，重塑诉讼业务效能。
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
          <div v-for="(f, i) in MAIN_FEATURES" :key="f.title"
            class="grid items-center gap-9 rounded-[18px] border bg-card p-7 transition hover:-translate-y-1 hover:shadow-md lg:grid-cols-2">
            <div :class="i % 2 === 1 ? 'lg:order-2' : ''">
              <div class="mb-3 flex items-center gap-3.5">
                <div class="flex size-12 shrink-0 items-center justify-center rounded-[12px]"
                  :style="{ background: f.tintBg, color: f.tintFg }">
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
            <div class="overflow-hidden rounded-[14px] bg-gradient-brand p-0.5"
              :class="i % 2 === 1 ? 'lg:order-1' : ''">
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
          <div v-for="f in EXTRA_FEATURES" :key="f.title"
            class="rounded-[14px] border bg-card p-[22px] transition hover:-translate-y-1 hover:shadow-md">
            <div class="mb-3.5 flex size-11 items-center justify-center rounded-[11px]"
              :style="{ background: f.tintBg, color: f.tintFg }">
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
          <div v-for="f in TECH" :key="f.title"
            class="rounded-2xl border bg-card p-7 transition hover:-translate-y-1 hover:shadow-md">
            <div class="mb-4 flex size-12 items-center justify-center rounded-[12px]"
              :style="{ background: f.tintBg, color: f.tintFg }">
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
          <div v-for="t in TESTIMONIALS" :key="t.name"
            class="flex flex-col gap-3.5 rounded-2xl border bg-card p-6 transition hover:-translate-y-1 hover:shadow-md">
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

    <!-- 行动号召：复用首页底部 LandingCta 品牌渐变样式 -->
    <LandingCta secondary-text="查看价格方案" secondary-to="/pricing">
      <template #title>体验 <span translate="no">LexSeek</span> 的强大功能</template>
      <template #description>立即注册并获得免费试用机会，亲身体验 AI 如何提升您的法律工作效率</template>
    </LandingCta>
  </div>
</template>

<script setup lang="ts">
import { FileText, Calendar, Gavel, ClipboardList, Shield, Layers, TrendingUp, History, Cpu, Database, Key, Quote, CircleCheck } from "lucide-vue-next"
import { useSiteSeo } from "~/composables/useSiteSeo"
import { breadcrumbLd, itemListLd } from "#shared/utils/seo/jsonLd"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import HeroGlow from "~/components/general/HeroGlow.vue"
import LandingCta from "~/components/landing/LandingCta.vue"
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
  { icon: FileText, img: summaryImg, title: "案情概要生成", body: "智能解构复杂案卷及多模态碎料，秒级输出高含金量事实概要，快速还原事件全貌并锁定核心争议。", bullets: ["多模态无损解析", "干扰信息精准过滤", "争议焦点秒级捕捉"], ...SKY },
  { icon: Calendar, img: timelineImg, title: "案件大事记", body: "自动整理案件中的重要时间点与事件，按时间顺序呈现关键事件，便于您全面了解案件发展过程。", bullets: ["精准提取时间信息", "清晰的时间线显示", "关联事件与证据材料"], ...MINT },
  { icon: Gavel, img: causeImg, title: "核心案由甄别", body: "智能解构案件事实与当事人真实诉求，精准匹配现行法定案由，系统性厘清诉讼请求权逻辑基础。", bullets: ["国家标准案由深度关联", "跨法典逻辑智能判定", "显著提升立案效率"], ...NAVY },
  { icon: ClipboardList, img: rightsImg, title: "请求权基础研判", body: "深度拆解支持诉请的核心构成要件，自动匹配对应实体法规范，跨法条交叉验证诉讼论据，规避实务盲区。", bullets: ["核心支持要件自动拆解", "实体法规范双路映射", "规避实务策略盲区漏诊"], ...AMBER },
]

const EXTRA_FEATURES = [
  { icon: Shield, title: "对方抗辩预测", body: "模拟复盘对方当事人可能的答辩思路与抗辩焦点，辅助代理人提前筹备反驳论据。", ...SKY },
  { icon: Layers, title: "证据清单构建", body: "依据诉请与争议要件，智能推荐符合法定证明标准的关键证据并梳理证明链条。", ...MINT },
  { icon: TrendingUp, title: "诉请法律合理性审查", body: "深度对齐法官裁判要素，无需依赖实体证据，纯粹从法律逻辑维度研判当事人陈述的合理性与支持概率。", ...NAVY },
  { icon: History, title: "研判成果一键导出", body: "秒级一键导出高质感诉讼分析报告，自动一键起草 90 余种最高院标准格式文书初稿。", ...AMBER },
]

const TECH = [
  { icon: Cpu, title: "大模型 Agent 架构", body: "摒弃单次问答式套壳，依托多智能体协同推演，实现系统级、长周期的法律深度办案。", ...SKY },
  { icon: Database, title: "双路召回与交叉验证", body: "自研“向量语义+关键词”双路智能检索，100% 映射核验国家权威现行法典，确保引证绝对真实、无幻觉。", ...MINT },
  { icon: Key, title: "多重隐私合规保障", body: "坚持“一案一空间”数据物理隔离，绝不用作任何模型训练。支持本地私有化部署，数据100%本地留存。", ...NAVY },
]

const TESTIMONIALS = [
  { name: "上海某合伙人律师", role: "张律师", quote: "法索 AI彻底重塑了我的案头工作流。复杂案卷材料一键导入，大事记与请求权一目了然，让我们把精力真正留给庭审战略。" },
  { name: "某知名律所高级合伙人律师", role: "李总监", quote: "以往复杂案件的脑力内耗极高。小索助手的对方抗辩预测和证据链梳理极具实战价值，帮我们在开庭前做足了抗辩多手预案。" },
  { name: "某律所高级合伙人", role: "王律师", quote: "一案一项目的‘双层记忆空间’非常惊艳，长达几个月的办案周期里系统从不失忆。开庭提纲直接基于历史研判报告一键生成。" },
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
