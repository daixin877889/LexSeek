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
