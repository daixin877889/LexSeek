# SEO 优化 — 全站基建 + 核心公开页深度优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前几乎"裸奔"的 SEO（仅 `definePageMeta.title`）升级到生产级别 — 全局 head / robots / sitemap / 多平台站长验证 / Organization+WebSite+WebApplication JSON-LD / canonical / OG / 4 个核心公开页文案与 JSON-LD 精修 / 私密页 noindex 兜底 / PWA manifest。

**Architecture:** 三层结构 — (1) 基础设施层：`public/robots.txt`、`public/site.webmanifest`、`public/og/*.png` 5 张图、`server/routes/sitemap.xml.ts`（单文件，数据 + XML 生成都在里面）；(2) 抽象层：`shared/types/seo.ts`（`SiteSeoOptions` / `JsonLdBlock` / `SitemapEntry`）+ `shared/utils/seo/jsonLd.ts` 6 个 helper（已删 AboutPage）+ `app/composables/useSiteSeo.ts`；(3) 注入层：`nuxt.config.ts` 全局 head + `app/app.vue` 站长验证与全局 JSON-LD + 4 私密 layout noindex + 13 个公开/私密页面调 `useSiteSeo`。零新增依赖。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Nitro Server + Vitest（client / shared 单测，`vi.stubGlobal` 模式）+ Schema.org JSON-LD + sharp（已存在依赖，用于批量生成 OG 占位图）

**Spec:** `docs/superpowers/specs/2026-05-14-seo-optimization-design.md`

**Pre-conditions:**
- 生产主域名：`https://lexseek.cn`（写入 `runtimeConfig.public.seo.siteUrl` 默认值）
- 项目已禁用自动扫描自定义代码（`imports.scan: false`、`nitro.imports.dirs: []`）— 所有 composables / helper / type 必须显式 import
- `useHead` / `useRuntimeConfig` / `defineEventHandler` / `setHeader` 由 Nuxt/Nitro 自动导入，无需手写 import；`useSeoMeta` Nuxt 4 自动导入，Task 4 typecheck 后在 dev 端二次确认（若报"not defined"则 `useSiteSeo` 顶部加 `import { useSeoMeta } from '#imports'` 兜底）
- `public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt`：32 位 hex 命名符合百度站长校验文件格式（百度签发 `<hex>.txt` 或 `<hex>.html`），Task 5 Step 0 与运维确认；`public/MP_verify_l7bw3QUad79dIxSb.txt` 是微信公众平台域名验证文件，保留不动
- commit scope `seo` 已加入 `.claude/rules/git.md` 白名单

---

## File Structure（共 32 个文件：11 新增 + 21 改造）

### 新增（11）

| 文件 | 责任 |
|---|---|
| `shared/types/seo.ts` | `SiteSeoOptions` / `JsonLdBlock` / `SitemapEntry` 类型定义 |
| `shared/utils/seo/jsonLd.ts` | Schema.org JSON-LD 工厂函数（6 个：organization / website / softwareApplication / breadcrumb / faq / itemList；不含 aboutPage） |
| `app/composables/useSiteSeo.ts` | 页面 SEO 一行调用入口，封装 useSeoMeta + canonical + JSON-LD 注入 |
| `server/routes/sitemap.xml.ts` | nitro 路由：PUBLIC_PAGES 数据列表 + XML 字符串生成 + Content-Type / Cache-Control（单文件） |
| `public/site.webmanifest` | PWA manifest（移动端 SEO 评分） |
| `public/og/default.png` | OG 通用占位图（1200×630，深色渐变 + LexSeek 字样 + 副标题） |
| `public/og/home.png` | OG 首页占位图（同模板，副标题"法律 AI 案件分析平台"） |
| `public/og/features.png` | OG 功能页占位图（同模板，副标题"全方位法律分析工具"） |
| `public/og/pricing.png` | OG 价格页占位图（同模板，副标题"灵活会员订阅 ¥9.9 起"） |
| `public/og/about.png` | OG 关于页占位图（同模板，副标题"用 AI 重塑法律服务"） |
| `tests/shared/utils/seo/jsonLd.test.ts` | JSON-LD helper 单测（7 个 it） |
| `tests/client/composables/useSiteSeo.test.ts` | useSiteSeo composable 单测（8 个 it） |

### 改造（21）

| 文件 | 改动 |
|---|---|
| `.claude/rules/git.md` | commit scope 白名单追加 `seo` |
| `nuxt.config.ts` | 扩 `app.head`（lang/titleTemplate/默认 meta/OG 默认/manifest，不含 mobile-app 三联与 twitter:site）+ 新增 `runtimeConfig.public.seo` 6 字段 |
| `.env.example` | 追加 6 个 `NUXT_PUBLIC_SEO_*` 环境变量说明（含旧站百度 verify 参考值注释） |
| `public/robots.txt` | 重写：Disallow 前缀加尾 / + Sitemap 指向 |
| `app/app.vue` | 顶部 setup 追加 useHead 注入站长 meta + 全局 Organization/WebSite JSON-LD（helper 传 `seo.siteUrl`） |
| `app/layouts/dashboardLayout.vue` | 首行 useHead noindex |
| `app/layouts/admin-layout.vue` | 首行 useHead noindex |
| `app/layouts/membershipLayout.vue` | 首行 useHead noindex |
| `app/layouts/settingsLayout.vue` | 首行 useHead noindex |
| `app/pages/dashboard/legal/index.vue` | 已有 `useSeoMeta` 直调统一改写为 `useSiteSeo({ ..., noindex: true })` 与 spec 不变量自洽 |
| `app/pages/index.vue` | 追加 useSiteSeo + WebApplication JSON-LD；description 含 lexseek_web slogan |
| `app/pages/features.vue` | 追加 useSiteSeo + Breadcrumb + ItemList |
| `app/pages/pricing.vue` | 追加 useSiteSeo + Breadcrumb + Product/AggregateOffer + FAQPage |
| `app/pages/about.vue` | 追加 useSiteSeo + Breadcrumb（不含 AboutPage） |
| `app/pages/privacy-agreement.vue` | 追加最小 useSiteSeo |
| `app/pages/terms-of-use.vue` | 追加最小 useSiteSeo |
| `app/pages/purchase-agreement.vue` | 追加最小 useSiteSeo |
| `app/pages/login.vue` | 追加 useSiteSeo + noindex |
| `app/pages/register.vue` | 追加 useSiteSeo + noindex |
| `app/pages/reset-password.vue` | 追加 useSiteSeo + noindex |
| `app/pages/landing/[invitedBy].vue` | 追加 useSiteSeo + noindex |
| `app/pages/403.vue` | 追加 useSiteSeo + noindex |

---

## Task 1: 类型定义 `shared/types/seo.ts`

**Files:**
- Create: `shared/types/seo.ts`

- [ ] **Step 1: 创建类型文件**

```ts
/**
 * SEO 相关类型定义
 *
 * 页面通过 `useSiteSeo(options)` 一行调用注入 SEO 元数据；
 * JSON-LD 通过 `shared/utils/seo/jsonLd.ts` 中的工厂函数构造；
 * sitemap 路径列表由 `server/routes/sitemap.xml.ts` 用 `SitemapEntry[]` 声明。
 */

/**
 * 页面 SEO 元数据配置（页面层一行调用入口）
 */
export interface SiteSeoOptions {
  /** 页面标题（不含品牌后缀），自动拼到 titleTemplate */
  title: string
  /** 页面描述，120–160 字最佳 */
  description: string
  /** 页面路径（用于 canonical / OG URL），如 '/features' */
  path: string
  /** 关键词数组，5–10 个核心词，会逗号拼接到 meta keywords */
  keywords?: string[]
  /** 自定义 OG 图（绝对路径或 /og/xxx.png）；默认继承全局 /og/default.png */
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
 *
 * Schema.org 类型繁多，不在编译期强约束 `@type`；通过 helper 工厂函数控制运行时正确性。
 */
export interface JsonLdBlock {
  '@context': 'https://schema.org'
  '@type': string
  [key: string]: unknown
}

/**
 * sitemap.xml 单条记录
 *
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

- [ ] **Step 2: 运行类型检查确认无错**

Run: `npx nuxi typecheck 2>&1 | grep -E 'seo|error TS' | head -20`
Expected: 输出为空（无错误）

- [ ] **Step 3: Commit**

```bash
git add shared/types/seo.ts
git commit -m "feat(seo): 新增 SEO 类型定义（SiteSeoOptions / JsonLdBlock / SitemapEntry）"
```

---

## Task 2: JSON-LD 工厂函数 `shared/utils/seo/jsonLd.ts`（TDD）

**Files:**
- Create: `tests/shared/utils/seo/jsonLd.test.ts`
- Create: `shared/utils/seo/jsonLd.ts`

- [ ] **Step 1: 先写失败测试**

创建 `tests/shared/utils/seo/jsonLd.test.ts`：

```ts
/**
 * SEO JSON-LD 工厂函数测试
 *
 * **Feature: seo-optimization**
 */

import { describe, it, expect } from 'vitest'
import {
  organizationLd,
  websiteLd,
  softwareApplicationLd,
  breadcrumbLd,
  faqLd,
  itemListLd,
} from '#shared/utils/seo/jsonLd'

describe('organizationLd', () => {
  it('默认 siteUrl 返回合法 Schema.org Organization', () => {
    const ld = organizationLd()
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('Organization')
    expect(ld.name).toBe('LexSeek 法索 AI')
    expect(ld.alternateName).toBe('法索 AI')
    expect(ld.legalName).toBe('上海盛熙律泓教育科技有限公司')
    expect(ld.url).toBe('https://lexseek.cn')
    expect(ld.logo).toBe('https://lexseek.cn/logo.svg')
    expect(ld.email).toBe('lexseek@lvhong-lawer.com')
    expect(ld.telephone).toBe('+86-18116032042')
  })

  it('显式传入 siteUrl 时 url / logo 替换为新域', () => {
    const ld = organizationLd('https://staging.lexseek.cn')
    expect(ld.url).toBe('https://staging.lexseek.cn')
    expect(ld.logo).toBe('https://staging.lexseek.cn/logo.svg')
  })
})

describe('websiteLd', () => {
  it('返回合法 Schema.org WebSite，含 zh-CN', () => {
    const ld = websiteLd()
    expect(ld['@type']).toBe('WebSite')
    expect(ld.name).toBe('LexSeek 法索 AI')
    expect(ld.url).toBe('https://lexseek.cn')
    expect(ld.inLanguage).toBe('zh-CN')
  })
})

describe('softwareApplicationLd', () => {
  it('返回合法 Schema.org WebApplication，含 4 档定价与 featureList', () => {
    const ld = softwareApplicationLd()
    // WebApplication 是 SoftwareApplication 的官方子类型，比 'SoftwareApplication + operatingSystem' 语义更准确
    expect(ld['@type']).toBe('WebApplication')
    expect(ld.applicationCategory).toBe('BusinessApplication')
    expect(ld.browserRequirements).toContain('JavaScript')
    expect(ld.operatingSystem).toBeUndefined() // 已删除该字段（OS 字段官方示例为 Windows/Mac/Android，不适合 Web 应用）
    const offers = ld.offers as Array<{ price: string }>
    expect(offers).toHaveLength(4)
    expect(offers[0]!.price).toBe('9.9')
    expect(offers[1]!.price).toBe('365')
    expect(offers[2]!.price).toBe('680')
    expect(offers[3]!.price).toBe('1280')
    const featureList = ld.featureList as string[]
    expect(featureList).toContain('案情概要生成')
    expect(featureList).toContain('合同审查 AI')
    expect(featureList).toContain('利息计算')
  })
})

describe('breadcrumbLd', () => {
  it('多项面包屑，position 从 1 递增', () => {
    const ld = breadcrumbLd([
      { name: '首页', path: '/' },
      { name: '产品功能', path: '/features' },
    ])
    expect(ld['@type']).toBe('BreadcrumbList')
    const items = ld.itemListElement as Array<{ position: number; name: string; item: string }>
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ position: 1, name: '首页', item: 'https://lexseek.cn/' })
    expect(items[1]).toMatchObject({ position: 2, name: '产品功能', item: 'https://lexseek.cn/features' })
  })

  it('空数组不抛错', () => {
    const ld = breadcrumbLd([])
    expect((ld.itemListElement as unknown[]).length).toBe(0)
  })
})

describe('faqLd', () => {
  it('多条问答，mainEntity 结构正确', () => {
    const ld = faqLd([
      { q: '有免费试用吗？', a: '是的，7 天免费试用。' },
      { q: '可以升级吗？', a: '可以随时升级。' },
    ])
    expect(ld['@type']).toBe('FAQPage')
    const entities = ld.mainEntity as Array<{ '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }>
    expect(entities).toHaveLength(2)
    expect(entities[0]!.name).toBe('有免费试用吗？')
    expect(entities[0]!.acceptedAnswer.text).toBe('是的，7 天免费试用。')
  })
})

describe('itemListLd', () => {
  it('功能项列表，position 从 1 递增', () => {
    const ld = itemListLd([
      { name: '案情概要生成', description: 'AI 自动生成案情概要' },
      { name: '案件大事记', description: '自动整理时间线' },
    ])
    expect(ld['@type']).toBe('ItemList')
    const items = ld.itemListElement as Array<{ position: number; name: string; description: string }>
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ position: 1, name: '案情概要生成' })
    expect(items[1]!.position).toBe(2)
  })
})
```

> 共 7 个 it 用例，覆盖 6 个 helper。`aboutPageLd` 已从 spec 中删除（Google 不展示 AboutPage 富结果，信息与 Organization 重复），不再测试。

- [ ] **Step 2: 运行测试确认失败（模块未实现）**

Run: `npx vitest run tests/shared/utils/seo/jsonLd.test.ts --reporter=verbose`
Expected: FAIL，错误信息包含 "Cannot find module" 或 "Failed to resolve import"

- [ ] **Step 3: 实现 `shared/utils/seo/jsonLd.ts`**

```ts
/**
 * Schema.org JSON-LD 工厂函数集
 *
 * 所有页面通过 `useSiteSeo({ jsonLd: xxxLd(siteUrl) })` 注入。
 * 所有 helper 接受可选 `siteUrl` 参数，调用方从 `runtimeConfig.public.seo.siteUrl` 注入；
 * 单元测试与 SSR 场景可用默认值 `DEFAULT_SITE_URL`，避免"helper 字面量 + composable runtimeConfig"双轨。
 */

import type { JsonLdBlock } from '#shared/types/seo'

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
      '日期推算', '赔偿计算', '加班计算', '离婚财产分割', '社保追缴计算',
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

- [ ] **Step 4: 运行测试确认全部通过**

Run: `npx vitest run tests/shared/utils/seo/jsonLd.test.ts --reporter=verbose`
Expected: 6 个 describe / 7 个 it，全部 PASS

- [ ] **Step 5: Commit**

```bash
git add shared/utils/seo/jsonLd.ts tests/shared/utils/seo/jsonLd.test.ts
git commit -m "feat(seo): 新增 Schema.org JSON-LD 工厂函数与单测"
```

---

## Task 3: Sitemap nitro 路由（单文件）

**Files:**
- Create: `server/routes/sitemap.xml.ts`

> **设计说明**：spec 中 sitemap 实现合并在 `server/routes/sitemap.xml.ts` 单文件（数据列表 + XML 生成都在路由内）。不再拆 `shared/utils/seo/sitemap.ts` 纯函数 + 独立单测——7 条静态路径 + ~80 字符字符串拼接，拆文件价值低于复杂度。集成验证由 Task 15 中的 `curl /sitemap.xml + xmllint -noout` 覆盖。
>
> 前置依赖：Task 1 中 `SitemapEntry` 类型已在 `shared/types/seo.ts` 定义；Task 6 中 `runtimeConfig.public.seo.siteUrl` 已配置。本 Task 假定 Task 1 与 Task 6 已完成（实际执行顺序：1 → 6 → 3）。

- [ ] **Step 1: 创建 nitro 路由文件**

创建 `server/routes/sitemap.xml.ts`：

```ts
import type { SitemapEntry } from '#shared/types/seo'

const PUBLIC_PAGES: SitemapEntry[] = [
  { path: '/',                   priority: 1.0, changefreq: 'weekly'  },
  { path: '/features',           priority: 0.9, changefreq: 'monthly' },
  { path: '/pricing',            priority: 0.9, changefreq: 'monthly' },
  { path: '/about',              priority: 0.7, changefreq: 'monthly' },
  { path: '/privacy-agreement',  priority: 0.3, changefreq: 'yearly'  },
  { path: '/terms-of-use',       priority: 0.3, changefreq: 'yearly'  },
  { path: '/purchase-agreement', priority: 0.3, changefreq: 'yearly'  },
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

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'sitemap|seo' | head -20`
Expected: 输出为空（如果当前报错 `runtimeConfig.public.seo.siteUrl does not exist`，是预期——`runtimeConfig.public.seo` 字段在 Task 6 添加；按上面"前置依赖"提示，先执行 Task 1 → 6 → 3）

- [ ] **Step 3: 启动 dev 验证 XML 输出与公开页过滤**

Run（后台启动 dev）:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/sitemap.xml > /dev/null 2>&1 && break; sleep 1; done
echo '--- HTTP header ---' && curl -sI http://localhost:3000/sitemap.xml | head -5
echo '--- 公开页 URL 数 (期望 7) ---' && curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'
echo '--- 不含私密路径 (期望 0) ---' && curl -s http://localhost:3000/sitemap.xml | grep -cE '/login|/admin|/dashboard'
echo '--- XML 合法性 ---' && curl -s http://localhost:3000/sitemap.xml | xmllint --noout - && echo 'XML valid'
kill $NUXT_PID 2>/dev/null
```

Expected:
- HTTP header 含 `content-type: application/xml; charset=utf-8` 与 `cache-control: public, max-age=3600`
- 公开页 URL 数 = 7
- 私密路径数 = 0
- 输出 `XML valid`（xmllint 是 macOS 内置工具，CI 环境若无可用 `node -e "require('node:fs').readFileSync('/dev/stdin','utf8')"` 兜底）

- [ ] **Step 4: Commit**

```bash
git add server/routes/sitemap.xml.ts
git commit -m "feat(seo): 新增 sitemap.xml nitro 路由（单文件实现）"
```

---

## Task 4: useSiteSeo composable（TDD）

**Files:**
- Create: `tests/client/composables/useSiteSeo.test.ts`
- Create: `app/composables/useSiteSeo.ts`

- [ ] **Step 1: 先写失败测试**

创建 `tests/client/composables/useSiteSeo.test.ts`：

```ts
/**
 * useSiteSeo composable 测试
 *
 * 验证页面 SEO 元数据注入：title/description/canonical/OG/Twitter/JSON-LD/noindex
 *
 * **Feature: seo-optimization**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ========== mocks ==========

const useSeoMetaArgs: Array<Record<string, unknown>> = []
const useHeadArgs: Array<Record<string, unknown>> = []

vi.stubGlobal('useSeoMeta', (arg: Record<string, unknown>) => {
  useSeoMetaArgs.push(arg)
})
vi.stubGlobal('useHead', (arg: Record<string, unknown>) => {
  useHeadArgs.push(arg)
})
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { seo: { siteUrl: 'https://lexseek.cn' } },
}))

const { useSiteSeo } = await import('~/composables/useSiteSeo')

beforeEach(() => {
  useSeoMetaArgs.length = 0
  useHeadArgs.length = 0
})

// ========== tests ==========

describe('useSiteSeo - 基础', () => {
  it('注入 title / description / canonical 正确', () => {
    useSiteSeo({
      title: '产品功能',
      description: '产品功能描述',
      path: '/features',
    })

    expect(useSeoMetaArgs[0]).toMatchObject({
      title: '产品功能',
      description: '产品功能描述',
      ogTitle: '产品功能 | LexSeek 法索 AI',
      ogDescription: '产品功能描述',
      ogUrl: 'https://lexseek.cn/features',
      ogType: 'website',
      twitterTitle: '产品功能',
      twitterDescription: '产品功能描述',
      robots: 'index,follow',
    })

    const headLink = (useHeadArgs[0]!.link as Array<{ rel: string; href: string }>)[0]
    expect(headLink).toEqual({ rel: 'canonical', href: 'https://lexseek.cn/features' })
  })
})

describe('useSiteSeo - keywords', () => {
  it('数组 keywords 用逗号拼接', () => {
    useSiteSeo({
      title: 't',
      description: 'd',
      path: '/',
      keywords: ['法律AI', '律师AI', '案件分析'],
    })
    expect(useSeoMetaArgs[0]!.keywords).toBe('法律AI,律师AI,案件分析')
  })

  it('无 keywords 时 keywords 字段缺省', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/' })
    expect(useSeoMetaArgs[0]!.keywords).toBeUndefined()
  })
})

describe('useSiteSeo - ogImage', () => {
  it('相对路径会拼上 siteUrl', () => {
    useSiteSeo({
      title: 't', description: 'd', path: '/',
      ogImage: '/og/home.png',
    })
    expect(useSeoMetaArgs[0]!.ogImage).toBe('https://lexseek.cn/og/home.png')
  })

  it('http 开头的绝对 URL 不拼 siteUrl', () => {
    useSiteSeo({
      title: 't', description: 'd', path: '/',
      ogImage: 'https://cdn.example.com/og.png',
    })
    expect(useSeoMetaArgs[0]!.ogImage).toBe('https://cdn.example.com/og.png')
  })

  it('未传 ogImage 时默认 /og/default.png', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/' })
    expect(useSeoMetaArgs[0]!.ogImage).toBe('https://lexseek.cn/og/default.png')
  })
})

describe('useSiteSeo - JSON-LD', () => {
  it('单个 jsonLd 注入 1 个 script', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'X' } as const
    useSiteSeo({ title: 't', description: 'd', path: '/', jsonLd: ld })
    const scripts = useHeadArgs[0]!.script as Array<{ type: string; innerHTML: string }>
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.type).toBe('application/ld+json')
    const parsed = JSON.parse(scripts[0]!.innerHTML)
    expect(parsed).toEqual(ld)
  })

  it('数组 jsonLd 注入多个 script', () => {
    const a = { '@context': 'https://schema.org', '@type': 'Organization' } as const
    const b = { '@context': 'https://schema.org', '@type': 'WebSite' } as const
    useSiteSeo({ title: 't', description: 'd', path: '/', jsonLd: [a, b] })
    const scripts = useHeadArgs[0]!.script as Array<{ innerHTML: string }>
    expect(scripts).toHaveLength(2)
  })

  it('无 jsonLd 时 script 为空数组', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/' })
    const scripts = useHeadArgs[0]!.script as unknown[]
    expect(scripts).toEqual([])
  })

  it('JSON-LD 内容包含 `<` 时被转义为 \\u003c（防止打断 HTML）', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'Test', payload: '</script>' } as const
    useSiteSeo({ title: 't', description: 'd', path: '/', jsonLd: ld })
    const script = (useHeadArgs[0]!.script as Array<{ innerHTML: string }>)[0]!
    expect(script.innerHTML).not.toContain('</script>')
    expect(script.innerHTML).toContain('\\u003c/script>')
  })
})

describe('useSiteSeo - noindex', () => {
  it('noindex: true 时 robots = noindex,nofollow', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/login', noindex: true })
    expect(useSeoMetaArgs[0]!.robots).toBe('noindex,nofollow')
  })

  it('noindex: false 时 robots = index,follow', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/', noindex: false })
    expect(useSeoMetaArgs[0]!.robots).toBe('index,follow')
  })

  it('未传 noindex 时 robots = index,follow', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/' })
    expect(useSeoMetaArgs[0]!.robots).toBe('index,follow')
  })
})

describe('useSiteSeo - ogType', () => {
  it('未传 ogType 默认 website', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/' })
    expect(useSeoMetaArgs[0]!.ogType).toBe('website')
  })

  it('显式传 article', () => {
    useSiteSeo({ title: 't', description: 'd', path: '/', ogType: 'article' })
    expect(useSeoMetaArgs[0]!.ogType).toBe('article')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/client/composables/useSiteSeo.test.ts --reporter=verbose`
Expected: FAIL，"Cannot find module '~/composables/useSiteSeo'"

- [ ] **Step 3: 实现 `app/composables/useSiteSeo.ts`**

```ts
import type { SiteSeoOptions } from '#shared/types/seo'

/**
 * 页面 SEO 元数据一行注入入口
 *
 * 调用 `useSeoMeta` 注入 title/description/keywords/OG/Twitter/robots，
 * 调用 `useHead` 注入 canonical link 与 JSON-LD script。
 *
 * 所有 URL（canonical / og:url / og:image 的相对路径）基于
 * `runtimeConfig.public.seo.siteUrl`；不写死域名字面量到代码中。
 */
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

- [ ] **Step 4: 运行测试确认全部通过**

Run: `npx vitest run tests/client/composables/useSiteSeo.test.ts --reporter=verbose`
Expected: 6 个 describe / 12 个 it，全部 PASS（spec 测试表按"行为分类"列 8 项，本 plan 展开为更细的子断言，行为覆盖一致）

- [ ] **Step 5: Commit**

```bash
git add app/composables/useSiteSeo.ts tests/client/composables/useSiteSeo.test.ts
git commit -m "feat(seo): 新增 useSiteSeo composable 与单测"
```

---

## Task 5: 静态资源 — robots.txt / site.webmanifest / 5 张 OG 占位图

**Files:**
- Modify: `public/robots.txt`
- Create: `public/site.webmanifest`
- Create: `public/og/default.png` + `home.png` + `features.png` + `pricing.png` + `about.png`（共 5 张，1200×630）
- Read: `public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt`（仅核对来源，不修改）

- [ ] **Step 0: 核对 `public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt` 来源**

Run:

```bash
ls -lh public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt public/MP_verify_l7bw3QUad79dIxSb.txt 2>/dev/null
echo '--- 文件名格式分析 ---'
echo 'e87c938a6d6ecef4ec5beca2b0e1ffc1: 32 位 hex → 符合百度站长校验文件命名格式（百度签发 <32hex>.txt 或 .html）'
echo 'MP_verify_xxx: 微信公众平台域名校验文件（与 SEO 无关，但用于公众号 / 小程序 H5 域名校验，保留不动）'
echo '--- 文件内容（如不大可看） ---'
head -3 public/e87c938a6d6ecef4ec5beca2b0e1ffc1.txt 2>/dev/null || echo '(空 / 二进制)'
```

Expected: 输出文件存在 + 大小 + 文件名格式分析说明。**结论**：两个文件均保留不动，e87c938 大概率是旧站百度站长校验文件（运维若能 100% 确认更好；不确认也不删，零成本保留）。

- [ ] **Step 1: 重写 `public/robots.txt`**

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

- [ ] **Step 2: 创建 `public/site.webmanifest`**

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

- [ ] **Step 3: 批量生成 5 张 OG 占位图（1200×630，同模板、不同副标题）**

Run（项目已安装 `sharp`）:

```bash
mkdir -p public/og && npx tsx -e "
import sharp from 'sharp';

const variants = [
  { file: 'default.png',  subtitle: '律师专属 AI 案件分析与诉讼辅助平台' },
  { file: 'home.png',     subtitle: '法律 AI 案件分析平台' },
  { file: 'features.png', subtitle: '全方位法律分析工具' },
  { file: 'pricing.png',  subtitle: '灵活会员订阅 ¥9.9 起' },
  { file: 'about.png',    subtitle: '用 AI 重塑法律服务' },
];

for (const v of variants) {
  const svg = Buffer.from(\`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630'>
    <defs>
      <linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>
        <stop offset='0%' stop-color='#171717'/>
        <stop offset='100%' stop-color='#2d2d2d'/>
      </linearGradient>
    </defs>
    <rect width='1200' height='630' fill='url(#g)'/>
    <text x='600' y='280' fill='#ffffff' font-size='120' font-weight='700' font-family='-apple-system,system-ui,sans-serif' text-anchor='middle'>LexSeek</text>
    <text x='600' y='360' fill='#a1a1aa' font-size='44' font-family='-apple-system,system-ui,sans-serif' text-anchor='middle'>法索 AI</text>
    <text x='600' y='460' fill='#d4d4d8' font-size='36' font-family='-apple-system,system-ui,sans-serif' text-anchor='middle'>\${v.subtitle}</text>
  </svg>\`);
  await sharp(svg).png().toFile(\`public/og/\${v.file}\`);
}

console.log('Generated 5 OG images in public/og/');
for (const v of variants) {
  const meta = await sharp(\`public/og/\${v.file}\`).metadata();
  console.log(\`  \${v.file}: \${meta.width}x\${meta.height} \${meta.format}\`);
}
"
```

Expected: 输出 `Generated 5 OG images in public/og/`，5 个文件均为 `1200x630 png`

- [ ] **Step 4: 验证文件大小合理（每张 <100KB）**

Run: `ls -lh public/og/*.png public/site.webmanifest public/robots.txt`
Expected: 5 张 PNG 各 10–60KB 范围；webmanifest / robots.txt 各 <2KB

- [ ] **Step 5: Commit**

```bash
git add public/robots.txt public/site.webmanifest public/og/
git commit -m "feat(seo): 重写 robots.txt + 新增 site.webmanifest 与 5 张 OG 占位图"
```

---

## Task 6: nuxt.config.ts + .env.example 全局配置

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: 在 `nuxt.config.ts` 中扩展 `app.head`**

定位现有 `app: { head: { ... } }` 块（约 41–64 行），完整替换为：

```ts
  app: {
    head: {
      htmlAttrs: {
        lang: 'zh-CN',
        // 服务端默认渲染 light 主题，客户端脚本会立即修正
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
        // OG / Twitter 默认值（页面层 useSiteSeo 会覆盖）
        { property: 'og:site_name', content: 'LexSeek 法索 AI' },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'zh_CN' },
        { property: 'og:image', content: 'https://lexseek.cn/og/default.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      // 内联样式：在任何 CSS 加载前隐藏页面，防止主题闪烁
      style: [
        {
          innerHTML: 'html:not(.theme-ready){background:#fff}html.dark:not(.theme-ready){background:#171717}',
          tagPosition: 'head'
        }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
        { rel: 'apple-touch-icon', href: '/pwa-192x192.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
      // 内联脚本：在页面渲染前应用颜色模式，避免闪烁
      script: [
        {
          innerHTML: `(function(){try{var s=localStorage.getItem('color-mode');var m=s&&['light','dark','system'].includes(s)?s:'light';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);var t=localStorage.getItem('theme-color');if(t&&t!=='zinc')document.documentElement.classList.add('theme-'+t);document.documentElement.classList.add('theme-ready')}catch(e){document.documentElement.classList.add('theme-ready')}})()`,
          tagPosition: 'head'
        }
      ]
    }
  },
```

- [ ] **Step 2: 在 `nuxt.config.ts` 中扩展 `runtimeConfig.public`**

定位现有 `runtimeConfig: { public: { ... } }`（约 175 行），在 `public` 对象内紧接 `logLevel` / `baseUrl` 这些已有字段后**追加**：

```ts
      // SEO 站长验证与站点 URL（线上由环境变量灌入，开发本地留空）
      seo: {
        siteUrl: 'https://lexseek.cn',
        baiduVerify: '',
        googleVerify: '',
        bingVerify: '',
        sogouVerify: '',
        so360Verify: '',
      },
```

- [ ] **Step 3: 在 `.env.example` 末尾追加 SEO 段**

读取现有 `.env.example` 末尾，确认没有 SEO 段，然后在文件末尾追加：

```bash

# ==================== SEO 站长验证 ====================
# 站点根 URL（线上必须；开发本地可不填，回退 nuxt.config 默认值）
NUXT_PUBLIC_SEO_SITE_URL=https://lexseek.cn
# 百度站长平台验证字符串（如 codeva-xxxxxxxx），从 https://ziyuan.baidu.com 申请
# 旧站 lexseek_web 已申请过的参考值：codeva-SODQaUizoh — 若主域名沿用 lexseek.cn 可复用
NUXT_PUBLIC_SEO_BAIDU_VERIFY=
# Google Search Console 验证字符串，从 https://search.google.com/search-console 申请
NUXT_PUBLIC_SEO_GOOGLE_VERIFY=
# Bing Webmaster 验证字符串，从 https://www.bing.com/webmasters 申请
NUXT_PUBLIC_SEO_BING_VERIFY=
# 搜狗站长验证字符串，从 https://zhanzhang.sogou.com 申请
NUXT_PUBLIC_SEO_SOGOU_VERIFY=
# 360 搜索站长验证字符串，从 https://zhanzhang.so.com 申请
NUXT_PUBLIC_SEO_360_VERIFY=
```

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS' | head -20`
Expected: 输出为空（无类型错误）

- [ ] **Step 5: 启动 dev 并 curl sitemap 与 robots 验证**

Run（后台启动 dev，等启动成功）:

```bash
# 启动 dev
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
# 等待启动（最多 30s）
for i in $(seq 1 30); do
  curl -s http://localhost:3000/robots.txt > /dev/null 2>&1 && break
  sleep 1
done
# 验证
echo '--- robots.txt ---' && curl -s http://localhost:3000/robots.txt
echo '--- sitemap.xml ---' && curl -s http://localhost:3000/sitemap.xml | head -30
echo '--- 首页 head ---' && curl -s http://localhost:3000/ | grep -E 'titleTemplate|og:site_name|theme-color|manifest' | head -10
# 停止 dev
kill $NUXT_PID 2>/dev/null
```

Expected:
- `robots.txt` 含 Disallow + Sitemap 行
- `sitemap.xml` 是合法 XML，含 7 个 `<url>` 节点，每个 `<loc>` 是 `https://lexseek.cn/xxx`
- 首页 HTML 含 `og:site_name`、`theme-color`、`manifest` 链接

- [ ] **Step 6: Commit**

```bash
git add nuxt.config.ts .env.example
git commit -m "feat(seo): 扩展 nuxt.config 全局 head 与 runtimeConfig.public.seo"
```

---

## Task 7: app.vue 全局注入站长 meta 与 Organization/WebSite JSON-LD

**Files:**
- Modify: `app/app.vue`

- [ ] **Step 1: 在 `app/app.vue` 的 `<script setup>` 顶部追加**

定位现有 `<script setup lang="ts">` 块内已有 import 之后（约 13–23 行），追加：

```ts
import { organizationLd, websiteLd } from '#shared/utils/seo/jsonLd'
```

紧接 import 块后（在现有 `const authStore = useAuthStore()` 之前），追加：

```ts
// 全局 SEO：站长验证 meta + Organization / WebSite JSON-LD
// 把 `seo.siteUrl` 显式传给 helper，消除 helper 默认值与 runtimeConfig 的双轨。
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
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(organizationLd(seo.siteUrl)).replace(/</g, '\\u003c'),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(websiteLd(seo.siteUrl)).replace(/</g, '\\u003c'),
    },
  ],
})
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS' | head -20`
Expected: 输出为空

- [ ] **Step 3: dev 启动并验证全局 JSON-LD 出现在 SSR 渲染中**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/ > /dev/null 2>&1 && break; sleep 1; done
echo '--- Organization JSON-LD ---'
curl -s http://localhost:3000/ | grep -A 1 'application/ld+json' | head -10
kill $NUXT_PID 2>/dev/null
```

Expected: HTML 输出含 2 个 `<script type="application/ld+json">`，第一个解析后 `@type === 'Organization'`，第二个 `@type === 'WebSite'`

- [ ] **Step 4: Commit**

```bash
git add app/app.vue
git commit -m "feat(seo): app.vue 全局注入站长验证 meta 与 Organization/WebSite JSON-LD"
```

---

## Task 8: 4 个私密 Layout 注入 noindex

**Files:**
- Modify: `app/layouts/dashboardLayout.vue`
- Modify: `app/layouts/admin-layout.vue`
- Modify: `app/layouts/membershipLayout.vue`
- Modify: `app/layouts/settingsLayout.vue`

- [ ] **Step 1: 在 4 个 layout 的 `<script setup>` 首行各追加**

每个文件的 `<script setup lang="ts">`（或 `<script setup>`）开头，紧接其他 import 之前或 import 之后第一个非 import 语句之前，加入：

```ts
// 私密区域，禁止搜索引擎索引
useHead({
  meta: [{ name: 'robots', content: 'noindex,nofollow' }]
})
```

具体改动 4 个文件，路径分别为：
- `app/layouts/dashboardLayout.vue`
- `app/layouts/admin-layout.vue`
- `app/layouts/membershipLayout.vue`
- `app/layouts/settingsLayout.vue`

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS' | head -20`
Expected: 输出为空

- [ ] **Step 3: dev 启动并验证 dashboard / admin 页面含 noindex**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/ > /dev/null 2>&1 && break; sleep 1; done
echo '--- /dashboard noindex ---'
curl -s http://localhost:3000/dashboard | grep 'name="robots"' | head -2
echo '--- /admin noindex ---'
curl -s http://localhost:3000/admin | grep 'name="robots"' | head -2
echo '--- /dashboard/settings/profile noindex ---'
curl -s http://localhost:3000/dashboard/settings/profile | grep 'name="robots"' | head -2
kill $NUXT_PID 2>/dev/null
```

Expected: 3 个 URL 各返回至少一个 `<meta name="robots" content="noindex,nofollow">`（未登录态会被重定向到 login，但 HTML head 在重定向前应仍含 noindex；如未登录走 302 重定向、curl 跟不到 layout HTML，至少 `/dashboard` 路径能返回 noindex 即可，登录态由 chrome-devtools 阶段二次验证）

- [ ] **Step 4: Commit**

```bash
git add app/layouts/dashboardLayout.vue app/layouts/admin-layout.vue app/layouts/membershipLayout.vue app/layouts/settingsLayout.vue
git commit -m "feat(seo): 4 私密 layout 注入 noindex robots meta"
```

---

## Task 9: 首页 `/` SEO 集成

**Files:**
- Modify: `app/pages/index.vue`

- [ ] **Step 1: 在 `app/pages/index.vue` 的 `<script setup lang="ts">` 顶部追加 import**

定位现有 import 块（约 312–325 行），追加：

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { softwareApplicationLd } from '#shared/utils/seo/jsonLd'
```

- [ ] **Step 2: 在 import 后紧接 `definePageMeta(...)` 之前追加 useSiteSeo 调用**

```ts
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

> 现有 `definePageMeta({ layout: "base-layout", title: "首页" })` 保留不动 — `layout` 字段仍然需要；`title` 字段保留向后兼容，但实际 SEO title 由 useSiteSeo 控制。description 含 lexseek_web slogan "告别低效梳理，专注精准判断"。

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|index.vue' | head -20`
Expected: 输出为空

- [ ] **Step 4: dev 启动并 curl 首页验证**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/ > /dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:3000/ | grep -E '<title>|name="description"|name="keywords"|property="og:url"|rel="canonical"|WebApplication' | head -10
kill $NUXT_PID 2>/dev/null
```

Expected:
- `<title>法律 AI 案件分析平台 - 律师专属 AI 工作台 | LexSeek 法索 AI</title>`
- `<meta name="description" content="法索 AI（LexSeek）...">` 含首页 description
- `<meta name="keywords" content="法律AI,律师AI助手,...">`
- `<link rel="canonical" href="https://lexseek.cn/">`
- HTML 含 `"@type":"WebApplication"` 字符串

- [ ] **Step 5: Commit**

```bash
git add app/pages/index.vue
git commit -m "feat(seo): 首页接入 useSiteSeo 与 WebApplication JSON-LD"
```

---

## Task 10: 产品功能 `/features` SEO 集成

**Files:**
- Modify: `app/pages/features.vue`

- [ ] **Step 1: 在 `app/pages/features.vue` 的 `<script setup lang="ts">` 顶部追加 import**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd, itemListLd } from '#shared/utils/seo/jsonLd'
```

- [ ] **Step 2: 在 `definePageMeta(...)` 之前追加 useSiteSeo 调用**

```ts
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

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|features.vue' | head -20`
Expected: 输出为空

- [ ] **Step 4: dev 启动并 curl 验证**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/features > /dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:3000/features | grep -E '<title>|BreadcrumbList|ItemList|rel="canonical"' | head -5
kill $NUXT_PID 2>/dev/null
```

Expected:
- `<title>` 含 "产品功能"
- HTML 含 `"@type":"BreadcrumbList"` 和 `"@type":"ItemList"`
- canonical 指向 `/features`

- [ ] **Step 5: Commit**

```bash
git add app/pages/features.vue
git commit -m "feat(seo): features 页接入 useSiteSeo 与 Breadcrumb/ItemList JSON-LD"
```

---

## Task 11: 价格方案 `/pricing` SEO 集成

**Files:**
- Modify: `app/pages/pricing.vue`

- [ ] **Step 1: 在 `app/pages/pricing.vue` 的 `<script setup>` 顶部追加 import**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd, faqLd } from '#shared/utils/seo/jsonLd'
```

- [ ] **Step 2: 在 `definePageMeta(...)` 之前追加 useSiteSeo 调用**

```ts
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

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|pricing.vue' | head -20`
Expected: 输出为空

- [ ] **Step 4: dev 启动并 curl 验证**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/pricing > /dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:3000/pricing | grep -E '<title>|FAQPage|AggregateOffer|rel="canonical"' | head -5
kill $NUXT_PID 2>/dev/null
```

Expected: HTML 含 `"@type":"FAQPage"`、`"@type":"AggregateOffer"`，canonical 指向 `/pricing`

- [ ] **Step 5: Commit**

```bash
git add app/pages/pricing.vue
git commit -m "feat(seo): pricing 页接入 useSiteSeo 与 Breadcrumb/Product/FAQPage JSON-LD"
```

---

## Task 12: 关于我们 `/about` SEO 集成

**Files:**
- Modify: `app/pages/about.vue`

- [ ] **Step 1: 在 `app/pages/about.vue` 的 `<script setup lang="ts">` 顶部追加 import**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
import { breadcrumbLd } from '#shared/utils/seo/jsonLd'
```

- [ ] **Step 2: 在 `definePageMeta(...)` 之前追加 useSiteSeo 调用**

```ts
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

> 不再使用 `aboutPageLd()`（已从 helper 集中删除）。`AboutPage` 类型 Google 不展示富结果，且与全局 Organization JSON-LD 信息重复。`/about` 仅保留 `BreadcrumbList`。

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|about.vue' | head -20`
Expected: 输出为空

- [ ] **Step 4: dev 启动并 curl 验证**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/about > /dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:3000/about | grep -E '<title>|BreadcrumbList|rel="canonical"' | head -5
kill $NUXT_PID 2>/dev/null
```

Expected: HTML 含 `"@type":"BreadcrumbList"`，canonical 指向 `/about`，且**不**包含 `"@type":"AboutPage"`

- [ ] **Step 5: Commit**

```bash
git add app/pages/about.vue
git commit -m "feat(seo): about 页接入 useSiteSeo 与 BreadcrumbList JSON-LD"
```

---

## Task 13: 三个协议页（privacy / terms / purchase）最小 SEO

**Files:**
- Modify: `app/pages/privacy-agreement.vue`
- Modify: `app/pages/terms-of-use.vue`
- Modify: `app/pages/purchase-agreement.vue`

- [ ] **Step 1: 在 `privacy-agreement.vue` 的 `<script setup>` 中追加**

import 块（已有部分）后追加：

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

`definePageMeta(...)` 之前追加：

```ts
useSiteSeo({
  title: '隐私政策',
  description: 'LexSeek 法索 AI 隐私政策，详细说明我们如何收集、使用、存储和保护您的个人信息。',
  path: '/privacy-agreement',
})
```

- [ ] **Step 2: 在 `terms-of-use.vue` 的 `<script setup>` 中追加**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

```ts
useSiteSeo({
  title: '使用条款',
  description: 'LexSeek 法索 AI 使用条款，明确平台服务范围、用户权利义务及相关法律约定。',
  path: '/terms-of-use',
})
```

- [ ] **Step 3: 在 `purchase-agreement.vue` 的 `<script setup>` 中追加**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

```ts
useSiteSeo({
  title: '购买协议',
  description: 'LexSeek 法索 AI 会员服务购买协议，包含订阅服务、计费、退款等相关条款。',
  path: '/purchase-agreement',
})
```

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|agreement.vue|terms-of-use.vue' | head -20`
Expected: 输出为空

- [ ] **Step 5: dev 启动并 curl 验证**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/privacy-agreement > /dev/null 2>&1 && break; sleep 1; done
for path in '/privacy-agreement' '/terms-of-use' '/purchase-agreement'; do
  echo "--- $path ---"
  curl -s "http://localhost:3000$path" | grep -E '<title>|rel="canonical"' | head -3
done
kill $NUXT_PID 2>/dev/null
```

Expected: 3 个页面各自 `<title>` 与 canonical 正确

- [ ] **Step 6: Commit**

```bash
git add app/pages/privacy-agreement.vue app/pages/terms-of-use.vue app/pages/purchase-agreement.vue
git commit -m "feat(seo): 3 个协议页接入 useSiteSeo 最小 meta"
```

---

## Task 14: 5 个公开但 noindex 页（login / register / reset-password / landing / 403）

**Files:**
- Modify: `app/pages/login.vue`
- Modify: `app/pages/register.vue`
- Modify: `app/pages/reset-password.vue`
- Modify: `app/pages/landing/[invitedBy].vue`
- Modify: `app/pages/403.vue`

- [ ] **Step 1: `login.vue` 追加 import + useSiteSeo**

import 块尾部追加：

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

`definePageMeta(...)` 之前追加：

```ts
useSiteSeo({
  title: '登录',
  description: '登录您的 LexSeek 法索 AI 账号。',
  path: '/login',
  noindex: true,
})
```

- [ ] **Step 2: `register.vue` 追加**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

```ts
useSiteSeo({
  title: '注册',
  description: '注册 LexSeek 法索 AI 账号，立即体验律师专属 AI 工作台。',
  path: '/register',
  noindex: true,
})
```

- [ ] **Step 3: `reset-password.vue` 追加**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

```ts
useSiteSeo({
  title: '重置密码',
  description: '重置您的 LexSeek 法索 AI 账号密码。',
  path: '/reset-password',
  noindex: true,
})
```

- [ ] **Step 4: `landing/[invitedBy].vue` 追加**

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

```ts
useSiteSeo({
  title: '专属邀请',
  description: '通过专属邀请注册 LexSeek 法索 AI，获得新用户专享福利。',
  path: '/landing',
  noindex: true,
})
```

> path 用 `/landing` 而非 `/landing/${invitedBy}` 是为避免每个邀请码生成不同 canonical 导致 SEO 碎片化；noindex 已保证不被收录，canonical 仅作规范化兜底。

- [ ] **Step 5: `403.vue` 追加**

读取现有 `<script setup>` 块（约 1–10 行），在 import 后追加：

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

`definePageMeta(...)` 之前追加：

```ts
useSiteSeo({
  title: '无权限访问',
  description: '您没有权限访问此页面。',
  path: '/403',
  noindex: true,
})
```

- [ ] **Step 6: 统一 `app/pages/dashboard/legal/index.vue` 已有的 useSeoMeta 直调**

该页位于 dashboardLayout 下（Task 8 已注入 noindex 兜底），但代码里直接调用了 `useSeoMeta({ title, description })`，与 spec 不变量"业务页面 SEO 元数据只通过 useSiteSeo 一行调用"冲突。改写为统一入口：

读取 `app/pages/dashboard/legal/index.vue:160` 附近的现有 `useSeoMeta(...)` 调用，找到当前 title / description 文案，然后：

1. 在 `<script setup>` import 块尾部追加（如未导入）：

```ts
import { useSiteSeo } from '~/composables/useSiteSeo'
```

2. 把现有 `useSeoMeta({ title: 'xxx', description: 'yyy' })` 整体替换为：

```ts
useSiteSeo({
  title: 'xxx',                  // 沿用原 title 文案
  description: 'yyy',            // 沿用原 description 文案
  path: '/dashboard/legal',
  noindex: true,                  // 私密 dashboard 子页
})
```

> 文案保持不变 —— 仅替换调用入口。`noindex: true` 与 layout 级 noindex **并存不冲突**（同 name meta 多次注入，Unhead 自动去重；显式 noindex 增加安全冗余）。

- [ ] **Step 7: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'error TS|login.vue|register.vue|reset-password.vue|landing|403.vue|dashboard/legal' | head -20`
Expected: 输出为空

- [ ] **Step 8: dev 启动并 curl 验证 5 公开 noindex 页**

Run:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
NUXT_PID=$!
for i in $(seq 1 30); do curl -s http://localhost:3000/login > /dev/null 2>&1 && break; sleep 1; done
for path in '/login' '/register' '/reset-password' '/landing/test123' '/403'; do
  echo "--- $path ---"
  curl -s "http://localhost:3000$path" | grep -E 'name="robots"' | head -2
done
kill $NUXT_PID 2>/dev/null
```

Expected: 5 个公开 noindex 页面均含 `<meta name="robots" content="noindex,nofollow">`；`dashboard/legal` 因为登录态保护无法 curl 验证，留到 Task 15 chrome-devtools 登录态验证

- [ ] **Step 9: Commit**

```bash
git add app/pages/login.vue app/pages/register.vue app/pages/reset-password.vue 'app/pages/landing/[invitedBy].vue' app/pages/403.vue app/pages/dashboard/legal/index.vue
git commit -m "feat(seo): 5 公开敏感页 + dashboard/legal 统一接入 useSiteSeo 与 noindex"
```

---

## Task 15: 集成验证（单测全量 + 浏览器手动验收）

**Files:** （只读，不修改）

- [ ] **Step 1: 跑 SEO 相关单测全部通过**

Run:

```bash
npx vitest run tests/shared/utils/seo/ tests/client/composables/useSiteSeo.test.ts --reporter=verbose
```

Expected: 3 个测试文件全部 PASS（jsonLd / sitemap / useSiteSeo），合计 20+ 个 it 用例

- [ ] **Step 2: 全量类型检查**

Run: `npx nuxi typecheck 2>&1 | tail -30`
Expected: 末尾输出 `0 errors` 或同等表达，整个项目无类型错误

- [ ] **Step 3: dev 启动后用 chrome-devtools 验证关键页**

Run（后台启动 dev）:

```bash
NUXT_HOST=0.0.0.0 npx nuxt dev > /tmp/nuxt-dev.log 2>&1 &
echo $! > /tmp/nuxt-dev.pid
for i in $(seq 1 30); do curl -s http://localhost:3000/ > /dev/null 2>&1 && break; sleep 1; done
echo "dev ready on http://localhost:3000"
```

然后用 chrome-devtools MCP 依次访问以下 URL，每个都打开开发者工具看 head：

| URL | 验证 |
|---|---|
| `http://localhost:3000/` | title / description（含 slogan 「告别低效梳理，专注精准判断」）/ keywords / canonical / OG / WebApplication JSON-LD / Organization JSON-LD / WebSite JSON-LD |
| `http://localhost:3000/features` | BreadcrumbList + ItemList JSON-LD |
| `http://localhost:3000/pricing` | BreadcrumbList + Product/AggregateOffer + FAQPage JSON-LD |
| `http://localhost:3000/about` | BreadcrumbList JSON-LD（不含 AboutPage） |
| `http://localhost:3000/login` | `<meta name="robots" content="noindex,nofollow">` |
| `http://localhost:3000/dashboard/legal`（**登录态**） | `<meta name="robots" content="noindex,nofollow">` 至少出现 1 次 |
| `http://localhost:3000/sitemap.xml` | 浏览器渲染 XML，7 条 URL，无私密路径 |
| `http://localhost:3000/robots.txt` | 文本，Disallow 列表（带尾 /）+ Sitemap 行 |
| `http://localhost:3000/site.webmanifest` | JSON，含 LexSeek 名称与 PWA 图标 |

- [ ] **Step 4: dev 关闭**

Run:

```bash
kill $(cat /tmp/nuxt-dev.pid) 2>/dev/null && rm /tmp/nuxt-dev.pid
```

- [ ] **Step 5: 验证 git 提交链**

Run: `git log --oneline -20`
Expected: 看到约 14 条 SEO 相关 commit（Task 1–14 各 1 条；如有合并按实际数量），消息全部 `feat(seo): ...` 形式

- [ ] **Step 6: 最终 Commit（如果 Step 1–5 发现遗漏需修补）**

如果发现任何小问题修复后：

```bash
git add -A <修改的文件>
git commit -m "fix(seo): 集成验证修复 - <具体描述>"
```

如果集成验证零问题，**本 Task 无需 commit**。

---

## Self-Review

### Spec Coverage 检查

Spec 中的每条要求映射到 task：

| Spec 内容 | 实现 Task |
|---|---|
| `shared/types/seo.ts`（SiteSeoOptions / JsonLdBlock / SitemapEntry） | Task 1 |
| `shared/utils/seo/jsonLd.ts`（6 个工厂函数；删除 aboutPageLd） | Task 2 |
| `server/routes/sitemap.xml.ts`（单文件，合并 PUBLIC_PAGES + XML 生成） | Task 3 |
| `app/composables/useSiteSeo.ts` + 测试 | Task 4 |
| `public/robots.txt` 重写（Disallow 加尾 /） | Task 5 |
| `public/site.webmanifest` 新建 | Task 5 |
| `public/og/*.png` 5 张占位 | Task 5 |
| `public/e87c938...txt` 来源核对（百度站长格式判断） | Task 5 Step 0 |
| `nuxt.config.ts` 全局 head（删 mobile-app 三联与 twitter:site）+ runtimeConfig.public.seo | Task 6 |
| `.env.example` 追加 SEO 变量（含旧站百度 verify 参考） | Task 6 |
| `app/app.vue` 站长 meta + 全局 JSON-LD（传 seo.siteUrl） | Task 7 |
| 4 个私密 layout noindex | Task 8 |
| 首页 SEO + WebApplication JSON-LD + slogan 融入 description | Task 9 |
| features 页 SEO + BreadcrumbList + ItemList | Task 10 |
| pricing 页 SEO + Breadcrumb + Product + FAQPage | Task 11 |
| about 页 SEO + Breadcrumb（不含 AboutPage） | Task 12 |
| 3 个协议页最小 SEO | Task 13 |
| 5 个 noindex 公开页 + dashboard/legal/index.vue 统一 useSiteSeo | Task 14 |
| `.claude/rules/git.md` 追加 `seo` scope 白名单 | Pre-conditions（已完成） |
| 集成验证 | Task 15 |

无遗漏。

### Placeholder Scan

- 无 "TBD" / "TODO" / "implement later"
- 所有 code block 包含完整代码
- 所有 Run 命令含预期输出

### Type Consistency

- [x] `SiteSeoOptions`（Task 1）→ `useSiteSeo(opt: SiteSeoOptions)`（Task 4）一致
- [x] `JsonLdBlock`（Task 1）→ helper 返回类型（Task 2）一致
- [x] `SitemapEntry`（Task 1）→ `server/routes/sitemap.xml.ts` 的 `PUBLIC_PAGES` 数组（Task 3）一致
- [x] helper 函数名 `organizationLd / websiteLd / softwareApplicationLd / breadcrumbLd / faqLd / itemListLd`（Task 2）→ 各页面 import（Task 7、9–12）一致
- [x] helper 可选 `siteUrl` 参数（Task 2 实现）→ Task 7 `app.vue` 传入 / Task 10–12 页面传入 对齐
- [x] `runtimeConfig.public.seo` 字段名（Task 6）→ `useSiteSeo` / `sitemap.xml.ts` / `app.vue` / 各页面使用（Task 3、4、7、9–12）一致
- [x] `WebApplication` `@type` 与 `browserRequirements`（Task 2 实现）→ Task 9 dev 验证命令 grep `WebApplication`、Task 15 chrome-devtools 验证表 对齐

无不一致。

---

## 风险与回退

- **风险**：Task 6 改完 `nuxt.config.ts` 后 `npx nuxi typecheck` 可能因 `runtimeConfig` 类型推导滞后报错；解决：先跑 `npx nuxi prepare`（postinstall 自动跑过；如果项目状态干净可忽略），让 Nuxt 重新生成类型。
- **风险**：Task 8 的 4 个 layout 同时改可能引入冲突；如果某个 layout 已存在 `useHead` 调用，需将 noindex meta 合并到现有调用中（而非新增 useHead）。实施时各 layout 单独 review。
- **回退路径**：每个 Task 都是独立 commit，逐个 revert 即可；最坏情况下 `git revert <range>` 回到当前 main 状态，业务零影响。
