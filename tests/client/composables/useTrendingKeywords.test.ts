/**
 * useTrendingKeywords composable 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: any[]) => apiFetch(...args),
}))

import { useTrendingKeywords } from '~/composables/useTrendingKeywords'

beforeEach(() => {
    apiFetch.mockReset()
})

describe('useTrendingKeywords', () => {
    it('成功返回 < 5 条时用兜底词补齐到 5 个，去重保序', async () => {
        apiFetch.mockResolvedValueOnce({
            items: [
                { keyword: '建设工程', count: 9 },
                { keyword: '中华人民共和国民法典', count: 7 }, // 与兜底词重复
            ],
        })

        const { keywords, load } = useTrendingKeywords()
        await load('legal')
        expect(keywords.value).toEqual([
            '建设工程',
            '中华人民共和国民法典',
            '劳动合同法',
            '公司法',
            '工程施工',
        ])
    })

    it('返回空数组时完全使用兜底词', async () => {
        apiFetch.mockResolvedValueOnce({ items: [] })
        const { keywords, load } = useTrendingKeywords()
        await load('article')
        expect(keywords.value).toEqual([
            '中华人民共和国民法典',
            '劳动合同法',
            '公司法',
            '工程施工',
            '招标投标法',
        ])
    })

    it('接口报错时也用兜底词', async () => {
        apiFetch.mockResolvedValueOnce(null) // useApiFetch 失败时返回 null
        const { keywords, load } = useTrendingKeywords()
        await load('legal')
        expect(keywords.value).toHaveLength(5)
    })

    it('传入的 scope 透传给接口 query', async () => {
        apiFetch.mockResolvedValueOnce({ items: [] })
        const { load } = useTrendingKeywords()
        await load('article')
        expect(apiFetch).toHaveBeenCalledWith('/api/v1/legal/trending-keywords', {
            query: { scope: 'article' },
        })
    })
})
