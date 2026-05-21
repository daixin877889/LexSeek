<template>
  <div>
    <!-- 页面标题 -->
    <section class="relative overflow-hidden bg-[image:var(--wash-page)] px-4 pt-[72px] pb-20">
      <HeroGlow />
      <div class="relative z-[1] mx-auto max-w-[900px] text-center">
        <BrandEyebrow class="mb-3.5">PRICING</BrandEyebrow>
        <h1 class="mb-4 text-[36px] font-bold leading-[1.15] tracking-[-0.025em] md:text-[48px]">
          灵活的<span class="bg-gradient-brand bg-clip-text text-transparent">定价方案</span>
        </h1>
        <p class="mx-auto max-w-[680px] text-[19px] leading-[1.6] text-muted-foreground">
          按需选择，满足不同规模团队的需求 · 新用户注册即享 7 天全功能免费试用
        </p>
      </div>
    </section>

    <!-- 套餐卡片 -->
    <section class="bg-background px-4 pt-10 pb-20">
      <div class="mx-auto max-w-[1240px]">
        <div :class="planGridClass">
          <div v-for="plan in visiblePlans" :key="plan.productId"
            class="relative flex flex-col overflow-hidden rounded-[18px] bg-card p-7 transition hover:-translate-y-1"
            :class="CARD_CLASS[plan.variant]">
            <div v-if="plan.badge"
              class="absolute right-0 top-0 rounded-bl-[10px] px-3 py-[5px] text-[11px] font-semibold tracking-[0.04em] text-white"
              :class="BADGE_CLASS[plan.variant]">{{ plan.badge }}</div>

            <h3 class="mb-3.5 text-[22px] font-bold leading-[1.2]">{{ plan.name }}</h3>
            <div class="mb-2 flex items-baseline gap-1.5">
              <span class="text-[36px] font-extrabold leading-none tracking-[-0.02em]">{{ plan.price }}</span>
              <span class="text-[14px] text-muted-foreground">{{ plan.cycle }}</span>
            </div>
            <div v-if="plan.strike" class="mb-2 text-[12.5px] text-muted-foreground">
              原价 <span class="line-through">{{ plan.strike }}</span>
            </div>
            <div
              class="mb-3.5 inline-flex w-fit rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] font-semibold text-primary">
              {{ plan.bonus }}
            </div>
            <p class="mb-[18px] text-[13.5px] leading-[1.5] text-muted-foreground">{{ plan.flavor }}</p>

            <ul class="mb-[22px] flex flex-1 flex-col gap-[9px]">
              <li v-for="p in plan.perks" :key="p.label" class="flex items-start gap-2 text-[13.5px] leading-[1.5]">
                <Check class="mt-[3px] size-4 shrink-0 text-green-500" />
                <span>{{ p.label }}<span v-if="p.soon" class="text-muted-foreground"> (即将上线)</span></span>
              </li>
              <li v-for="c in plan.crossed" :key="c"
                class="flex items-start gap-2 text-[13.5px] leading-[1.5] text-muted-foreground">
                <X class="mt-[3px] size-4 shrink-0 opacity-50" />
                <span>{{ c }}</span>
              </li>
            </ul>

            <button type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-3 text-[14px] font-semibold transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              :class="BTN_CLASS[plan.variant]" :disabled="pendingProductId !== null" @click="buy(plan)">
              <Loader2 v-if="pendingProductId === plan.productId" class="h-4 w-4 animate-spin" />
              {{ plan.cta }}
            </button>
            <p class="mt-3.5 text-center text-[11.5px] font-medium" :class="FOOTNOTE_CLASS[plan.variant]">
              {{ plan.footnote }}
            </p>
          </div>
        </div>
        <p class="mt-7 text-center text-[14px] font-medium text-muted-foreground">
          注册享 1 天全功能免费试用，<NuxtLink to="/register" class="font-bold text-primary hover:underline">立即注册</NuxtLink>体验
        </p>
      </div>
    </section>

    <!-- 功能对比 -->
    <section class="bg-muted/30 px-4 py-20">
      <div class="mx-auto max-w-[1200px]">
        <div class="mb-10 text-center">
          <BrandEyebrow class="mb-3">COMPARE · 功能说明</BrandEyebrow>
          <h2 class="text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            不同套餐的<GradientText>能力对比</GradientText>
          </h2>
        </div>
        <div class="overflow-hidden rounded-2xl border bg-card">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[800px] border-collapse">
              <thead>
                <tr class="bg-primary/[0.06]">
                  <th class="w-28 px-4 py-3.5 text-left text-[13px] font-semibold">分类</th>
                  <th class="w-60 px-4 py-3.5 text-left text-[13px] font-semibold">功能名称</th>
                  <th v-for="col in visibleComparisonColumns" :key="col.name"
                    class="px-4 py-3.5 text-center text-[13px] font-semibold">{{ col.name }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="group in COMPARISON" :key="group.group">
                  <tr v-for="(row, ri) in group.rows" :key="row.label" class="border-t">
                    <td v-if="ri === 0" :rowspan="group.rows.length"
                      class="px-4 py-3 align-middle text-[13px] font-semibold">
                      {{ group.group }}
                    </td>
                    <td class="px-4 py-3 text-[13.5px]">{{ row.label }}</td>
                    <td v-for="col in visibleComparisonColumns" :key="col.name" class="px-4 py-3 text-center">
                      <Check v-if="row.cells[col.cellIndex] === true" class="mx-auto size-4 text-green-600" />
                      <X v-else-if="row.cells[col.cellIndex] === false"
                        class="mx-auto size-4 text-red-500 opacity-55" />
                      <span v-else class="text-[13px] font-medium">{{ row.cells[col.cellIndex] }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
        <div class="mt-6 flex items-start gap-3.5 rounded-xl border border-primary/20 bg-primary/[0.06] p-5">
          <ShieldX class="size-9 shrink-0 text-primary" />
          <div>
            <h3 class="mb-1.5 text-[15px] font-bold leading-[1.3]">防滥用说明</h3>
            <p class="text-[13px] leading-[1.6] text-muted-foreground">
              LexSeek 仅提供给会员本人使用，禁止任何形式的转卖、出租、出借、赠与等行为。案件分析功能限制同一时间分析的案件数 (并发数) 为 1 个。
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 常见问题 -->
    <section class="bg-background px-4 py-20">
      <div class="mx-auto max-w-[880px]">
        <div class="mb-10 text-center">
          <BrandEyebrow class="mb-3">FAQ · 常见问题</BrandEyebrow>
          <h2 class="text-[26px] font-bold leading-[1.2] tracking-[-0.02em] md:text-[32px]">
            还有疑问？这里也许<GradientText>有答案</GradientText>
          </h2>
        </div>
        <div class="flex flex-col gap-3.5">
          <div v-for="it in FAQ" :key="it.q"
            class="rounded-xl border bg-card px-[22px] py-5 transition hover:-translate-y-1 hover:shadow-md">
            <h3 class="mb-1.5 text-[16px] font-semibold leading-[1.3]">{{ it.q }}</h3>
            <p class="text-[14px] leading-[1.65] text-muted-foreground">{{ it.a }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 行动号召：复用首页底部品牌渐变样式；副按钮唤起客服弹窗 -->
    <LandingCta primary-text="免费注册" primary-to="/register" secondary-text="联系客服"
      :secondary-handler="() => wxSupportStore.showQrCode()">
      <template #title>开始免费试用</template>
      <template #description>立即注册并获得 1 天全功能免费试用</template>
    </LandingCta>

    <!-- 购买流程组件（包含认证弹框和支付二维码弹框） -->
    <PurchaseFlow v-model:show-auth-modal="purchaseFlow.showAuthModal.value"
      :auth-modal-tab="purchaseFlow.authModalTab.value"
      v-model:show-q-r-code-dialog="purchaseFlow.showQRCodeDialog.value" :qr-code-url="purchaseFlow.qrCodeUrl.value"
      :payment-loading="purchaseFlow.paymentLoading.value" :payment-paid="purchaseFlow.paymentPaid.value"
      @auth-success="purchaseFlow.handleAuthSuccess" @auth-cancel="purchaseFlow.handleAuthCancel"
      @close-q-r-code="purchaseFlow.closeQRCodeDialog" />
  </div>
</template>

<script setup lang="ts">
import { Check, X, ShieldX, Loader2 } from "lucide-vue-next"
import BrandEyebrow from "~/components/general/BrandEyebrow.vue"
import GradientText from "~/components/general/GradientText.vue"
import HeroGlow from "~/components/general/HeroGlow.vue"
import LandingCta from "~/components/landing/LandingCta.vue"
import PurchaseFlow from "~/components/purchase/PurchaseFlow.vue"
import { usePurchaseFlow } from "~/composables/usePurchaseFlow"
import { useSiteSeo } from "~/composables/useSiteSeo"
import { useWxSupportStore } from "~/store/wxSupport"
import { DurationUnit } from "#shared/types/payment"
import { breadcrumbLd, faqLd } from "#shared/utils/seo/jsonLd"

definePageMeta({
  layout: "base-layout",
  title: "价格方案",
})

const wxSupportStore = useWxSupportStore()

type Variant = "amber" | "sky" | "plain"

interface Plan {
  productId: number
  // hidden: true 表示该方案在售卖页隐藏，但数据仍保留，方便后续按需开放
  hidden?: boolean
  // 购买周期：1=按月，2=按年。决定下单时 durationUnit 字段，必须与 admin 后台该商品的配置一致
  defaultDuration: 1 | 2
  variant: Variant
  badge: string | null
  name: string
  price: string
  cycle: string
  strike: string | null
  bonus: string
  flavor: string
  cta: string
  footnote: string
  perks: { label: string; soon?: boolean }[]
  crossed: string[]
}

const CARD_CLASS: Record<Variant, string> = {
  amber: "border-2 border-[#E07A0A] shadow-[0_18px_36px_-18px_rgba(224,122,10,0.2)]",
  sky: "border-2 border-[#1E9EED] shadow-[0_18px_36px_-18px_rgba(30,158,237,0.25)]",
  plain: "border hover:shadow-md",
}
const BADGE_CLASS: Record<Variant, string> = {
  amber: "bg-linear-to-br from-[#FFB75E] to-[#E07A0A]",
  sky: "bg-linear-to-br from-[#1E9EED] to-[#090380]",
  plain: "",
}
const BTN_CLASS: Record<Variant, string> = {
  amber: "bg-linear-to-br from-[#FFB75E] to-[#E07A0A] text-white shadow-[0_12px_24px_-10px_rgba(224,122,10,0.35)]",
  sky: "bg-linear-to-br from-[#1E9EED] to-[#090380] text-white shadow-[0_12px_24px_-10px_rgba(9,3,128,0.4)]",
  plain: "border border-primary/40 text-primary",
}
const FOOTNOTE_CLASS: Record<Variant, string> = {
  amber: "text-[#E07A0A]",
  sky: "text-primary",
  plain: "text-muted-foreground",
}

const PLANS: Plan[] = [
  {
    productId: 10, defaultDuration: 1, variant: "amber", badge: "新手专享",
    name: "新手旗舰套餐", price: "¥9.9", cycle: "/月", strike: null,
    bonus: "赠送 300 积分", flavor: "旗舰版会员，限购 1 次", cta: "立即抢购", footnote: "每人限购一次",
    perks: [
      { label: "5GB 云盘存储空间" },
      { label: "无功能限制" },
      { label: "录音智能转写" },
      { label: "全部案件可视化工具" },
      { label: "文书生成" },
      { label: "合同审查" },
      { label: "后续更新的所有功能" },
      { label: "专属客服服务" },
    ],
    crossed: [],
  },
  {
    productId: 1, hidden: true, defaultDuration: 2, variant: "plain", badge: null,
    name: "基础版", price: "¥365", cycle: "/年", strike: "¥780",
    bonus: "赠送 3,650 积分", flavor: "适合做简单的案件分析", cta: "订阅基础版会员", footnote: "功能存在部份限制",
    perks: [
      { label: "100MB 云盘存储空间" },
      { label: "案情概要整理" },
      { label: "案件大事记整理" },
    ],
    crossed: ["案由确认功能", "请求权分析功能", "对方抗辩预测功能", "证据清单建议", "案件可视化工具"],
  },
  {
    productId: 2, hidden: true, defaultDuration: 2, variant: "sky", badge: "推荐方案",
    name: "专业版", price: "¥680", cycle: "/年", strike: "¥1,280",
    bonus: "赠送 6,800 积分", flavor: "适合做专业的案件分析", cta: "订阅专业版会员", footnote: "最受欢迎的选择",
    perks: [
      { label: "1GB 云盘存储空间" },
      { label: "基础版所有功能" },
      { label: "请求权分析功能" },
      { label: "案由确认功能" },
      { label: "对方抗辩预测功能" },
      { label: "证据清单建议" },
      { label: "部份案件可视化工具", soon: true },
      { label: "试用新功能的机会" },
    ],
    crossed: [],
  },
  {
    productId: 11, defaultDuration: 1, variant: "plain", badge: null,
    name: "旗舰版(包月)", price: "¥199", cycle: "/月", strike: "¥ 299",
    bonus: "赠送 1990 积分", flavor: "适合短期案件深度分析及案例研究", cta: "订阅旗舰版会员", footnote: "功能无限制",
    perks: [
      { label: "5GB 云盘存储空间" },
      { label: "无功能限制" },
      { label: "录音智能转写" },
      { label: "全部案件可视化工具" },
      { label: "文书生成" },
      { label: "合同审查" },
      { label: "后续更新的所有功能" },
      { label: "专属客服服务" },
    ],
    crossed: [],
  },

  {
    productId: 3, defaultDuration: 2, variant: "sky", badge: "年度订阅更划算",
    name: "旗舰版(包年)", price: "¥1,280", cycle: "/年", strike: "¥2,480",
    bonus: "赠送 12,800 积分", flavor: "适合短期案件深度分析及案例研究", cta: "订阅旗舰版会员", footnote: "功能无限制",
    perks: [
      { label: "5GB 云盘存储空间" },
      { label: "无功能限制" },
      { label: "录音智能转写" },
      { label: "全部案件可视化工具" },
      { label: "文书生成" },
      { label: "合同审查" },
      { label: "后续更新的所有功能" },
      { label: "专属客服服务" },
    ],
    crossed: [],
  },
]

// 只渲染未隐藏的方案；卡片栅格根据数量动态扩列，让卡片始终占满容器宽度。
const visiblePlans = computed(() => PLANS.filter(p => !p.hidden))
const planGridClass = computed(() => {
  switch (visiblePlans.value.length) {
    case 1: return 'mx-auto grid max-w-[420px] grid-cols-1'
    case 2: return 'mx-auto grid max-w-[820px] grid-cols-1 gap-[18px] sm:grid-cols-2'
    case 3: return 'grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3'
    default: return 'grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-4'
  }
})

// 功能对比表的列定义：免费版固定显示（不在 PLANS 里），其它列与 PLANS 通过 productId 关联，
// 当 PLANS 中对应方案设为 hidden 时，对比表的列与单元格一起隐藏。
// cellIndex 用于在 COMPARISON.rows[].cells 数组中取对应位置的值。
const COMPARISON_COLUMNS = [
  { name: "免费版", productId: null as number | null, cellIndex: 0 },
  { name: "基础版", productId: 1 as number | null, cellIndex: 1 },
  { name: "专业版", productId: 2 as number | null, cellIndex: 2 },
  { name: "旗舰版", productId: 3 as number | null, cellIndex: 3 },
]

const visibleComparisonColumns = computed(() => {
  const hiddenIds = new Set(PLANS.filter(p => p.hidden).map(p => p.productId))
  return COMPARISON_COLUMNS.filter(col => col.productId == null || !hiddenIds.has(col.productId))
})

const COMPARISON = [
  {
    group: "文件存储",
    rows: [
      { label: "云盘空间", cells: ["100MB", "100MB", "1GB", "5GB"] },
    ],
  },
  {
    group: "案件分析",
    rows: [
      { label: "提取案件标题", cells: [true, true, true, true] },
      { label: "生成案情概要", cells: [true, true, true, true] },
      { label: "提取案件大事记", cells: [false, false, true, true] },
      { label: "预分析案件请求权", cells: [false, false, true, true] },
      { label: "法律合理性审查和判决趋势预测", cells: [false, false, true, true] },
      { label: "预选案由", cells: [false, false, true, true] },
      { label: "抗辩分析及策略预测", cells: [false, false, true, true] },
      { label: "证据清单预处理", cells: [false, false, true, true] },
    ],
  },
  {
    group: "办案工具",
    rows: [
      { label: "录音智能转写", cells: [false, false, true, true] },
      { label: "利息计算工具", cells: [true, true, true, true] },
      { label: "诉讼费用计算工具", cells: [true, true, true, true] },
      { label: "律师费用计算工具", cells: [true, true, true, true] },
      { label: "延迟履行利息计算工具", cells: [true, true, true, true] },
      { label: "银行利率查询工具", cells: [true, true, true, true] },
      { label: "日期推算工具", cells: [true, true, true, true] },
      { label: "赔偿计算器", cells: [true, true, true, true] },
      { label: "加班计算工具", cells: [true, true, true, true] },
      { label: "离婚财产分割工具", cells: [true, true, true, true] },
      { label: "社保追偿工具", cells: [true, true, true, true] },
      { label: "法律文书生成", cells: [false, false, "部分", true] },
      { label: "案件可视化工具", cells: [false, false, "部分", true] },
    ],
  },
]

const FAQ = [
  { q: "有免费试用吗？", a: "是的，新用户注册后可获得 7 天免费试用，可体验旗舰版的全部功能。" },
  { q: "可以随时更换订阅方案吗？", a: "您可以随时升级您的订阅方案，但降级需要等待当前会员有效期结束后进行续订。" },
]

const purchaseFlow = usePurchaseFlow({
  onSuccess: () => {
    navigateTo("/dashboard/membership/level")
  },
})

/**
 * 正在发起支付请求的商品 ID，用于按钮 loading + 禁用，避免网络延迟期间用户重复点击下单。
 * 已登录走 createPayment 直到 fetch 完成；未登录走认证弹框（return 即释放，弹框已挡住点击）。
 */
const pendingProductId = ref<number | null>(null)

// 按 plan.defaultDuration 决定 durationUnit：1=月，其它=年。和 level 页一致，避免下单时落到旧硬编码逻辑里。
const buy = async (plan: Plan) => {
  if (pendingProductId.value !== null) return
  pendingProductId.value = plan.productId
  try {
    const durationUnit = plan.defaultDuration === 1 ? DurationUnit.MONTH : DurationUnit.YEAR
    await purchaseFlow.buy(plan.productId, durationUnit)
  } finally {
    pendingProductId.value = null
  }
}

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: "价格方案 - 律师 AI 会员订阅",
  description: "LexSeek 法索 AI 提供新手旗舰¥9.9/月、基础版¥365/年、专业版¥680/年、旗舰版¥1280/年四档会员，覆盖案件分析、合同审查、办案工具全功能；注册即享 7 天免费试用。",
  path: "/pricing",
  keywords: ["LexSeek会员", "法律AI订阅", "律师AI价格", "案件分析订阅", "法律科技会员"],
  ogImage: "/og/pricing.png",
  jsonLd: [
    breadcrumbLd([
      { name: "首页", path: "/" },
      { name: "价格方案", path: "/pricing" },
    ], siteUrl),
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "LexSeek 法索 AI 会员订阅",
      description: "律师 AI 工作台会员订阅，提供案件分析、合同审查、办案工具全功能",
      brand: { "@type": "Brand", name: "LexSeek 法索 AI" },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "CNY",
        lowPrice: "9.9",
        highPrice: "1280",
        offerCount: 4,
      },
    },
    faqLd([
      { q: "有免费试用吗？", a: "是的，新用户注册后可获得 7 天免费试用，可体验旗舰版的全部功能。" },
      { q: "可以随时更换订阅方案吗？", a: "您可以随时升级您的订阅方案，但降级需要等待当前会员有效期结束后进行续订。" },
    ]),
  ],
})
</script>
