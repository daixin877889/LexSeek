# SEO 优化 — 全站基建 + 核心公开页深度优化设计

- 日期：2026-05-14
- 范围：全站 SEO 基建（meta / robots / sitemap / 站长验证 / 结构化数据 / canonical / OG）+ 4 个核心公开页（`/`、`/features`、`/pricing`、`/about`）文案与 JSON-LD 精修 + 私密页 noindex 兜底
- 不影响：业务逻辑、组件库、数据库、Prisma schema、API 行为
- 不新增依赖：sitemap 手写 nitro 路由，不引入 `@nuxtjs/sitemap` 等模块

## 目标

把当前几乎"裸奔"的 SEO（仅 `definePageMeta.title`，无 description / canonical / OG / sitemap / JSON-LD / 站长验证）升级到生产级别，覆盖以下能力：

1. 每个公开页拥有独立 `title` / `description` / `canonical` / `OG` / `Twitter Card` / 关键词
2. 全站统一 `Organization` + `WebSite` JSON-LD，核心页追加 `WebApplication` / `BreadcrumbList` / `FAQPage` / `Product/AggregateOffer` / `ItemList` 等结构化数据
3. `robots.txt` 精细化 Allow/Disallow + Sitemap 指向
4. 动态生成的 `sitemap.xml`，仅暴露公开 7 页
5. 多平台站长验证（百度 / Google / 360 / 搜狗 / Bing）通过环境变量灌入，不硬编码
6. 私密页（`/dashboard/**`、`/admin/**`、`/login`、`/register`、`/reset-password`、`/landing/:invitedBy`、`/403`）一次性 noindex
7. PWA manifest 配齐，提升移动端 SEO 评分

## 参考项目对照

`/Users/daixin/work/dev/LexSeek/lexseek_web`（旧版 Vue SPA）仅做了：
- `<title>LexSeek ｜ 法索 AI</title>`
- `baidu-site-verification` meta
- 路由 `meta.title` 动态写 `document.title`

本次设计参考了其品牌定位（`LexSeek 法索 AI`、`告别低效梳理，专注精准判断`、`专为法律人打造的多模态AI精细化案件分析工具`），但**SEO 实现是从零搭建**——SPA 的 SEO 价值远低于 Nuxt 4 SSR，本次充分利用 SSR 的能力。

## 已确认的核心决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 覆盖范围 | 完整方案（基建 + 4 个核心公开页深度优化 + 私密页 noindex） | 用户头脑风暴确认 |
| 生产主域名 | `https://lexseek.cn` | 用户头脑风暴确认（沿用参考项目域名） |
| 站长验证 | 百度 + Google + 360 + 搜狗 + Bing 全接入 | 国内 SEO 必备 + 海外可达 |
| 关键词主战场 | 律师专业向 + 法律科技 AI 向 + 具体工具长尾 + 合同审查/文书 AI（全选） | 用户头脑风暴确认 |
| Sitemap 实现 | 手写 `server/routes/sitemap.xml.ts`，零依赖 | 公开页仅 7 条，无需 `@nuxtjs/sitemap` 模块；项目"控制依赖"风格 |
| JSON-LD 注入 | Nuxt 原生 `useHead({ script: [...] })` | 无需 nuxt-jsonld 包，零依赖 |
| Manifest | 手写 `public/site.webmanifest` | 已有 pwa-192/512 图标；不引入 `@vite-pwa/nuxt` |
| 私密页 noindex | Layout 级一次性注入（dashboard / admin / membership / settings） + login/register/reset-password/landing/403 页面级单独标 | 一处控制覆盖所有子页；公开但禁用页单独标更直观 |
| OG 图 | 先用 `/og/default.png` 占位（临时复用 logo），各页可覆盖；标注"待设计补图"，不阻塞上线 | 不卡上线；设计可补 |
| 抽象层 | 单一 composable `useSiteSeo({ ... })` 统一所有页面 SEO 调用 | 单一入口，避免散落的 `useHead` / `useSeoMeta` |
| 站长验证 ID | 走 `runtimeConfig.public.seo.*Verify`，环境变量驱动 | 避免硬编码；开发环境留空 |

## 架构与数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 全局层 (nuxt.config.ts + app.vue)                                │
│  · htmlAttrs.lang = 'zh-CN'                                      │
│  · titleTemplate = '%s | LexSeek 法索 AI'                        │
│  · 默认 description / OG / Twitter / theme-color / manifest      │
│  · runtimeConfig.public.seo = { siteUrl, baiduVerify, ... }      │
│  · app.vue 顶部注入站长验证 meta + Organization/WebSite JSON-LD  │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 页面层 (页面 .vue 内调 useSiteSeo)                                │
│  ┌─ 7 公开页（入 sitemap）─────────────────────────────────────┐ │
│  │  · / (index.vue)         深度：WebApplication JSON-LD       │ │
│  │  · /features             深度：BreadcrumbList + ItemList     │ │
│  │  · /pricing              深度：BreadcrumbList + Product/Offer│ │
│  │  │                              + FAQPage                    │ │
│  │  · /about                深度：BreadcrumbList + AboutPage    │ │
│  │  · /privacy-agreement    最小 meta                           │ │
│  │  · /terms-of-use         最小 meta                           │ │
│  │  · /purchase-agreement   最小 meta                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─ 5 公开但 noindex 页（不入 sitemap）────────────────────────┐ │
│  │  · /login, /register, /reset-password                       │ │
│  │  · /landing/:invitedBy                                       │ │
│  │  · /403                                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ Layout 层 (4 个私密 layout 一次性 noindex)                       │
│  · dashboardLayout / admin-layout / membershipLayout /          │
│    settingsLayout 各自首行 useHead 注入 noindex                  │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│ 基础设施层 (server/routes/ + public/)                            │
│  · server/routes/sitemap.xml.ts  (动态生成 sitemap，零依赖)      │
│  · public/robots.txt              (细化 Allow/Disallow)          │
│  · public/site.webmanifest        (PWA + 移动 SEO)               │
│  · public/og/default.png 等        (OG 图占位)                   │
│  · public/<verify>.txt / .html    (百度 / 搜狗站长文件)          │
└─────────────────────────────────────────────────────────────────┘
```

**关键不变量**：
- 任何业务页面 SEO 元数据**只通过 `useSiteSeo()` 一行调用**——不允许散落的 `useHead` 直接写 SEO meta。
- 所有 URL（canonical / OG / sitemap）都基于 `runtimeConfig.public.seo.siteUrl`——**不准写死 `https://lexseek.cn` 字面量到代码里**。
- 站长验证 ID 一律走 `runtimeConfig.public.seo.*Verify`——空字符串时不渲染对应 meta，避免假数据被收录。

## 数据结构

### `shared/types/seo.ts`（新建）

```ts
/**
 * 页面 SEO 元数据配置（页面层一行调用入口）
 */
export interface SiteSeoOptions {
  /** 页面标题（不含品牌后缀），会自动拼到 titleTemplate */
  title: string
  /** 页面描述，120–160 字最佳 */
  description: string
  /** 页面路径（用于 canonical / OG URL），如 '/features' */
  path: string
  /** 关键词数组，5–10 个核心词，会逗号拼接 */
  keywords?: string[]
  /** 自定义 OG 图（绝对路径或 /og/xxx.png），默认继承全局 /og/default.png */
  ogImage?: string
  /** OG type，默认 'website' */
  ogType?: 'website' | 'article'
  /** 页面级 JSON-LD（一个或多个） */
  jsonLd?: JsonLdBlock | JsonLdBlock[]
  /** 是否禁止索引（登录/注册/邀请落地等公开但敏感页） */
  noindex?: boolean
}

/**
 * Schema.org JSON-LD 块的最小结构
 * Schema.org 类型繁多，不在编译期强约束；通过 helper 工厂函数控制运行时正确性
 */
export interface JsonLdBlock {
  '@context': 'https://schema.org'
  '@type': string
  [key: string]: unknown
}

/**
 * sitemap.xml 单条记录
 * 由 `server/routes/sitemap.xml.ts` 中的 `PUBLIC_PAGES` 数组使用。
 * 放 shared/types/ 以满足"双端共用类型集中管理"原则（即便目前仅 nitro 路由消费）。
 *
 * `changefreq` 收窄到当前 PUBLIC_PAGES 实际使用的 3 个值；
 * sitemaps.org 0.9 规范允许 always/hourly/daily/weekly/monthly/yearly/never 7 个值，
 * 未来需要更频繁的更新频次（如每日更新的列表页）时再扩展。
 */
export interface SitemapEntry {
  /** 路径（相对站点根，如 '/features'） */
  path: string
  /** 0.0–1.0，影响搜索引擎抓取优先级 */
  priority: number
  /** 更新频次，影响搜索引擎回访间隔 */
  changefreq: 'weekly' | 'monthly' | 'yearly'
}
```

### `nuxt.config.ts` 的 `runtimeConfig.public.seo`（新增字段）

```ts
runtimeConfig: {
  public: {
    seo: {
      /** 站点根 URL（不带尾 /），环境变量 NUXT_PUBLIC_SEO_SITE_URL 覆盖 */
      siteUrl: 'https://lexseek.cn',
      /** 百度站长验证字符串（codeva-xxxxx），NUXT_PUBLIC_SEO_BAIDU_VERIFY */
      baiduVerify: '',
      /** Google Search Console 验证字符串，NUXT_PUBLIC_SEO_GOOGLE_VERIFY */
      googleVerify: '',
      /** Bing Webmaster 验证字符串，NUXT_PUBLIC_SEO_BING_VERIFY */
      bingVerify: '',
      /** 搜狗站长验证字符串，NUXT_PUBLIC_SEO_SOGOU_VERIFY */
      sogouVerify: '',
      /** 360 搜索站长验证字符串，NUXT_PUBLIC_SEO_360_VERIFY */
      so360Verify: '',
    },
    // ... 已有字段
  }
}
```

环境变量在 `.env.example` 补齐说明，开发环境留空。

## 全局 head 配置（`nuxt.config.ts`）

在现有 `app.head` 基础上扩展（保留现有 `class` / 内联防闪烁样式 / 主题脚本）：

```ts
app: {
  head: {
    htmlAttrs: {
      lang: 'zh-CN',
      class: ''
    },
    titleTemplate: '%s | LexSeek 法索 AI',
    title: 'LexSeek 法索 AI - 法律人专属 AI 案件分析与诉讼辅助平台',
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'description', content: '法索 AI（LexSeek）是专为律师、法务打造的多模态 AI 案件分析平台，提供案情概要、大事记、请求权分析、合同审查、文书生成、办案工具等一站式法律 AI 工作台。' },
      { name: 'keywords', content: '法律AI,律师助手,案件分析,诉讼辅助,合同审查AI,法律文书,法律科技,AI律师,办案工具,LexSeek,法索AI' },
      { name: 'theme-color', content: '#171717' },
      { name: 'format-detection', content: 'telephone=no' },
      // OG / Twitter 默认值（页面层会覆盖）
      { property: 'og:site_name', content: 'LexSeek 法索 AI' },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'zh_CN' },
      { property: 'og:image', content: 'https://lexseek.cn/og/default.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    link: [
      { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
      { rel: 'apple-touch-icon', href: '/pwa-192x192.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
    // 保留：现有内联样式（防闪烁）+ 内联脚本（主题应用）
    style: [
      {
        innerHTML: 'html:not(.theme-ready){background:#fff}html.dark:not(.theme-ready){background:#171717}',
        tagPosition: 'head'
      }
    ],
    script: [
      {
        innerHTML: `(function(){try{var s=localStorage.getItem('color-mode');var m=s&&['light','dark','system'].includes(s)?s:'light';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);var t=localStorage.getItem('theme-color');if(t&&t!=='zinc')document.documentElement.classList.add('theme-'+t);document.documentElement.classList.add('theme-ready')}catch(e){document.documentElement.classList.add('theme-ready')}})()`,
        tagPosition: 'head'
      }
    ]
  }
}
```

注意：`og:image` 默认值在 `app.head` 中是字面量（构建期），是为了在搜索结果分享卡片**未走到 useSiteSeo 的页面**也能有图。`runtimeConfig.public.seo.siteUrl` 仅用于 SSR 阶段的页面 composable 拼 URL（运行时）。如果未来主域名变更，需同步改这个字面量。

## 核心 composable 实现

### `app/composables/useSiteSeo.ts`（新建）

```ts
import type { SiteSeoOptions } from '#shared/types/seo'

export const useSiteSeo = (opt: SiteSeoOptions) => {
  const { siteUrl } = useRuntimeConfig().public.seo
  const fullUrl = `${siteUrl}${opt.path}`
  const ogImagePath = opt.ogImage || '/og/default.png'
  const ogImage = ogImagePath.startsWith('http')
    ? ogImagePath
    : `${siteUrl}${ogImagePath}`

  useSeoMeta({
    title: opt.title,
    description: opt.description,
    keywords: opt.keywords?.join(','),
    ogTitle: `${opt.title} | LexSeek 法索 AI`,
    ogDescription: opt.description,
    ogUrl: fullUrl,
    ogImage,
    ogType: opt.ogType || 'website',
    twitterTitle: opt.title,
    twitterDescription: opt.description,
    twitterImage: ogImage,
    robots: opt.noindex ? 'noindex,nofollow' : 'index,follow',
  })

  const jsonLdScripts = (() => {
    if (!opt.jsonLd) return []
    const blocks = Array.isArray(opt.jsonLd) ? opt.jsonLd : [opt.jsonLd]
    return blocks.map((block) => ({
      type: 'application/ld+json',
      // 防御性转义 `<`，避免 JSON 字符串内含 `</script>` 时打断 HTML
      innerHTML: JSON.stringify(block).replace(/</g, '\\u003c'),
    }))
  })()

  useHead({
    link: [{ rel: 'canonical', href: fullUrl }],
    script: jsonLdScripts,
  })
}
```

说明：
- `useSeoMeta` / `useHead` / `useRuntimeConfig` 均走 Nuxt 自动导入。
- canonical 始终基于 `siteUrl + path`，避免 query string 影响。
- noindex 同时通过 `<meta name="robots">` 控制，配合 `robots.txt` 双保险。

### `shared/utils/seo/jsonLd.ts`（新建）

集中所有 JSON-LD 工厂函数，避免页面层散落字面量：

```ts
import type { JsonLdBlock } from '#shared/types/seo'

/**
 * 所有 helper 接受可选 `siteUrl` 参数，调用方从 `runtimeConfig.public.seo.siteUrl` 注入，
 * 单元测试与 SSR 场景可用默认值。这样消除"helper 字面量 + composable runtimeConfig"双轨。
 */
const DEFAULT_SITE_URL = 'https://lexseek.cn'

/** 组织信息（全局注入到 app.vue） */
export function organizationLd(siteUrl: string = DEFAULT_SITE_URL): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'LexSeek 法索 AI',
    alternateName: '法索 AI',
    legalName: '上海盛熙律泓教育科技有限公司',
    url: siteUrl,
    logo: `${siteUrl}/logo.svg`,
    email: 'lexseek@lvhong-lawer.com',
    telephone: '+86-18116032042',
    sameAs: [],
  }
}

/** 站点信息（全局注入到 app.vue） */
export function websiteLd(siteUrl: string = DEFAULT_SITE_URL): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'LexSeek 法索 AI',
    url: siteUrl,
    inLanguage: 'zh-CN',
  }
}

/**
 * Web 应用（首页注入）
 *
 * `@type: WebApplication` 是 Schema.org 中 SoftwareApplication 的官方子类型，
 * 比 `SoftwareApplication + operatingSystem: 'Web'` 语义更准确（后者 OS 字段官方示例为 Windows/Mac/Android）。
 */
export function softwareApplicationLd(siteUrl: string = DEFAULT_SITE_URL): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'LexSeek 法索 AI',
    alternateName: '法索 AI',
    applicationCategory: 'BusinessApplication',
    browserRequirements: 'Requires JavaScript. Modern evergreen browser.',
    description: '面向律师与法务的多模态 AI 精细化案件分析与诉讼辅助平台，覆盖案情分析、合同审查、法律文书生成、办案工具集合等场景。',
    url: siteUrl,
    image: `${siteUrl}/og/home.png`,
    offers: [
      { '@type': 'Offer', name: '新手旗舰套餐', price: '9.9', priceCurrency: 'CNY', category: 'subscription' },
      { '@type': 'Offer', name: '基础版', price: '365', priceCurrency: 'CNY', category: 'subscription' },
      { '@type': 'Offer', name: '专业版', price: '680', priceCurrency: 'CNY', category: 'subscription' },
      { '@type': 'Offer', name: '旗舰版', price: '1280', priceCurrency: 'CNY', category: 'subscription' },
    ],
    featureList: [
      '案情概要生成', '案件大事记', '案由确认', '请求权分析',
      '对方抗辩预测', '证据清单', '合同审查 AI', '起诉状/答辩状生成',
      '利息计算', '诉讼费计算', '律师费计算', '延迟履行利息', '银行 LPR 利率查询',
      '日期推算', '赔偿计算', '加班计算', '离婚财产分割', '社保追缴计算'
    ],
  }
}

/** 面包屑（多页通用） */
export function breadcrumbLd(
  items: Array<{ name: string; path: string }>,
  siteUrl: string = DEFAULT_SITE_URL,
): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${siteUrl}${item.path}`,
    })),
  }
}

/** FAQ（价格页用） */
export function faqLd(qa: Array<{ q: string; a: string }>): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/** 功能项列表（features 页用） */
export function itemListLd(items: Array<{ name: string; description: string }>): JsonLdBlock {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      description: item.description,
    })),
  }
}
```

注意：helper 全部以 `siteUrl` 为可选参数，默认值 `DEFAULT_SITE_URL = 'https://lexseek.cn'` 仅用于单元测试与未传场景；运行时调用方（`app/app.vue` / 各页面）从 `useRuntimeConfig().public.seo.siteUrl` 取后显式传入，消除双轨。`AboutPage` helper 已删除（Google 不展示 AboutPage 富结果，信息与 Organization 重复）；`/about` 页只保留 `BreadcrumbList`。

## 全局注入（`app/app.vue`）

在现有 setup 顶部追加（不动既有逻辑）：

```ts
// app/app.vue 现有 import 之后
import { organizationLd, websiteLd } from '#shared/utils/seo/jsonLd'

// setup 顶部，紧接 import 之后
const { seo } = useRuntimeConfig().public

useHead({
  meta: [
    seo.baiduVerify ? { name: 'baidu-site-verification', content: seo.baiduVerify } : null,
    seo.googleVerify ? { name: 'google-site-verification', content: seo.googleVerify } : null,
    seo.bingVerify ? { name: 'msvalidate.01', content: seo.bingVerify } : null,
    seo.sogouVerify ? { name: 'sogou_site_verification', content: seo.sogouVerify } : null,
    seo.so360Verify ? { name: '360-site-verification', content: seo.so360Verify } : null,
  ].filter(Boolean) as { name: string; content: string }[],
  script: [
    { type: 'application/ld+json', innerHTML: JSON.stringify(organizationLd(seo.siteUrl)).replace(/</g, '\\u003c') },
    { type: 'application/ld+json', innerHTML: JSON.stringify(websiteLd(seo.siteUrl)).replace(/</g, '\\u003c') },
  ],
})
```

说明：
- 空字符串环境变量不渲染对应 meta，避免开发环境/未配置环境暴露假数据。
- `Organization` + `WebSite` JSON-LD 全局注入一次；页面级补充的 JSON-LD 与之**并存不冲突**（同 type 多块在 Schema.org 允许）。

## 页面级 SEO 内容

### `/` 首页 `app/pages/index.vue`

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { softwareApplicationLd } from '#shared/utils/seo/jsonLd'

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '法律 AI 案件分析平台 - 律师专属 AI 工作台',
  description: 'LexSeek 法索 AI 是专为法律人打造的多模态 AI 精细化案件分析工具，告别低效梳理、专注精准判断：AI 案情分析、请求权分析、合同审查、起诉状/答辩状生成、利息/诉讼费计算等一站式办案工具。注册即享 7 天旗舰版免费试用。',
  path: '/',
  keywords: ['法律AI', '律师AI助手', '案件分析', 'AI律师', '诉讼辅助', '合同审查AI', '法律文书AI', '法律科技', '办案工具', 'LexSeek', '法索AI'],
  ogImage: '/og/home.png',
  jsonLd: softwareApplicationLd(siteUrl),
})
```

### `/features` 产品功能 `app/pages/features.vue`

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd, itemListLd } from '#shared/utils/seo/jsonLd'

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '产品功能 - AI 案件分析、合同审查、法律文书生成',
  description: 'LexSeek 法索 AI 全功能介绍：AI 案情概要、案件大事记、请求权分析、对方抗辩预测、证据清单、合同审查 AI、起诉状/答辩状一键生成，深度赋能律师办案全流程。',
  path: '/features',
  keywords: ['AI案件分析', '案情概要', '案件大事记', '请求权分析', '抗辩预测', '证据清单', '合同审查AI', '起诉状生成', '答辩状生成', '法律文书AI'],
  ogImage: '/og/features.png',
  jsonLd: [
    breadcrumbLd([
      { name: '首页', path: '/' },
      { name: '产品功能', path: '/features' },
    ], siteUrl),
    itemListLd([
      { name: '案情概要生成', description: 'AI 自动分析案件材料，提取关键信息并生成简洁明了的案情概要' },
      { name: '案件大事记', description: '自动整理案件中的重要时间点和事件，按时间顺序呈现关键事件' },
      { name: '案由确认', description: '智能识别案件类型和案由，提供法律依据和典型案件参考' },
      { name: '请求权生成与分析', description: '根据案情自动生成可能的请求权，并提供详细分析和法律依据' },
      { name: '对方抗辩预测', description: '预测对方可能的抗辩理由和策略，帮助提前准备应对方案' },
      { name: '证据清单', description: '分析并整理案件所需证据清单建议' },
      { name: '法律合理性审查和判决趋势预测', description: '案件法律合理性审查、预测判决趋势' },
      { name: '分析历史记录', description: '保存所有分析结果，随时查阅和比较' },
    ]),
  ],
})
```

### `/pricing` 价格方案 `app/pages/pricing.vue`

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd, faqLd } from '#shared/utils/seo/jsonLd'

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '价格方案 - 律师 AI 会员订阅',
  description: 'LexSeek 法索 AI 提供新手旗舰¥9.9/月、基础版¥365/年、专业版¥680/年、旗舰版¥1280/年四档会员，覆盖案件分析、合同审查、办案工具全功能；注册即享 7 天免费试用。',
  path: '/pricing',
  keywords: ['LexSeek会员', '法律AI订阅', '律师AI价格', '案件分析订阅', '法律科技会员'],
  ogImage: '/og/pricing.png',
  jsonLd: [
    breadcrumbLd([
      { name: '首页', path: '/' },
      { name: '价格方案', path: '/pricing' },
    ], siteUrl),
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'LexSeek 法索 AI 会员订阅',
      description: '律师 AI 工作台会员订阅，提供案件分析、合同审查、办案工具全功能',
      brand: { '@type': 'Brand', name: 'LexSeek 法索 AI' },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'CNY',
        lowPrice: '9.9',
        highPrice: '1280',
        offerCount: 4,
      },
    },
    faqLd([
      { q: '有免费试用吗？', a: '是的，新用户注册后可获得 7 天免费试用，可体验旗舰版的全部功能。' },
      { q: '可以随时更换订阅方案吗？', a: '您可以随时升级您的订阅方案，但降级需要等待当前会员有效期结束后进行续订。' },
    ]),
  ],
})
```

### `/about` 关于我们 `app/pages/about.vue`

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd } from '#shared/utils/seo/jsonLd'

const { siteUrl } = useRuntimeConfig().public.seo
useSiteSeo({
  title: '关于 LexSeek 法索 AI - 用 AI 重塑法律服务',
  description: 'LexSeek 法索 AI 由上海盛熙律泓教育科技有限公司打造，致力于将多模态 AI 与法律专业知识深度融合，为律师与法务提供高效、精准的智能办案工具。',
  path: '/about',
  keywords: ['LexSeek', '法索AI', '法律科技公司', '法律AI团队', '上海盛熙律泓'],
  ogImage: '/og/about.png',
  jsonLd: breadcrumbLd([
    { name: '首页', path: '/' },
    { name: '关于我们', path: '/about' },
  ], siteUrl),
})
```

### 次要公开页（最小化处理）

| 页面文件 | title | description |
|---|---|---|
| `app/pages/privacy-agreement.vue` | `隐私政策` | `LexSeek 法索 AI 隐私政策，详细说明我们如何收集、使用、存储和保护您的个人信息。` |
| `app/pages/terms-of-use.vue` | `使用条款` | `LexSeek 法索 AI 使用条款，明确平台服务范围、用户权利义务及相关法律约定。` |
| `app/pages/purchase-agreement.vue` | `购买协议` | `LexSeek 法索 AI 会员服务购买协议，包含订阅服务、计费、退款等相关条款。` |

各页面调用：

```ts
useSiteSeo({
  title: '隐私政策',
  description: '...',
  path: '/privacy-agreement',
  // 无 keywords / jsonLd
})
```

### noindex 公开页

| 页面文件 | title | 备注 |
|---|---|---|
| `app/pages/login.vue` | `登录` | `noindex: true` |
| `app/pages/register.vue` | `注册` | `noindex: true` |
| `app/pages/reset-password.vue` | `重置密码` | `noindex: true` |
| `app/pages/landing/[invitedBy].vue` | `专属邀请` | `noindex: true`，避免个性化页被收录 |
| `app/pages/403.vue` | `无权限访问` | `noindex: true` |

调用示例：

```ts
useSiteSeo({
  title: '登录',
  description: '登录您的 LexSeek 法索 AI 账号。',
  path: '/login',
  noindex: true,
})
```

## 私密 Layout noindex 兜底

在 4 个私密 layout 的 `<script setup>` 首行追加（不动现有逻辑）：

```ts
// app/layouts/dashboardLayout.vue
// app/layouts/admin-layout.vue
// app/layouts/membershipLayout.vue
// app/layouts/settingsLayout.vue
useHead({
  meta: [{ name: 'robots', content: 'noindex,nofollow' }]
})
```

> `baseLayout.vue` 不动——它服务公开页面（首页/关于/功能/价格等），robots 由各页面层 `useSiteSeo` 控制。

## 基础设施层

### `public/robots.txt`（重写）

```
# robots.txt for LexSeek 法索 AI

User-Agent: *
Allow: /

# 私密区域（前缀匹配，统一加尾 / 明确语义，避免误屏 /dashboardabc 等假想路径）
Disallow: /dashboard/
Disallow: /admin/
Disallow: /api/
Disallow: /landing/
# 公开但敏感的单一页面（已页面级 noindex 兜底，robots 是双保险）
# 注意：以下 4 条是前缀匹配，未来若新增 /login-help、/register-pro 等公开 SEO 着陆页需重审本规则
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /403

# 用户上传的私密资源
Disallow: /oss/

# 站点地图
Sitemap: https://lexseek.cn/sitemap.xml
```

### `server/routes/sitemap.xml.ts`（新建）

`SitemapEntry` 类型放在 `shared/types/seo.ts`（与 `SiteSeoOptions` 同处），路由文件本身只含数据列表与 XML 生成逻辑：

```ts
// server/routes/sitemap.xml.ts
import type { SitemapEntry } from '#shared/types/seo'

const PUBLIC_PAGES: SitemapEntry[] = [
  { path: '/',                   priority: 1.0, changefreq: 'weekly' },
  { path: '/features',           priority: 0.9, changefreq: 'monthly' },
  { path: '/pricing',            priority: 0.9, changefreq: 'monthly' },
  { path: '/about',              priority: 0.7, changefreq: 'monthly' },
  { path: '/privacy-agreement',  priority: 0.3, changefreq: 'yearly' },
  { path: '/terms-of-use',       priority: 0.3, changefreq: 'yearly' },
  { path: '/purchase-agreement', priority: 0.3, changefreq: 'yearly' },
]

export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig().public.seo
  const lastmod = new Date().toISOString().slice(0, 10)

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')

  const urls = PUBLIC_PAGES.map((p) => `  <url>
    <loc>${siteUrl}${p.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority.toFixed(1)}</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
})
```

说明：
- 单文件实现：数据列表 `PUBLIC_PAGES` 与 XML 生成逻辑都在 nitro 路由内（不再拆 `shared/utils/seo/sitemap.ts` 纯函数 + 单测——7 条静态路径 + 80 字符字符串拼接拆文件价值低）；通过浏览器验证清单中的 `curl /sitemap.xml + xmllint` 直接验证 XML 合法性。
- 路径写死，公开页数量稳定（7 条），新增公开页时同步追加。
- `lastmod` 用当前日期（不精确到分钟），避免每次请求都生成不同值，影响 CDN/搜索引擎缓存判断。
- `setHeader` 设 1 小时 cache-control，减小服务压力。

### `public/site.webmanifest`（新建）

```json
{
  "name": "LexSeek 法索 AI",
  "short_name": "LexSeek",
  "description": "律师专属 AI 案件分析与诉讼辅助平台",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#171717",
  "lang": "zh-CN",
  "icons": [
    { "src": "/pwa-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512x512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 站长验证文件

| 平台 | 接入方式 | 文件位置 / meta |
|---|---|---|
| 百度 | meta + 文件 | meta：`baidu-site-verification`（运行时注入）；文件：现有 `public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt` 待运维确认是否为百度 |
| Google | meta | `google-site-verification`（运行时注入） |
| Bing | meta | `msvalidate.01`（运行时注入） |
| 搜狗 | meta + 文件 | meta：`sogou_site_verification`（运行时注入）；文件由运维上传 `public/sogou_xxxxx.txt` |
| 360 | meta | `360-site-verification`（运行时注入） |

> **实施 step 0：与运维确认 `public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt` 是哪个平台的验证文件**——如果不是当前需要的，决定是删除还是保留。

### OG 图占位（不阻塞主流程）

| 文件 | 内容 | 实施阶段 |
|---|---|---|
| `public/og/default.png` | 1200×630 通用占位图（深色渐变 + LexSeek 法索 AI 字样 + 副标题） | 本期一起生成 |
| `public/og/home.png` | 1200×630 首页占位图（副标题改为「法律 AI 案件分析平台」） | 本期一起生成 |
| `public/og/features.png` | 1200×630 功能页占位图（副标题改为「全方位法律分析工具」） | 本期一起生成 |
| `public/og/pricing.png` | 1200×630 价格页占位图（副标题改为「灵活会员订阅 ¥9.9 起」） | 本期一起生成 |
| `public/og/about.png` | 1200×630 关于页占位图（副标题改为「用 AI 重塑法律服务」） | 本期一起生成 |

> 5 张图本期通过 `sharp` 一次性批量生成（同模板、不同副标题文案），所有页面 `useSiteSeo` 中的 `ogImage` 路径都能命中实际文件。设计后续若提供高保真稿可逐张替换，不需改代码。

### `.env.example` 追加

```bash
# SEO 站长验证（线上配置，开发环境留空；空字符串不渲染对应 meta，避免假数据被收录）
NUXT_PUBLIC_SEO_SITE_URL=https://lexseek.cn
# 旧站 lexseek_web 已申请过的百度站长验证值参考：codeva-SODQaUizoh
# 主域名若沿用 lexseek.cn 可继续复用此值；若启用新域名需重新申请。
NUXT_PUBLIC_SEO_BAIDU_VERIFY=
NUXT_PUBLIC_SEO_GOOGLE_VERIFY=
NUXT_PUBLIC_SEO_BING_VERIFY=
NUXT_PUBLIC_SEO_SOGOU_VERIFY=
NUXT_PUBLIC_SEO_360_VERIFY=
```

## 测试策略

### 单元测试（composable + helper）

`tests/client/composables/useSiteSeo.test.ts`（精简为 8 个关键断言）：

| 用例 | 期望 |
|---|---|
| 基础调用（含 title/description/path） | 注入正确的 title、description、canonical 链接、`index,follow` robots |
| 含 keywords 数组 | meta keywords 内容为逗号拼接 |
| ogImage 三态（相对路径 / 绝对 URL / 缺省默认） | 相对路径拼 siteUrl；http 开头不再拼；缺省回退到 `/og/default.png` |
| 含单个 jsonLd | 注入 1 个 `<script type="application/ld+json">` |
| 含 jsonLd 数组 | 注入 N 个 script |
| 不传 jsonLd | script 数组为空 |
| JSON-LD 内含 `</script>` 等危险字符 | `<` 被转义为 `<`，innerHTML 不包含原始 `</script>` |
| `noindex: true` / `false` / 缺省 | 分别为 `noindex,nofollow` / `index,follow` / `index,follow` |

`tests/shared/utils/seo/jsonLd.test.ts`：

| 用例 | 期望 |
|---|---|
| `organizationLd()` 默认 siteUrl | 含 name、url、logo、legalName，url 为 `https://lexseek.cn` |
| `organizationLd('https://staging.lexseek.cn')` | url / logo 前缀替换为 staging 域 |
| `breadcrumbLd` 多项 | position 从 1 递增；item 拼接 siteUrl |
| `breadcrumbLd` 空数组 | itemListElement 为空数组（不抛错） |
| `faqLd` 多项 | mainEntity 数组结构正确 |
| `softwareApplicationLd` | `@type === 'WebApplication'`；含 4 档 Offer；featureList 含案件分析/合同审查/利息计算 |
| `itemListLd` | position 从 1 递增 |

### 集成验证（sitemap 路由）

sitemap 实现合并到 `server/routes/sitemap.xml.ts` 单文件（无独立 shared 纯函数 / 无独立单测文件），由"手动浏览器验证清单"中的 `curl /sitemap.xml` + XML 解析步骤覆盖：

| 验证点 | 检查方式 |
|---|---|
| HTTP 200 + `content-type: application/xml` | `curl -I http://localhost:3000/sitemap.xml` |
| 包含全部 7 个公开页 URL | `curl -s http://localhost:3000/sitemap.xml \| grep -c '<loc>'` 应为 7 |
| 不包含私密路径 | `curl -s ... \| grep -E '/login\|/admin\|/dashboard'` 应为空 |
| 合法 XML | `curl -s ... \| xmllint --noout -`（macOS 内置 xmllint） |

### 手动浏览器验证清单（chrome-devtools MCP）

本地 dev 启动后：

1. `/` 首页 → 查看 `<head>`：含 title / description / keywords / OG / Twitter / canonical / `application/ld+json` 含 `@type:WebApplication`
2. `/features` → 检查 BreadcrumbList + ItemList JSON-LD
3. `/pricing` → 检查 FAQPage + Product 的 AggregateOffer
4. `/about` → 检查 BreadcrumbList JSON-LD（仅面包屑，AboutPage helper 已删除）
5. `/login` / `/register` → 检查 `<meta name="robots" content="noindex,nofollow">`
6. `/dashboard` → 检查 layout 注入的 noindex
7. `/sitemap.xml` → 浏览器直接打开，可见 7 条 URL
8. `/robots.txt` → 浏览器直接打开，Disallow 列表完整

### 部署后验证（线上 curl）

```bash
# 1. robots & sitemap 可达且内容正确
curl -s https://lexseek.cn/robots.txt
curl -s https://lexseek.cn/sitemap.xml

# 2. 任意公开页 SSR 出 SEO meta
curl -s https://lexseek.cn/pricing | grep -E '<title>|name="description"|name="keywords"|property="og:|application/ld\+json'

# 3. 私密页含 noindex
curl -s https://lexseek.cn/login | grep 'name="robots"'  # 应包含 noindex
curl -s https://lexseek.cn/dashboard | grep 'name="robots"'

# 4. canonical 正确指向 https 主域
curl -s https://lexseek.cn/features | grep 'rel="canonical"'

# 5. 站长验证 meta（线上才生效）
curl -s https://lexseek.cn/ | grep -E 'baidu-site-verification|google-site-verification|msvalidate|sogou_site_verification|360-site-verification'
```

线上验证工具：
- [Google Rich Results Test](https://search.google.com/test/rich-results) — 验 JSON-LD 是否合法且被识别
- [Schema.org Validator](https://validator.schema.org) — 验 Schema.org 类型正确性
- [百度站长平台](https://ziyuan.baidu.com) — 提交 sitemap、验证 robots、抓取诊断

## 实施清单（文件影响范围）

### 新增文件（11）

- `shared/types/seo.ts`（`SiteSeoOptions` / `JsonLdBlock` / `SitemapEntry`）
- `shared/utils/seo/jsonLd.ts`（6 个 helper：organization / website / softwareApplication / breadcrumb / faq / itemList；删除了 aboutPage）
- `app/composables/useSiteSeo.ts`
- `server/routes/sitemap.xml.ts`（含 PUBLIC_PAGES 与 XML 生成逻辑，单文件）
- `public/site.webmanifest`
- `public/og/default.png`（通用占位，1200×630）
- `public/og/home.png` / `features.png` / `pricing.png` / `about.png`（4 张分页占位，1200×630，同模板、不同副标题）
- `tests/client/composables/useSiteSeo.test.ts`（8 个 case）
- `tests/shared/utils/seo/jsonLd.test.ts`（7 个 case）

### 改造文件（21）

- `nuxt.config.ts`（扩 `app.head` + 新增 `runtimeConfig.public.seo`）
- `.env.example`（追加 SEO 环境变量）
- `.claude/rules/git.md`（commit scope 白名单追加 `seo`）
- `public/robots.txt`（重写，Disallow 加尾 /）
- `app/app.vue`（顶部追加站长 meta + 全局 JSON-LD 注入）
- `app/layouts/dashboardLayout.vue`（首行 useHead noindex）
- `app/layouts/admin-layout.vue`（首行 useHead noindex）
- `app/layouts/membershipLayout.vue`（首行 useHead noindex）
- `app/layouts/settingsLayout.vue`（首行 useHead noindex）
- `app/pages/dashboard/legal/index.vue`（已有 `useSeoMeta` 直调，统一改写为 `useSiteSeo({ ..., noindex: true })` 与 spec 不变量自洽）
- `app/pages/index.vue`（追加 useSiteSeo + WebApplication JSON-LD）
- `app/pages/features.vue`（追加 useSiteSeo + Breadcrumb + ItemList）
- `app/pages/pricing.vue`（追加 useSiteSeo + Breadcrumb + Product + FAQPage）
- `app/pages/about.vue`（追加 useSiteSeo + Breadcrumb，不含 AboutPage）
- `app/pages/privacy-agreement.vue`（最小 useSiteSeo）
- `app/pages/terms-of-use.vue`（最小 useSiteSeo）
- `app/pages/purchase-agreement.vue`（最小 useSiteSeo）
- `app/pages/login.vue`（useSiteSeo + noindex）
- `app/pages/register.vue`（useSiteSeo + noindex）
- `app/pages/reset-password.vue`（useSiteSeo + noindex）
- `app/pages/landing/[invitedBy].vue`（useSiteSeo + noindex）
- `app/pages/403.vue`（useSiteSeo + noindex）

**总计影响 32 个文件**：11 新增 + 21 改造。全部前端 / 配置 / 静态资源，**无后端业务 / 无数据库迁移 / 无依赖新增**。

## 非目标（明确不做）

- **新增 SEO 着陆页 / 博客**——用户头脑风暴选了"完整方案"而非"基建 + 长尾着陆页"。
- **办案工具 `/dashboard/tools/*` 公开化**——这些页面位于登录后区域，本次保持 noindex；**未来如要做工具长尾 SEO（如"利息计算器"独立公开页），需另起设计 + 公开版页面 + 引导注册**。
- **OG 图最终设计**——本期通过 `sharp` 一次性批量生成 5 张占位图（default + home/features/pricing/about，同模板、不同副标题），可正式上线；设计后续若提供高保真稿可逐张替换，不需改代码。
- **i18n 国际化**——目前仅 zh-CN，未规划多语言。
- **AMP / mobile-specific URL**——Nuxt 4 SSR + Tailwind 响应式已满足移动端 SEO 需求，不另做 AMP 版。
- **预渲染 / nuxt generate**——保留 SSR 模式，sitemap 走 nitro 路由动态生成；如果未来要 `nuxt generate` 静态化，sitemap 路由仍可以在生成期一并产出。
- **图片 alt 全量审查**——本期不专项审查现有页面图片 alt，若发现遗漏在实施阶段顺手补；不专门遍历所有图片。
- **关键词内容深度优化**——本期仅在 meta description / JSON-LD 中布局关键词，**不重写页面正文文案**；正文文案改写需要产品/法务/设计联合决策，不在 SEO 优化范围。

## 未决细节（实施时确认）

1. **`public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt` 来源**——文件名为 32 位 hex，符合百度站长校验文件命名格式（百度通常签发 `<hex>.html` 或 `<hex>.txt`），实施 Task 5 Step 0 与运维二次核对；若确认是旧站百度文件，保留；非则与运维协商删除或挪移。
2. **`public/MP_verify_l7bw3QUad79dIxSb.txt`**——微信公众平台域名验证文件，与 SEO 无关但需要保留（用于微信公众号 / 小程序 H5 域名校验）；本次设计不动它。
3. **站长验证 ID 实际值**——百度 / Google / Bing / 360 / 搜狗 五个平台的验证字符串由运维在各自站长平台申请后填到环境变量中（`.env` 而非 `.env.example`）；开发本期只交付占位机制，**不在 commit 中填真实 ID**；旧站百度 verify `codeva-SODQaUizoh` 若主域名沿用 lexseek.cn 可继续复用。
4. **`sitemap.xml` 是否需要按多语言/分地区扩展**——当前仅 zh-CN，单语言；如果未来加 en/multi-region，需扩展为 sitemap index + 多个子 sitemap。
5. **Nuxt `useSeoMeta` 在 SSR 模式下的水合行为**——验证集成测试中 robots meta 在 SSR 渲染时即出现，而不是仅 client 侧补全；如果发现 SSR 不渲染，改用 `useHead({ meta: [...] })` 强制写入。
6. **`useSeoMeta` 是否在 Nuxt 4 自动导入白名单内**——`useHead` 确认自动导入，`useSeoMeta` 在文档中也是 auto-import 候选；实施 Task 4 typecheck 后在 dev 端控制台二次确认；若发现报"is not defined"，则在 `useSiteSeo` 顶部加 `import { useSeoMeta } from '#imports'` 兜底。

## 风险与回退

- **风险 1**：JSON-LD 字面量包含特殊字符（如 `</script>`）会破坏 HTML——`JSON.stringify` 默认不转义 `<`，需要在 `useSiteSeo` 中对 innerHTML 做 `replace(/</g, '\\u003c')` 防御性转义。
- **风险 2**：环境变量未配置导致空 meta 被渲染——`app.vue` 中已用 `seo.xxxVerify ? {...} : null` + `filter(Boolean)` 过滤空值。
- **风险 3**：sitemap 路由路径冲突——Nuxt 优先级中，`server/routes/sitemap.xml.ts`（动态 nitro 路由）会**覆盖** `public/sitemap.xml`（静态文件，如果存在），需确保 `public/` 下没有同名静态文件。实施 step 1 检查。
- **风险 4**：noindex 误伤——layout 级 noindex 会让所有该 layout 子页都不被索引，需确认 `dashboardLayout` / `admin-layout` / `membershipLayout` / `settingsLayout` 下**没有任何应该被索引的子页**。当前所有 dashboard / admin / membership / settings 子页都是私密区域，符合预期。
- **回退路径**：所有改动都是新增 meta / 配置文件，**不改业务逻辑**；如果发现某条 SEO 配置导致问题，单独回退该条即可。最差情况下回退到当前"裸奔"状态，业务零影响。
