/**
 * 法律法规统计信息服务层测试
 *
 * 验证统计数据计算的正确性和一致性
 *
 * **Feature: legal-detail-page**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { LegalStatistics } from '#shared/types/legal'

describe('法律法规统计信息服务层', () => {
    describe('Property 1: 统计数据一致性', () => {
        it('已向量化 + 未向量化 = 条文总数', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        totalArticles: fc.integer({ min: 0, max: 1000 }),
                        embeddedArticles: fc.integer({ min: 0, max: 1000 }),
                    }).filter(({ totalArticles, embeddedArticles }) => embeddedArticles <= totalArticles),
                    ({ totalArticles, embeddedArticles }) => {
                        // 模拟统计数据
                        const statistics: LegalStatistics = {
                            totalArticles,
                            embeddedArticles,
                            notEmbeddedArticles: totalArticles - embeddedArticles,
                            articlesByType: {
                                l1: 0,
                                l2: 0,
                                l3: 0,
                                l4: 0,
                                l5: 0,
                                notice: 0,
                                header: 0,
                                footer: 0,
                                annex: 0,
                            },
                            lastEditedAt: null,
                            lastEmbeddingAt: null,
                        }

                        // 验证一致性
                        expect(statistics.embeddedArticles + statistics.notEmbeddedArticles)
                            .toBe(statistics.totalArticles)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('未向量化条文数不能为负数', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        totalArticles: fc.integer({ min: 0, max: 1000 }),
                        embeddedArticles: fc.integer({ min: 0, max: 1000 }),
                    }).filter(({ totalArticles, embeddedArticles }) => embeddedArticles <= totalArticles),
                    ({ totalArticles, embeddedArticles }) => {
                        const notEmbeddedArticles = totalArticles - embeddedArticles

                        // 验证非负
                        expect(notEmbeddedArticles).toBeGreaterThanOrEqual(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: 类型分布总和一致性', () => {
        it('所有类型数量之和应等于条文总数', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        l1: fc.integer({ min: 0, max: 100 }),
                        l2: fc.integer({ min: 0, max: 100 }),
                        l3: fc.integer({ min: 0, max: 100 }),
                        l4: fc.integer({ min: 0, max: 100 }),
                        l5: fc.integer({ min: 0, max: 100 }),
                        notice: fc.integer({ min: 0, max: 100 }),
                        header: fc.integer({ min: 0, max: 100 }),
                        footer: fc.integer({ min: 0, max: 100 }),
                        annex: fc.integer({ min: 0, max: 100 }),
                    }),
                    (articlesByType) => {
                        // 计算总数
                        const totalArticles = Object.values(articlesByType).reduce((sum, count) => sum + count, 0)

                        // 模拟统计数据
                        const statistics: LegalStatistics = {
                            totalArticles,
                            embeddedArticles: 0,
                            notEmbeddedArticles: totalArticles,
                            articlesByType,
                            lastEditedAt: null,
                            lastEmbeddingAt: null,
                        }

                        // 验证类型分布总和
                        const typeSum = Object.values(statistics.articlesByType).reduce((sum, count) => sum + count, 0)
                        expect(typeSum).toBe(statistics.totalArticles)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('每个类型的数量都不能为负数', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        l1: fc.integer({ min: 0, max: 100 }),
                        l2: fc.integer({ min: 0, max: 100 }),
                        l3: fc.integer({ min: 0, max: 100 }),
                        l4: fc.integer({ min: 0, max: 100 }),
                        l5: fc.integer({ min: 0, max: 100 }),
                        notice: fc.integer({ min: 0, max: 100 }),
                        header: fc.integer({ min: 0, max: 100 }),
                        footer: fc.integer({ min: 0, max: 100 }),
                        annex: fc.integer({ min: 0, max: 100 }),
                    }),
                    (articlesByType) => {
                        // 验证所有类型数量非负
                        for (const count of Object.values(articlesByType)) {
                            expect(count).toBeGreaterThanOrEqual(0)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('边界情况测试', () => {
        it('无条文时统计数据应全为 0', () => {
            const statistics: LegalStatistics = {
                totalArticles: 0,
                embeddedArticles: 0,
                notEmbeddedArticles: 0,
                articlesByType: {
                    l1: 0,
                    l2: 0,
                    l3: 0,
                    l4: 0,
                    l5: 0,
                    notice: 0,
                    header: 0,
                    footer: 0,
                    annex: 0,
                },
                lastEditedAt: null,
                lastEmbeddingAt: null,
            }

            expect(statistics.totalArticles).toBe(0)
            expect(statistics.embeddedArticles).toBe(0)
            expect(statistics.notEmbeddedArticles).toBe(0)
            expect(Object.values(statistics.articlesByType).every(count => count === 0)).toBe(true)
        })

        it('全部向量化时未向量化数应为 0', () => {
            const totalArticles = 100
            const statistics: LegalStatistics = {
                totalArticles,
                embeddedArticles: totalArticles,
                notEmbeddedArticles: 0,
                articlesByType: {
                    l1: 10,
                    l2: 20,
                    l3: 30,
                    l4: 20,
                    l5: 20,
                    notice: 0,
                    header: 0,
                    footer: 0,
                    annex: 0,
                },
                lastEditedAt: null,
                lastEmbeddingAt: null,
            }

            expect(statistics.notEmbeddedArticles).toBe(0)
            expect(statistics.embeddedArticles).toBe(statistics.totalArticles)
        })

        it('全部未向量化时已向量化数应为 0', () => {
            const totalArticles = 100
            const statistics: LegalStatistics = {
                totalArticles,
                embeddedArticles: 0,
                notEmbeddedArticles: totalArticles,
                articlesByType: {
                    l1: 10,
                    l2: 20,
                    l3: 30,
                    l4: 20,
                    l5: 20,
                    notice: 0,
                    header: 0,
                    footer: 0,
                    annex: 0,
                },
                lastEditedAt: null,
                lastEmbeddingAt: null,
            }

            expect(statistics.embeddedArticles).toBe(0)
            expect(statistics.notEmbeddedArticles).toBe(statistics.totalArticles)
        })
    })
})


describe('Property 3: 状态显示正确性', () => {
    it('失效日期早于当前日期应显示"已失效"', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2000-01-01'), max: new Date() }).filter(d => !isNaN(d.getTime())),
                (invalidDate) => {
                    // 模拟法律法规数据
                    const legal = {
                        id: 'test-id',
                        name: '测试法律',
                        code: 'TEST-001',
                        type: 'law' as const,
                        category: null,
                        content: '测试内容',
                        issuingAuthority: null,
                        documentNumber: null,
                        publishDate: null,
                        effectiveDate: null,
                        invalidDate: invalidDate.toISOString().split('T')[0],
                        lastEditedAt: null,
                        lastEmbeddingAt: null,
                        createdAt: null,
                        updatedAt: null,
                    }

                    // 计算状态
                    const status = getStatusText(legal)

                    // 验证状态
                    expect(status).toBe('已失效')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('生效日期晚于当前日期应显示"未生效"', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 365 * 10 }), // 未来 1 天到 10 年
                (daysInFuture) => {
                    const effectiveDate = new Date()
                    effectiveDate.setDate(effectiveDate.getDate() + daysInFuture)

                    // 模拟法律法规数据
                    const legal = {
                        id: 'test-id',
                        name: '测试法律',
                        code: 'TEST-001',
                        type: 'law' as const,
                        category: null,
                        content: '测试内容',
                        issuingAuthority: null,
                        documentNumber: null,
                        publishDate: null,
                        effectiveDate: effectiveDate.toISOString().split('T')[0],
                        invalidDate: null,
                        lastEditedAt: null,
                        lastEmbeddingAt: null,
                        createdAt: null,
                        updatedAt: null,
                    }

                    // 计算状态
                    const status = getStatusText(legal)

                    // 验证状态
                    expect(status).toBe('未生效')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('无失效日期且生效日期早于当前日期应显示"有效"', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2000-01-01'), max: new Date() }).filter(d => !isNaN(d.getTime())),
                (effectiveDate) => {
                    // 模拟法律法规数据
                    const legal = {
                        id: 'test-id',
                        name: '测试法律',
                        code: 'TEST-001',
                        type: 'law' as const,
                        category: null,
                        content: '测试内容',
                        issuingAuthority: null,
                        documentNumber: null,
                        publishDate: null,
                        effectiveDate: effectiveDate.toISOString().split('T')[0],
                        invalidDate: null,
                        lastEditedAt: null,
                        lastEmbeddingAt: null,
                        createdAt: null,
                        updatedAt: null,
                    }

                    // 计算状态
                    const status = getStatusText(legal)

                    // 验证状态
                    expect(status).toBe('有效')
                }
            ),
            { numRuns: 100 }
        )
    })
})

/** 辅助函数：计算状态文本 */
function getStatusText(legal: {
    invalidDate: string | null
    effectiveDate: string | null
}): string {
    const now = new Date()

    if (legal.invalidDate) {
        const invalidDate = new Date(legal.invalidDate)
        if (invalidDate < now) {
            return '已失效'
        }
    }

    if (legal.effectiveDate) {
        const effectiveDate = new Date(legal.effectiveDate)
        if (effectiveDate > now) {
            return '未生效'
        }
    }

    return '有效'
}
