<template>
  <div class="theme-brand">
    <!-- 头部 -->
    <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pb-14 pt-16 text-center">
      <HeroGlow />
      <div class="relative z-[1] mx-auto max-w-[880px]">
        <BrandEyebrow class="mb-3.5">LEGAL</BrandEyebrow>
        <h1 class="mb-3.5 text-[28px] font-bold leading-[1.2] tracking-[-0.025em] md:text-[40px]">
          <span translate="no">LexSeek｜法索 AI </span>
          <GradientText>{{ title }}</GradientText>
        </h1>
        <div class="text-[14px] text-muted-foreground">
          <span>生效日期：{{ effective }}</span>
          <span class="mx-3 opacity-50">·</span>
          <span>最后更新：{{ updated }}</span>
        </div>
      </div>
    </section>

    <!-- 正文 -->
    <section class="bg-background px-4 pb-20 pt-10">
      <div class="mx-auto grid max-w-[1200px] items-start gap-10 lg:grid-cols-[240px_1fr]">
        <!-- 粘性目录 -->
        <aside class="hidden lg:sticky lg:top-20 lg:block">
          <div class="rounded-xl border bg-card p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
            <p class="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">目录</p>
            <ul class="flex flex-col gap-0.5">
              <li v-for="(t, i) in toc" :key="t.id">
                <a
                  :href="`#${t.id}`"
                  class="flex items-start gap-2 rounded-md px-2.5 py-[7px] text-[13px] leading-[1.4] transition-colors"
                  :class="activeId === t.id ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-foreground hover:bg-primary/5'"
                >
                  <span class="min-w-[18px] shrink-0 pt-px font-mono text-[11px] text-muted-foreground">
                    {{ String(i + 1).padStart(2, "0") }}
                  </span>
                  <span>{{ t.title }}</span>
                </a>
              </li>
            </ul>
          </div>
        </aside>

        <!-- 主列 -->
        <div class="min-w-0">
          <div class="mb-8 rounded-[14px] border border-primary/15 bg-primary/[0.04] px-6 py-5">
            <slot name="intro" />
          </div>
          <div class="flex flex-col gap-9">
            <slot />
          </div>
        </div>
      </div>
    </section>

    <!-- 返回顶部 -->
    <button
      v-show="showTop"
      type="button"
      aria-label="返回顶部"
      class="fixed bottom-8 right-8 z-40 flex size-11 items-center justify-center rounded-full bg-linear-to-br from-[#1E9EED] to-[#090380] text-white shadow-[0_12px_28px_-8px_rgba(9,3,128,0.5)] transition hover:brightness-110"
      @click="scrollTop"
    >
      <ArrowUp class="size-[18px]" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp } from "lucide-vue-next"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import HeroGlow from "~/components/general/HeroGlow.vue"

const props = defineProps<{
  title: string
  effective: string
  updated: string
  toc: { id: string; title: string }[]
}>()

const showTop = ref(false)
const activeId = ref(props.toc[0]?.id)

const onScroll = () => {
  showTop.value = window.scrollY > 480
  let current = props.toc[0]?.id
  for (const t of props.toc) {
    const el = document.getElementById(t.id)
    if (el && el.getBoundingClientRect().top < 160) current = t.id
  }
  activeId.value = current
}

const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" })

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener("scroll", onScroll)
})
</script>
