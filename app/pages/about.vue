<template>
  <div>
    <!-- 页面标题 -->
    <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pt-[72px] pb-20">
      <HeroGlow />
      <div class="relative z-[1] mx-auto max-w-[880px] text-center">
        <BrandEyebrow class="mb-3.5">ABOUT US</BrandEyebrow>
        <h1 class="mb-4 text-[36px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[48px]">
          用 AI 重新定义<span class="bg-gradient-brand bg-clip-text text-transparent">法律服务</span>
        </h1>
        <p class="mx-auto max-w-[680px] text-[19px] leading-[1.6] text-muted-foreground">
          了解 LexSeek 的使命和团队 — 我们致力于通过 AI 技术革新法律服务
        </p>
      </div>
    </section>

    <!-- 我们的使命 -->
    <section class="bg-background px-4 py-20">
      <div class="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-2">
        <div>
          <BrandEyebrow class="mb-3">MISSION · 我们的使命</BrandEyebrow>
          <h2 class="mb-[18px] text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            让法律工作<GradientText>更高效、更普惠</GradientText>
          </h2>
          <p class="mb-3.5 text-[15px] leading-[1.75] text-muted-foreground">
            LexSeek 致力于将人工智能技术与法律专业知识相结合，为法律从业者提供高效、准确的案件分析工具，帮助律师节省时间，提高工作效率，让法律服务更加普惠。
          </p>
          <p class="mb-3.5 text-[15px] leading-[1.75] text-muted-foreground">
            我们相信，通过技术创新，可以简化法律工作中的繁琐任务，让律师能够更专注于创造性思维和客户服务，从而提供更高质量的法律服务。
          </p>
          <p class="text-[15px] leading-[1.75] text-muted-foreground">
            同时，我们也致力于通过技术降低法律服务的门槛，让更多人能够获得专业、高效的法律帮助。
          </p>
        </div>
        <div class="relative overflow-hidden rounded-[18px] bg-gradient-brand p-9 text-white shadow-[0_20px_50px_-20px_rgba(9,3,128,0.45)]">
          <div aria-hidden="true" class="absolute -right-10 -top-10 size-[200px] rounded-full bg-white/[0.08]" />
          <div aria-hidden="true" class="absolute -bottom-12 -left-8 size-[180px] rounded-full bg-white/[0.06]" />
          <Quote class="relative mb-4 size-10 opacity-85" />
          <blockquote class="relative mb-6 text-[21px] font-semibold leading-[1.45] tracking-[-0.01em]">
            我们的愿景是打造一个智能法律助手，它不仅能够理解法律语言，还能够像经验丰富的律师一样思考和分析案件。
          </blockquote>
          <div class="relative flex items-center gap-3">
            <div class="flex size-11 items-center justify-center rounded-full bg-white/[0.18] text-[14px] font-bold backdrop-blur-sm">
              程
            </div>
            <div>
              <div class="text-[15px] font-semibold">程子洋</div>
              <div class="mt-[3px] text-[12.5px] opacity-85">LexSeek 创始人 &amp; CEO</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 我们的价值观 -->
    <section class="bg-muted/30 px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-12 text-center">
          <BrandEyebrow class="mb-3">VALUES · 价值观</BrandEyebrow>
          <h2 class="mb-3.5 text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            指引我们每一个<GradientText>决策的核心信念</GradientText>
          </h2>
          <p class="mx-auto max-w-[600px] text-[16px] leading-[1.6] text-muted-foreground">
            这些核心价值观指引着我们产品开发和团队文化的每一个决策
          </p>
        </div>
        <div class="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="v in VALUES"
            :key="v.title"
            class="rounded-2xl border bg-card p-[26px] transition hover:-translate-y-1 hover:shadow-md"
          >
            <div
              class="mb-4 flex size-12 items-center justify-center rounded-[12px]"
              :style="{ background: v.tintBg, color: v.tintFg }"
            >
              <component :is="v.icon" class="size-[22px]" />
            </div>
            <h3 class="mb-2 text-[18px] font-semibold leading-[1.3]">{{ v.title }}</h3>
            <p class="text-[14px] leading-[1.65] text-muted-foreground">{{ v.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 联系我们 -->
    <section id="contact" class="bg-background px-4 py-20">
      <div class="mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-2">
        <div>
          <BrandEyebrow class="mb-3">CONTACT · 联系我们</BrandEyebrow>
          <h2 class="mb-3.5 text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            我们<GradientText>随时在线</GradientText>
          </h2>
          <p class="mb-6 text-[15.5px] leading-[1.7] text-muted-foreground">
            无论您是有产品疑问、合作意向，还是想加入我们的团队，都欢迎通过以下方式与我们联系。
          </p>
          <div class="flex flex-col gap-3.5">
            <div v-for="c in CONTACTS" :key="c.title" class="flex items-center gap-3.5">
              <div class="flex size-[42px] items-center justify-center rounded-[11px] bg-[image:var(--tint-sky-bg)] text-[color:var(--tint-sky-fg)]">
                <component :is="c.icon" class="size-[18px]" />
              </div>
              <div>
                <div class="text-[14px] font-semibold">{{ c.title }}</div>
                <div class="mt-[3px] text-[13.5px] text-muted-foreground">{{ c.detail }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="rounded-[18px] border bg-card p-9 text-center">
          <BrandEyebrow class="mb-3.5">WECHAT</BrandEyebrow>
          <h3 class="mb-[18px] text-[20px] font-bold leading-[1.3]">扫码添加客服微信</h3>
          <div class="mx-auto mb-4 w-fit rounded-[14px] bg-gradient-brand p-1">
            <img
              src="/images/mpwxcode.jpg"
              alt="客服微信二维码"
              class="block size-[200px] rounded-[11px] bg-card object-contain"
            >
          </div>
          <p class="text-[13px] leading-[1.5] text-muted-foreground">7×12 小时在线，节假日除外</p>
        </div>
      </div>
    </section>

    <!-- 加入我们 -->
    <section class="relative overflow-hidden bg-gradient-brand px-4 py-20 text-white">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute -top-[100px] left-[20%] h-[400px] w-[400px] rounded-full"
        style="background: #1EEDC4; opacity: 0.25; filter: blur(80px);"
      />
      <div
        aria-hidden="true"
        class="pointer-events-none absolute -bottom-[100px] right-[15%] h-[350px] w-[350px] rounded-full"
        style="background: #090380; opacity: 0.4; filter: blur(80px);"
      />
      <div class="relative z-[1] mx-auto max-w-[880px] text-center">
        <h2 class="mb-3.5 text-[28px] font-bold leading-[1.2] tracking-[-0.025em] md:text-[36px]">加入 LexSeek 团队</h2>
        <p class="mx-auto mb-8 max-w-[640px] text-[18px] leading-[1.6] opacity-90">
          我们正在寻找对法律科技充满热情的人才加入团队，一起打造未来的法律 AI 工具
        </p>
        <div class="flex flex-wrap justify-center gap-3.5">
          <a
            href="mailto:lexseek@lvhong-lawer.com"
            class="rounded-md bg-white px-7 py-3.5 text-[15px] font-semibold text-[#0A4DA8] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3)] transition hover:brightness-95 active:scale-[0.98]"
          >查看职位机会</a>
          <a
            href="#contact"
            class="rounded-md border border-white/30 bg-white/[0.12] px-7 py-3.5 text-[15px] font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
          >联系我们</a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Quote, Zap, Shield, Lock, Users, Sparkles, Heart, Mail, Phone } from "lucide-vue-next"
import { useSiteSeo } from "~/composables/useSiteSeo"
import { breadcrumbLd } from "#shared/utils/seo/jsonLd"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import HeroGlow from "~/components/general/HeroGlow.vue"

definePageMeta({
  layout: "base-layout",
  title: "关于我们",
})

const MINT = { tintBg: "var(--tint-mint-bg)", tintFg: "var(--tint-mint-fg)" }
const SKY = { tintBg: "var(--tint-sky-bg)", tintFg: "var(--tint-sky-fg)" }
const NAVY = { tintBg: "var(--tint-navy-bg)", tintFg: "var(--tint-navy-fg)" }
const AMBER = { tintBg: "var(--tint-amber-bg)", tintFg: "var(--tint-amber-fg)" }

const VALUES = [
  { icon: Zap, title: "科技创新", body: "我们不断探索最新的 AI 技术，将其应用于法律领域，创造前所未有的分析能力和用户体验。", ...SKY },
  { icon: Shield, title: "专业可靠", body: "我们的产品建立在深厚的法律专业知识基础上，确保分析结果专业、准确、可靠。", ...MINT },
  { icon: Lock, title: "安全保密", body: "我们将用户数据安全和隐私保护视为最高优先级，采用严格的安全措施保护用户信息。", ...NAVY },
  { icon: Users, title: "协作共赢", body: "我们相信技术与人的协作，致力于打造辅助工具而非替代品，帮助法律从业者取得更好的成果。", ...AMBER },
  { icon: Sparkles, title: "卓越体验", body: "我们注重产品细节和用户体验，力求每一次交互都简单、高效、愉悦。", ...SKY },
  { icon: Heart, title: "普惠法律", body: "我们希望通过技术降低法律服务门槛，让更多人能够获得专业的法律帮助。", ...MINT },
]

const CONTACTS = [
  { icon: Mail, title: "电子邮件", detail: "lexseek@lvhong-lawer.com" },
  { icon: Phone, title: "客服电话", detail: "181 1603 2042" },
]

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: "关于 LexSeek 法索 AI - 用 AI 重塑法律服务",
  description: "LexSeek 法索 AI 由上海盛熙律泓教育科技有限公司打造，致力于将多模态 AI 与法律专业知识深度融合，为律师与法务提供高效、精准的智能办案工具。",
  path: "/about",
  keywords: ["LexSeek", "法索AI", "法律科技公司", "法律AI团队", "上海盛熙律泓"],
  ogImage: "/og/about.png",
  jsonLd: breadcrumbLd([
    { name: "首页", path: "/" },
    { name: "关于我们", path: "/about" },
  ], siteUrl),
})
</script>
