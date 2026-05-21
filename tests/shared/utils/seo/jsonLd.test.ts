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
    expect(ld['@type']).toBe('WebApplication')
    expect(ld.applicationCategory).toBe('BusinessApplication')
    expect(ld.browserRequirements).toContain('JavaScript')
    expect(ld.operatingSystem).toBeUndefined()
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
