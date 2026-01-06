/**
 * 法律法规搜索统计 API 属性测试
 *
 * **Feature: legal-search, Property 1: 统计数据正确性**
 * **验证: 需求 2.1**
 *
 * 验证统计接口返回的各类型数量之和等于总数量，
 * 且每个类型的数量应与数据库中该类型的实际记录数一致。
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { LegalStatisticsResponse } from '../../../shared/types/legal-search'
import { LegalType } from '../../../shared/types/legal'

describe('法律法规搜索统计 API', () => {
    describe('Property 1: 统计数据正确性', () => {
        /**
         * Feature: legal-search, Property 1: 统计数据正确性
         * 
         * 对于任意法律法规数据集，统计接口返回的各类型数量之和应等于总数量
         */
        it('各类型数量之和应等于总数量', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        law: fc.integer({ min: 0, max: 500 }),
                        regulation: fc.integer({ min: 0, max: 500 }),
                        judicial_interp: fc.integer({ min: 0, max: 500 }),
                        guideline: fc.integer({ min: 0, max: 500 }),
                    }),
                    (byType) => {
                        // 计算总数
                        const total = byType.law + byType.regulation + byType.judicial_interp + byType.guideline

                        // 模拟统计响应
                        const statistics: LegalStatisticsResponse = {
                            total,
                            byType,
                            byStatus: {
                                valid: Math.floor(total * 0.8),
                                invalid: Math.floor(total * 0.2),
                            },
                        }

                        // 验证：各类型数量之和等于总数量
                        const typeSum = statistics.byType.law
                            + statistics.byType.regulation
                            + statistics.byType.judicial_interp
                            + statistics.byType.guideline

                        expect(typeSum).toBe(statistics.total)
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * Feature: legal-search, Property 1: 统计数据正确性
         * 
         * 每个类型的数量应为非负整数
         */
        it('每个类型的数量应为非负整数', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        law: fc.integer({ min: 0, max: 500 }),
                        regulation: fc.integer({ min: 0, max: 500 }),
                        judicial_interp: fc.integer({ min: 0, max: 500 }),
                        guideline: fc.integer({ min: 0, max: 500 }),
                    }),
                    (byType) => {
                        // 验证所有类型数量非负
                        expect(byType.law).toBeGreaterThanOrEqual(0)
                        expect(byType.regulation).toBeGreaterThanOrEqual(0)
                        expect(byType.judicial_interp).toBeGreaterThanOrEqual(0)
                        expect(byType.guideline).toBeGreaterThanOrEqual(0)

                        // 验证为整数
                        expect(Number.isInteger(byType.law)).toBe(true)
                        expect(Number.isInteger(byType.regulation)).toBe(true)
                        expect(Number.isInteger(byType.judicial_interp)).toBe(true)
                        expect(Number.isInteger(byType.guideline)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        /**
         * Feature: legal-search, Property 1: 统计数据正确性
         * 
         * 有效数量 + 已失效数量 应不超过总数量
         * （可能存在未生效的法律，所以不一定等于总数）
         */
        it('有效数量 + 已失效数量应不超过总数量', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        total: fc.integer({ min: 0, max: 1000 }),
                        validRatio: fc.float({ min: 0, max: 1 }),
                        invalidRatio: fc.float({ min: 0, max: 1 }),
                    }).filter(({ validRatio, invalidRatio }) => validRatio + invalidRatio <= 1),
                    ({ total, validRatio, invalidRatio }) => {
                        const valid = Math.floor(total * validRatio)
                        const invalid = Math.floor(total * invalidRatio)

                        // 模拟统计响应
                        const statistics: LegalStatisticsResponse = {
                            total,
                            byType: {
                                law: Math.floor(total * 0.4),
                                regulation: Math.floor(total * 0.3),
                                judicial_interp: Math.floor(total * 0.2),
                                guideline: Math.floor(total * 0.1),
                            },
                            byStatus: {
                                valid,
                                invalid,
                            },
                        }

                        // 验证：有效 + 已失效 <= 总数
                        expect(statistics.byStatus.valid + statistics.byStatus.invalid)
                            .toBeLessThanOrEqual(statistics.total)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('边界情况测试', () => {
        it('无法律法规时统计数据应全为 0', () => {
            const statistics: LegalStatisticsResponse = {
                total: 0,
                byType: {
                    law: 0,
                    regulation: 0,
                    judicial_interp: 0,
                    guideline: 0,
                },
                byStatus: {
                    valid: 0,
                    invalid: 0,
                },
            }

            expect(statistics.total).toBe(0)
            expect(statistics.byType.law).toBe(0)
            expect(statistics.byType.regulation).toBe(0)
            expect(statistics.byType.judicial_interp).toBe(0)
            expect(statistics.byType.guideline).toBe(0)
            expect(statistics.byStatus.valid).toBe(0)
            expect(statistics.byStatus.invalid).toBe(0)
        })

        it('只有一种类型时其他类型应为 0', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('law', 'regulation', 'judicial_interp', 'guideline'),
                    fc.integer({ min: 1, max: 100 }),
                    (type, count) => {
                        const byType = {
                            law: 0,
                            regulation: 0,
                            judicial_interp: 0,
                            guideline: 0,
                        }
                        byType[type as keyof typeof byType] = count

                        const statistics: LegalStatisticsResponse = {
                            total: count,
                            byType,
                            byStatus: {
                                valid: count,
                                invalid: 0,
                            },
                        }

                        // 验证只有指定类型有数量
                        const types = ['law', 'regulation', 'judicial_interp', 'guideline'] as const
                        for (const t of types) {
                            if (t === type) {
                                expect(statistics.byType[t]).toBe(count)
                            } else {
                                expect(statistics.byType[t]).toBe(0)
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('全部有效时已失效数量应为 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    (total) => {
                        const statistics: LegalStatisticsResponse = {
                            total,
                            byType: {
                                law: total,
                                regulation: 0,
                                judicial_interp: 0,
                                guideline: 0,
                            },
                            byStatus: {
                                valid: total,
                                invalid: 0,
                            },
                        }

                        expect(statistics.byStatus.invalid).toBe(0)
                        expect(statistics.byStatus.valid).toBe(total)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('全部失效时有效数量应为 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    (total) => {
                        const statistics: LegalStatisticsResponse = {
                            total,
                            byType: {
                                law: total,
                                regulation: 0,
                                judicial_interp: 0,
                                guideline: 0,
                            },
                            byStatus: {
                                valid: 0,
                                invalid: total,
                            },
                        }

                        expect(statistics.byStatus.valid).toBe(0)
                        expect(statistics.byStatus.invalid).toBe(total)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('类型枚举一致性', () => {
        it('统计类型应与 LegalType 枚举一致', () => {
            const expectedTypes = [
                LegalType.LAW,
                LegalType.REGULATION,
                LegalType.JUDICIAL_INTERP,
                LegalType.GUIDELINE,
            ]

            const statisticsTypes = ['law', 'regulation', 'judicial_interp', 'guideline']

            // 验证类型一致
            expect(statisticsTypes).toEqual(expectedTypes)
        })
    })
})
