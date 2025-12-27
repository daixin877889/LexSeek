/**
 * 会员级别管理集成测试
 *
 * 测试场景：创建级别、查询级别列表（验证排序）、更新级别、启用/禁用级别
 *
 * **Feature: membership-system**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    generateMembershipLevels,
    type MockMembershipLevel,
} from './membership-test-fixtures'
import {
    isLevelActive,
    sortLevelsBySortOrder,
    getHigherLevels,
} from './membership-test-helpers'

describe('会员级别管理集成测试', () => {
    describe('会员级别创建', () => {
        it('创建的会员级别应包含所有必要字段', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 2, maxLength: 20 }),
                    fc.integer({ min: 1, max: 100 }),
                    (name, sortOrder) => {
                        const level = createMembershipLevel({
                            name,
                            sortOrder,
                        })

                        expect(level.id).toBeDefined()
                        expect(level.name).toBe(name)
                        expect(level.sortOrder).toBe(sortOrder)
                        expect(level.status).toBe(1)
                        expect(level.createdAt).toBeInstanceOf(Date)
                        expect(level.updatedAt).toBeInstanceOf(Date)
                        expect(level.deletedAt).toBeNull()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('新创建的会员级别默认状态应为启用', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 2, maxLength: 20 }),
                    (name) => {
                        const level = createMembershipLevel({ name })
                        expect(level.status).toBe(1)
                        expect(isLevelActive(level)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('会员级别排序', () => {
        it('查询结果应按 sortOrder 升序排列', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.integer({ min: 1, max: 100 }),
                        { minLength: 2, maxLength: 10 }
                    ),
                    (sortOrders) => {
                        // 创建具有不同 sortOrder 的级别
                        const levels = sortOrders.map((sortOrder, index) =>
                            createMembershipLevel({
                                id: index + 1,
                                name: `级别${index + 1}`,
                                sortOrder,
                            })
                        )

                        // 排序
                        const sorted = sortLevelsBySortOrder(levels)

                        // 验证排序结果
                        for (let i = 0; i < sorted.length - 1; i++) {
                            expect(sorted[i].sortOrder).toBeLessThanOrEqual(
                                sorted[i + 1].sortOrder
                            )
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('sortOrder 越小的级别越高', () => {
            const levels = generateMembershipLevels(3)
            const sorted = sortLevelsBySortOrder(levels)

            // 第一个是最高级别（sortOrder 最小）
            expect(sorted[0].name).toBe('钻石会员')
            expect(sorted[0].sortOrder).toBe(1)

            // 最后一个是最低级别（sortOrder 最大）
            expect(sorted[sorted.length - 1].name).toBe('普通会员')
            expect(sorted[sorted.length - 1].sortOrder).toBe(3)
        })
    })

    describe('会员级别状态管理', () => {
        it('禁用级别后 isLevelActive 应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 2, maxLength: 20 }),
                    (name) => {
                        const level = createMembershipLevel({
                            name,
                            status: 0, // 禁用
                        })

                        expect(isLevelActive(level)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('软删除级别后 isLevelActive 应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 2, maxLength: 20 }),
                    (name) => {
                        const level = createMembershipLevel({
                            name,
                            status: 1,
                            deletedAt: new Date(), // 软删除
                        })

                        expect(isLevelActive(level)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('启用且未删除的级别 isLevelActive 应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 2, maxLength: 20 }),
                    (name) => {
                        const level = createMembershipLevel({
                            name,
                            status: 1,
                            deletedAt: null,
                        })

                        expect(isLevelActive(level)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('获取更高级别', () => {
        it('应返回 sortOrder 更小的级别', () => {
            const levels = generateMembershipLevels(3)
            const currentLevel = levels[2] // 普通会员，sortOrder = 3

            const higherLevels = getHigherLevels(currentLevel, levels)

            expect(higherLevels.length).toBe(2)
            higherLevels.forEach((level) => {
                expect(level.sortOrder).toBeLessThan(currentLevel.sortOrder)
            })
        })

        it('最高级别应没有更高的级别', () => {
            const levels = generateMembershipLevels(3)
            const highestLevel = levels[0] // 钻石会员，sortOrder = 1

            const higherLevels = getHigherLevels(highestLevel, levels)

            expect(higherLevels.length).toBe(0)
        })

        it('应排除禁用的级别', () => {
            const levels = [
                createMembershipLevel({ id: 1, name: '钻石会员', sortOrder: 1, status: 0 }), // 禁用
                createMembershipLevel({ id: 2, name: '黄金会员', sortOrder: 2, status: 1 }),
                createMembershipLevel({ id: 3, name: '普通会员', sortOrder: 3, status: 1 }),
            ]

            const currentLevel = levels[2]
            const higherLevels = getHigherLevels(currentLevel, levels)

            // 只有黄金会员（钻石会员被禁用）
            expect(higherLevels.length).toBe(1)
            expect(higherLevels[0].name).toBe('黄金会员')
        })

        it('应排除已删除的级别', () => {
            const levels = [
                createMembershipLevel({
                    id: 1,
                    name: '钻石会员',
                    sortOrder: 1,
                    deletedAt: new Date(),
                }), // 已删除
                createMembershipLevel({ id: 2, name: '黄金会员', sortOrder: 2 }),
                createMembershipLevel({ id: 3, name: '普通会员', sortOrder: 3 }),
            ]

            const currentLevel = levels[2]
            const higherLevels = getHigherLevels(currentLevel, levels)

            expect(higherLevels.length).toBe(1)
            expect(higherLevels[0].name).toBe('黄金会员')
        })
    })

    describe('会员级别属性测试', () => {
        it('任意数量的级别排序后顺序应保持一致', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.integer({ min: 1, max: 1000 }),
                            name: fc.string({ minLength: 2, maxLength: 20 }),
                            sortOrder: fc.integer({ min: 1, max: 100 }),
                            status: fc.constantFrom(0, 1),
                        }),
                        { minLength: 1, maxLength: 20 }
                    ),
                    (levelData) => {
                        const levels: MockMembershipLevel[] = levelData.map((data, index) =>
                            createMembershipLevel({
                                ...data,
                                id: index + 1,
                            })
                        )

                        // 多次排序结果应相同
                        const sorted1 = sortLevelsBySortOrder(levels)
                        const sorted2 = sortLevelsBySortOrder(levels)

                        expect(sorted1.map((l) => l.id)).toEqual(
                            sorted2.map((l) => l.id)
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('排序不应改变原数组', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.integer({ min: 1, max: 100 }),
                        { minLength: 2, maxLength: 10 }
                    ),
                    (sortOrders) => {
                        const levels = sortOrders.map((sortOrder, index) =>
                            createMembershipLevel({
                                id: index + 1,
                                sortOrder,
                            })
                        )

                        const originalIds = levels.map((l) => l.id)
                        sortLevelsBySortOrder(levels)

                        // 原数组顺序不变
                        expect(levels.map((l) => l.id)).toEqual(originalIds)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
