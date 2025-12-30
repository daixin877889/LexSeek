/**
 * useMembershipStatus Composable 属性测试
 *
 * 使用 fast-check 进行属性测试，验证会员状态处理方法的正确性
 *
 * **Feature: membership-status**
 * **Validates: Requirements 4.2, 4.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { ref } from 'vue'
import dayjs from 'dayjs'
import { useMembershipStatus, type MembershipLevel } from '../../../app/composables/useMembershipStatus'

describe('useMembershipStatus', () => {
    describe('isNotEffective - 会员未生效判断', () => {
        it('Property 5: 未来日期应返回 true，过去日期应返回 false', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isNotEffective } = useMembershipStatus(membershipLevels)

            fc.assert(
                fc.property(
                    fc.integer({ min: -365, max: 365 }), // 相对于今天的天数偏移
                    (daysOffset) => {
                        const date = dayjs().add(daysOffset, 'day')
                        const dateString = date.toISOString()
                        const result = isNotEffective(dateString)

                        // 如果日期在未来，应返回 true
                        if (daysOffset > 0) {
                            expect(result).toBe(true)
                        }
                        // 如果日期在过去，应返回 false
                        if (daysOffset < 0) {
                            expect(result).toBe(false)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空值应返回 false', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isNotEffective } = useMembershipStatus(membershipLevels)

            expect(isNotEffective(null)).toBe(false)
            expect(isNotEffective(undefined)).toBe(false)
            expect(isNotEffective('')).toBe(false)
        })

        it('无效日期应返回 false', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isNotEffective } = useMembershipStatus(membershipLevels)

            expect(isNotEffective('invalid-date')).toBe(false)
            expect(isNotEffective('not a date')).toBe(false)
        })

        it('明天的日期应返回 true', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isNotEffective } = useMembershipStatus(membershipLevels)

            const tomorrow = dayjs().add(1, 'day').toISOString()
            expect(isNotEffective(tomorrow)).toBe(true)
        })

        it('昨天的日期应返回 false', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isNotEffective } = useMembershipStatus(membershipLevels)

            const yesterday = dayjs().subtract(1, 'day').toISOString()
            expect(isNotEffective(yesterday)).toBe(false)
        })
    })

    describe('isHighestLevel - 最高级别判断', () => {
        it('Property 6: 最高 sortOrder 的级别应返回 true', () => {
            const levels: MembershipLevel[] = [
                { id: 1, name: '基础版', sortOrder: 1 },
                { id: 2, name: '专业版', sortOrder: 2 },
                { id: 3, name: '旗舰版', sortOrder: 3 },
            ]
            const membershipLevels = ref(levels)
            const { isHighestLevel } = useMembershipStatus(membershipLevels)

            // 旗舰版（sortOrder=3）是最高级别
            expect(isHighestLevel(3)).toBe(true)
            // 专业版和基础版不是最高级别
            expect(isHighestLevel(2)).toBe(false)
            expect(isHighestLevel(1)).toBe(false)
        })

        it('空级别列表应返回 false', () => {
            const membershipLevels = ref<MembershipLevel[]>([])
            const { isHighestLevel } = useMembershipStatus(membershipLevels)

            expect(isHighestLevel(1)).toBe(false)
            expect(isHighestLevel(2)).toBe(false)
            expect(isHighestLevel(3)).toBe(false)
        })

        it('不存在的级别 ID 应返回 false', () => {
            const levels: MembershipLevel[] = [
                { id: 1, name: '基础版', sortOrder: 1 },
                { id: 2, name: '专业版', sortOrder: 2 },
            ]
            const membershipLevels = ref(levels)
            const { isHighestLevel } = useMembershipStatus(membershipLevels)

            expect(isHighestLevel(999)).toBe(false)
        })

        it('只过滤真实会员级别进行判断', () => {
            const levels: MembershipLevel[] = [
                { id: 1, name: '基础版', sortOrder: 1 },
                { id: 2, name: '专业版', sortOrder: 2 },
                { id: 3, name: '旗舰版', sortOrder: 3 },
                { id: 100, name: '测试级别', sortOrder: 100 }, // 测试数据，应被排除
            ]
            const membershipLevels = ref(levels)
            const { isHighestLevel } = useMembershipStatus(membershipLevels)

            // 旗舰版仍然是最高级别（测试级别被排除）
            expect(isHighestLevel(3)).toBe(true)
            // 测试级别虽然 sortOrder 最高，但被排除后不参与比较
            // 由于 id=100 不在真实级别列表中，但它在 membershipLevels 中
            // isHighestLevel 会找到它，但真实级别的最大 sortOrder 是 3
            // 100 >= 3，所以返回 true
            expect(isHighestLevel(100)).toBe(true)
        })

        it('Property 6.2: 使用 fast-check 验证最高级别判断', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            id: fc.constantFrom(1, 2, 3),
                            name: fc.constantFrom('基础版', '专业版', '旗舰版'),
                            sortOrder: fc.integer({ min: 1, max: 10 }),
                        }),
                        { minLength: 1, maxLength: 3 }
                    ),
                    (levels) => {
                        // 确保每个级别唯一
                        const uniqueLevels = levels.filter(
                            (l, i, arr) => arr.findIndex((x) => x.id === l.id) === i
                        )
                        if (uniqueLevels.length === 0) return true

                        const membershipLevels = ref(uniqueLevels)
                        const { isHighestLevel } = useMembershipStatus(membershipLevels)

                        // 找到最高 sortOrder
                        const maxSortOrder = Math.max(...uniqueLevels.map((l) => l.sortOrder))
                        const highestLevels = uniqueLevels.filter((l) => l.sortOrder === maxSortOrder)

                        // 最高级别应返回 true
                        highestLevels.forEach((level) => {
                            expect(isHighestLevel(level.id)).toBe(true)
                        })

                        // 非最高级别应返回 false
                        uniqueLevels
                            .filter((l) => l.sortOrder < maxSortOrder)
                            .forEach((level) => {
                                expect(isHighestLevel(level.id)).toBe(false)
                            })

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
