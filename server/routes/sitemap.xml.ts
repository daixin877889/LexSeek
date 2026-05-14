import type { SitemapEntry } from '#shared/types/seo'

const PUBLIC_PAGES: SitemapEntry[] = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/features', priority: 0.9, changefreq: 'monthly' },
  { path: '/pricing', priority: 0.9, changefreq: 'monthly' },
  { path: '/about', priority: 0.7, changefreq: 'monthly' },
  { path: '/privacy-agreement', priority: 0.3, changefreq: 'yearly' },
  { path: '/terms-of-use', priority: 0.3, changefreq: 'yearly' },
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
