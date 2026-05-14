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

const mockRuntimeConfig = () => ({
  public: { seo: { siteUrl: 'https://lexseek.cn' } },
})

// 覆盖 useRuntimeConfig（从 nuxt/app 和 #app/nuxt 解析）
vi.mock('nuxt/app', () => ({
  useRuntimeConfig: mockRuntimeConfig,
}))

vi.mock('#app/nuxt', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    useRuntimeConfig: mockRuntimeConfig,
  }
})

// 覆盖 useSeoMeta / useHead（从 #app/composables/head 解析）
vi.mock('#app/composables/head', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    useSeoMeta: (arg: Record<string, unknown>) => useSeoMetaArgs.push(arg),
    useHead: (arg: Record<string, unknown>) => useHeadArgs.push(arg),
  }
})

// stubGlobal 作为兜底，保证在不同 Nuxt 内部解析路径下也能被捕获
vi.stubGlobal('useSeoMeta', (arg: Record<string, unknown>) => {
  useSeoMetaArgs.push(arg)
})
vi.stubGlobal('useHead', (arg: Record<string, unknown>) => {
  useHeadArgs.push(arg)
})
vi.stubGlobal('useRuntimeConfig', mockRuntimeConfig)

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
