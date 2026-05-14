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
