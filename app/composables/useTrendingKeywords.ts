import { ref } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'

const FALLBACK_KEYWORDS = [
    '中华人民共和国民法典',
    '劳动合同法',
    '公司法',
    '工程施工',
    '招标投标法',
] as const

const MAX_COUNT = 5

interface TrendingApiResponse {
    items: { keyword: string; count: number }[]
}

export function useTrendingKeywords() {
    const keywords = ref<string[]>([])
    const loading = ref(false)

    /** 拉取指定 scope 的热搜词，不足 5 条时用 FALLBACK 去重补齐 */
    async function load(scope: 'legal' | 'article') {
        loading.value = true
        try {
            const data = await useApiFetch<TrendingApiResponse>(
                '/api/v1/legal/trending-keywords',
                { query: { scope } },
            )
            const dynamic = data?.items?.map(i => i.keyword) ?? []
            const merged: string[] = []
            for (const kw of [...dynamic, ...FALLBACK_KEYWORDS]) {
                if (!merged.includes(kw)) merged.push(kw)
                if (merged.length >= MAX_COUNT) break
            }
            keywords.value = merged
        } finally {
            loading.value = false
        }
    }

    return { keywords, loading, load }
}
