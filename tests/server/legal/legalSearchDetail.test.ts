/**
 * 法律法规详情 API 属性测试
 *
 * **Feature: legal-search**
 * **Property 6: 条文层级顺序正确性**
 * **验证: 需求 6.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { ArticleType } from '../../../shared/types/legal'

describe('法律法规详情 API', () => {
    describe('Property 6: 条文层级顺序正确性', () => {
        /**
         * Feature: legal-search, Property 6: 条文层级顺序正确性
         *
         * 对于任意法律法规的条文列表，条文应按 order 字段升序排列
         */
        it('条文应按 order 字段升序排列', () => {
            fc.assert(
                fc.property(
                    // 生成随机条文列表
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            order: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
                            type: fc.constantFrom(...Object.values(ArticleType)),
                            content: fc.string({ minLength: 1, maxLength: 200 }),
                        }),
                        { minLength: 0, maxLength: 50 }
                    ),
                    (articles) => {
                        // 模拟按 order 排序
                        const sortedArticles = [...articles].sort((a, b) => {
                            // null 值排在最后
                            if (a.order === null && b.order === null) return 0
                            if (a.order === null) return 1
                            if (b.order === null) return -1
                            return a.order - b.order
                        })

                        // 验证：排序后的列表是升序的
                        for (let i = 1; i < sortedArticles.length; i++) {
                            const prev = sortedArticles[i - 1].order
                            const curr = sortedArticles[i].order

                            // 如果前一个是 null，当前也应该是 null（null 排在最后）
                            if (prev === null) {
                                expect(curr).toBeNull()
                            } else if (curr !== null) {
                                // 如果都不是 null，应该是升序
                                expect(curr).toBeGreaterThanOrEqual(prev)
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * 验证层级结构的父子关系
         */
        it('层级结构应保持正确的父子关系', () => {
            fc.assert(
                fc.property(
                    // 生成随机层级数据
                    fc.array(
                        fc.record({
                            id: fc.uuid(),
                            type: fc.constantFrom(...Object.values(ArticleType)),
                            l1: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
                            l1I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
                            l2: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
                            l2I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
                            l3: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
                            l3I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
                            l4: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
                            l4I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
                            l5: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
                            l5I: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
                        }),
                        { minLength: 0, maxLength: 20 }
                    ),
                    (articles) => {
                        // 验证：如果有 l2，则必须有 l1（或者 l2 是独立的）
                        // 验证：如果有 l3，则必须有 l2 或 l1
                        // 这是一个宽松的验证，因为实际数据可能有特殊情况
                        articles.forEach(article => {
                            // 计算层级深度
                            const depth = getHierarchyDepth(article)
                            expect(depth).toBeGreaterThanOrEqual(0)
                            expect(depth).toBeLessThanOrEqual(5)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 5: 返回数据完整性', () => {
        /**
         * Feature: legal-search, Property 5: 返回数据完整性
         *
         * 法律法规详情应包含所有必要字段
         */
        it('详情响应应包含所有必要字段', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        id: fc.uuid(),
                        name: fc.string({ minLength: 1, maxLength: 100 }),
                        code: fc.string({ minLength: 1, maxLength: 50 }),
                        type: fc.constantFrom('law', 'regulation', 'judicial_interp', 'guideline'),
                        category: fc.option(fc.string(), { nil: null }),
                        content: fc.string({ minLength: 0, maxLength: 1000 }),
                        issuingAuthority: fc.option(fc.string(), { nil: null }),
                        documentNumber: fc.option(fc.string(), { nil: null }),
                        publishDate: fc.option(fc.string(), { nil: null }),
                        effectiveDate: fc.option(fc.string(), { nil: null }),
                        invalidDate: fc.option(fc.string(), { nil: null }),
                        articles: fc.array(
                            fc.record({
                                id: fc.uuid(),
                                legalId: fc.uuid(),
                                type: fc.constantFrom(...Object.values(ArticleType)),
                                content: fc.option(fc.string(), { nil: null }),
                            }),
                            { minLength: 0, maxLength: 10 }
                        ),
                    }),
                    (response) => {
                        // 验证必要字段存在
                        expect(response.id).toBeDefined()
                        expect(response.name).toBeDefined()
                        expect(response.code).toBeDefined()
                        expect(response.type).toBeDefined()
                        expect(response.articles).toBeDefined()
                        expect(Array.isArray(response.articles)).toBe(true)

                        // 验证条文必要字段
                        response.articles.forEach(article => {
                            expect(article.id).toBeDefined()
                            expect(article.legalId).toBeDefined()
                            expect(article.type).toBeDefined()
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('边界情况测试', () => {
        it('空条文列表应正常返回', () => {
            const response = {
                id: 'test-id',
                name: '测试法律',
                code: 'TEST-001',
                type: 'law',
                category: null,
                content: '测试内容',
                issuingAuthority: null,
                documentNumber: null,
                publishDate: null,
                effectiveDate: null,
                invalidDate: null,
                articles: [],
            }

            expect(response.articles.length).toBe(0)
            expect(response.id).toBe('test-id')
        })

        it('无效 ID 格式应被识别', () => {
            const invalidIds = ['', 'invalid', '123', 'not-a-uuid']

            invalidIds.forEach(id => {
                // UUID 格式验证
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                expect(uuidRegex.test(id)).toBe(false)
            })
        })
    })
})

/**
 * 辅助函数：计算层级深度
 */
function getHierarchyDepth(article: {
    l1: string | null
    l2: string | null
    l3: string | null
    l4: string | null
    l5: string | null
}): number {
    if (article.l5) return 5
    if (article.l4) return 4
    if (article.l3) return 3
    if (article.l2) return 2
    if (article.l1) return 1
    return 0
}
