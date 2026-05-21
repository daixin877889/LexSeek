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
