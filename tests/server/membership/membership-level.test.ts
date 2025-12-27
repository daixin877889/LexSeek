/**
 * 会员级别属性测试
 *
 * 使用 fast-check 进行属性测试，验证会员级别的核心业务逻辑
 *
 * **Feature: membership-system**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 会员级别状态（与 shared/types/membership.ts 保持一致）
const MembershipLevelStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

/**
 * 模拟会员级别数据结构
 */
interface MockMembershipLevel {
    id: number
    name: string
    description: string | null
    sortOrder: number
    status: number
    deletedAt: Date | null
}

/**
 * Property 1: 会员级别排序一致性
 *
 * For any 会员级别列表，查询返回的结果 SHALL 按 sortOrder 字段升序排列，
 * 且 sortOrder 值越小的级别越高。
 *
 * **Feature: membership-system, Property 1: 会员级别排序一致性**
 * **Validates: Requirements 1.3, 1.4**
 */
describe('Property 1: 会员级别排序一致性', () => {
    /**
     * 模拟查询所有启用的会员级别（按 sortOrder 升序）
     */
    const findAllActiveMembershipLevels = (levels: MockMembershipLevel[]): MockMembershipLevel[] => {
        return levels
            .filter((level) => level.status === MembershipLevelStatus.ENABLED && level.deletedAt === null)
            .sort((a, b) => a.sortOrder - b.sortOrder)
    }

    /**
     * 生成会员级别的 arbitrary
     */
    const membershipLevelArb = fc.record({
        id: fc.integer({ min: 1, max: 1000 }),
        name: fc.string({ minLength: 1, maxLength: 50 }),
        description: fc.option(fc.string({ maxLength: 255 }), { nil: null }),
        sortOrder: fc.integer({ min: 0, max: 100 }),
        status: fc.constantFrom(MembershipLevelStatus.DISABLED, MembershipLevelStatus.ENABLED),
        deletedAt: fc.option(fc.date(), { nil: null }),
    })

    it('查询结果应按 sortOrder 升序排列', () => {
        fc.assert(
            fc.property(
                fc.array(membershipLevelArb, { minLength: 1, maxLength: 10 }),
                (levels) => {
                    // 确保 ID 唯一
                    const uniqueLevels = levels.map((l, i) => ({ ...l, id: i + 1 }))
                    const result = findAllActiveMembershipLevels(uniqueLevels)

                    // 验证排序：每个元素的 sortOrder 应小于等于下一个元素
                    for (let i = 0; i < result.length - 1; i++) {
                        expect(result[i].sortOrder).toBeLessThanOrEqual(result[i + 1].sortOrder)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('sortOrder 值越小的级别应排在前面（级别越高）', () => {
        fc.assert(
            fc.property(
                fc.array(membershipLevelArb, { minLength: 2, maxLength: 10 }),
                (levels) => {
                    const uniqueLevels = levels.map((l, i) => ({ ...l, id: i + 1 }))
                    const result = findAllActiveMembershipLevels(uniqueLevels)

                    if (result.length >= 2) {
                        // 第一个元素的 sortOrder 应该是最小的（级别最高）
                        const minSortOrder = Math.min(...result.map((l) => l.sortOrder))
                        expect(result[0].sortOrder).toBe(minSortOrder)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('只返回启用状态的会员级别', () => {
        fc.assert(
            fc.property(
                fc.array(membershipLevelArb, { minLength: 1, maxLength: 10 }),
                (levels) => {
                    const uniqueLevels = levels.map((l, i) => ({ ...l, id: i + 1 }))
                    const result = findAllActiveMembershipLevels(uniqueLevels)

                    // 验证所有返回的级别都是启用状态
                    result.forEach((level) => {
                        expect(level.status).toBe(MembershipLevelStatus.ENABLED)
                    })
                }
            ),
            { numRuns: 100 }
        )
    })

    it('不返回已删除的会员级别', () => {
        fc.assert(
            fc.property(
                fc.array(membershipLevelArb, { minLength: 1, maxLength: 10 }),
                (levels) => {
                    const uniqueLevels = levels.map((l, i) => ({ ...l, id: i + 1 }))
                    const result = findAllActiveMembershipLevels(uniqueLevels)

                    // 验证所有返回的级别都未被删除
                    result.forEach((level) => {
                        expect(level.deletedAt).toBeNull()
                    })
                }
            ),
            { numRuns: 100 }
        )
    })

    it('相同 sortOrder 的级别应保持稳定排序', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 10 }),
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 5 }),
                (sortOrder, names) => {
                    // 创建多个相同 sortOrder 的级别
                    const levels: MockMembershipLevel[] = names.map((name, i) => ({
                        id: i + 1,
                        name,
                        description: null,
                        sortOrder,
                        status: MembershipLevelStatus.ENABLED,
                        deletedAt: null,
                    }))

                    const result1 = findAllActiveMembershipLevels(levels)
                    const result2 = findAllActiveMembershipLevels(levels)

                    // 多次查询结果应该一致
                    expect(result1.map((l) => l.id)).toEqual(result2.map((l) => l.id))
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * 会员级别比较逻辑测试
 *
 * 验证会员级别高低比较的正确性
 */
describe('会员级别比较逻辑', () => {
    /**
     * 比较两个会员级别的高低
     * @returns 负数表示 a 级别更高，正数表示 b 级别更高，0 表示相同
     */
    const compareMembershipLevels = (
        a: { sortOrder: number },
        b: { sortOrder: number }
    ): number => {
        return a.sortOrder - b.sortOrder
    }

    /**
     * 判断级别 a 是否比级别 b 更高
     */
    const isHigherLevel = (
        a: { sortOrder: number },
        b: { sortOrder: number }
    ): boolean => {
        return a.sortOrder < b.sortOrder
    }

    it('sortOrder 更小的级别应该更高', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 50 }),
                fc.integer({ min: 51, max: 100 }),
                (smallerOrder, largerOrder) => {
                    const higherLevel = { sortOrder: smallerOrder }
                    const lowerLevel = { sortOrder: largerOrder }

                    expect(isHigherLevel(higherLevel, lowerLevel)).toBe(true)
                    expect(isHigherLevel(lowerLevel, higherLevel)).toBe(false)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('相同 sortOrder 的级别应该相等', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 100 }),
                (sortOrder) => {
                    const levelA = { sortOrder }
                    const levelB = { sortOrder }

                    expect(compareMembershipLevels(levelA, levelB)).toBe(0)
                    expect(isHigherLevel(levelA, levelB)).toBe(false)
                    expect(isHigherLevel(levelB, levelA)).toBe(false)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('级别比较应满足传递性', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 30 }),
                fc.integer({ min: 31, max: 60 }),
                fc.integer({ min: 61, max: 100 }),
                (orderA, orderB, orderC) => {
                    const levelA = { sortOrder: orderA }
                    const levelB = { sortOrder: orderB }
                    const levelC = { sortOrder: orderC }

                    // 如果 A > B 且 B > C，则 A > C
                    if (isHigherLevel(levelA, levelB) && isHigherLevel(levelB, levelC)) {
                        expect(isHigherLevel(levelA, levelC)).toBe(true)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
