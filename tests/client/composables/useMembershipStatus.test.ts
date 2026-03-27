/**
 * useMembershipStatus 会员状态处理测试
 *
 * 测试会员生效状态和级别判断方法
 *
 * **Feature: membership-status-composable**
 * **Validates: 会员状态判断功能**
 */

import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import * as fc from 'fast-check'
import dayjs from 'dayjs'

// 导入待测试的 composable
const { useMembershipStatus } = await import('~/composables/useMembershipStatus')

describe('useMembershipStatus 会员生效状态测试', () => {
    describe('isNotEffective - 会员是否未生效', () => {
        it('null 日期应返回 false', () => {
            const levels = ref([])
            const { isNotEffective } = useMembershipStatus(levels)
            expect(isNotEffective(null)).toBe(false)
        })

        it('undefined 日期应返回 false', () => {
            const levels = ref([])
            const { isNotEffective } = useMembershipStatus(levels)
            expect(isNotEffective(undefined)).toBe(false)
        })

        it('未来日期应返回 true', () => {
            const levels = ref([])
            const { isNotEffective } = useMembershipStatus(levels)
            const futureDate = dayjs().add(1, 'day').toISOString()
            expect(isNotEffective(futureDate)).toBe(true)
        })

        it('过去日期应返回 false', () => {
            const levels = ref([])
            const { isNotEffective } = useMembershipStatus(levels)
            const pastDate = dayjs().subtract(1, 'day').toISOString()
            expect(isNotEffective(pastDate)).toBe(false)
        })

        it('无效日期应返回 false', () => {
            const levels = ref([])
            const { isNotEffective } = useMembershipStatus(levels)
            expect(isNotEffective('not-a-date')).toBe(false)
            expect(isNotEffective('invalid')).toBe(false)
        })
    })
})

describe('useMembershipStatus 最高级别判断测试', () => {
    describe('isHighestLevel - 是否为最高级别', () => {
        it('空级别列表应返回 false', () => {
            const levels = ref([])
            const { isHighestLevel } = useMembershipStatus(levels)
            expect(isHighestLevel(1)).toBe(false)
        })

        it('只有一个级别时该级别为最高级别', () => {
            const levels = ref([
                { id: 1, name: '基础版', sortOrder: 1 },
            ])
            const { isHighestLevel } = useMembershipStatus(levels)
            expect(isHighestLevel(1)).toBe(true)
        })

        it('多个级别时应正确判断最高级别', () => {
            const levels = ref([
                { id: 1, name: '基础版', sortOrder: 1 },
                { id: 2, name: '专业版', sortOrder: 2 },
                { id: 3, name: '旗舰版', sortOrder: 3 },
            ])
            const { isHighestLevel } = useMembershipStatus(levels)

            expect(isHighestLevel(1)).toBe(false) // 不是最高级别
            expect(isHighestLevel(2)).toBe(false) // 不是最高级别
            expect(isHighestLevel(3)).toBe(true)  // 是最高级别
        })

        it('sortOrder 最大的为最高级别', () => {
            const levels = ref([
                { id: 1, name: '基础版', sortOrder: 5 },
                { id: 2, name: '专业版', sortOrder: 10 },
                { id: 3, name: '旗舰版', sortOrder: 20 },
            ])
            const { isHighestLevel } = useMembershipStatus(levels)

            expect(isHighestLevel(1)).toBe(false)
            expect(isHighestLevel(2)).toBe(false)
            expect(isHighestLevel(3)).toBe(true)
        })

        it('不存在的不级别 ID 应返回 false', () => {
            const levels = ref([
                { id: 1, name: '基础版', sortOrder: 1 },
            ])
            const { isHighestLevel } = useMembershipStatus(levels)
            expect(isHighestLevel(999)).toBe(false)
        })

        it('只考虑真正的会员级别（基础版、专业版、旗舰版）', () => {
            const levels = ref([
                { id: 1, name: '基础版', sortOrder: 1 },
                { id: 99, name: '测试级别', sortOrder: 100 }, // 很高的 sortOrder 但不是真正的级别
            ])
            const { isHighestLevel } = useMembershipStatus(levels)

            // 测试级别虽然 sortOrder 很高，但不计入真正的级别判断
            // 所以基础版（唯一的真正级别）应该被判定为最高级别
            expect(isHighestLevel(1)).toBe(true)
            // 测试级别不在真正的级别中，应该返回 false
            expect(isHighestLevel(99)).toBe(false)
        })

        it('属性测试：sortOrder 最高的级别应被判定为最高级别', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 10 }),
                    (levelCount) => {
                        const names = ['基础版', '专业版', '旗舰版', '钻石版', '至尊版', '精英版', '高级版', '普通版', '特惠版', '豪华版']
                        const levels = Array.from({ length: levelCount }, (_, i) => ({
                            id: i + 1, // 使用连续 ID (1, 2, 3...)
                            name: names[i % names.length], // 映射到真正的会员级别名称
                            sortOrder: (i + 1) * 10,
                        }))
                        const levelsRef = ref(levels)
                        const { isHighestLevel } = useMembershipStatus(levelsRef)

                        const realLevels = levels.filter((l) =>
                            l.id === 1 || l.id === 2 || l.id === 3 ||
                            l.name === '基础版' || l.name === '专业版' || l.name === '旗舰版'
                        )
                        const maxSortOrder = Math.max(...realLevels.map(l => l.sortOrder))
                        const highestLevelId = realLevels.find(l => l.sortOrder === maxSortOrder)!.id

                        for (const level of levels) {
                            const result = isHighestLevel(level.id)
                            if (level.id === highestLevelId) {
                                expect(result).toBe(true)
                            } else {
                                expect(result).toBe(false)
                            }
                        }
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('useMembershipStatus 边界情况测试', () => {
    it('sortOrder 相等的多个级别应正确判断', () => {
        const levels = ref([
            { id: 1, name: '级别A', sortOrder: 5 },
            { id: 2, name: '级别B', sortOrder: 5 },
        ])
        const { isHighestLevel } = useMembershipStatus(levels)

        // 两个级别的 sortOrder 相等，都应该是最高级别（>= maxSortOrder）
        expect(isHighestLevel(1)).toBe(true)
        expect(isHighestLevel(2)).toBe(true)
    })

    it('负数 sortOrder 应正确处理', () => {
        const levels = ref([
            { id: 1, name: '负级别', sortOrder: -10 },
        ])
        const { isHighestLevel } = useMembershipStatus(levels)
        expect(isHighestLevel(1)).toBe(true)
    })
})
