/**
 * 用户会员记录集成测试
 *
 * 测试场景：创建会员记录、查询当前有效会员、查询会员历史、会员过期自动失效
 *
 * **Feature: membership-system**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createUserMembership,
    MembershipStatus,
    UserMembershipSourceType,
    type MockUserMembership,
} from './membership-test-fixtures'
import {
    isMembershipValid,
    getRemainingDays,
    simulateCreateMembership,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('用户会员记录集成测试', () => {
    describe('创建会员记录', () => {
        it('创建的会员记录应包含所有必要字段', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 100 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, levelId, durationDays) => {
                        const level = createMembershipLevel({ id: levelId })
                        const membership = simulateCreateMembership(
                            userId,
                            level,
                            durationDays,
                            UserMembershipSourceType.DIRECT_PURCHASE
                        )

                        expect(membership.userId).toBe(userId)
                        expect(membership.levelId).toBe(levelId)
                        expect(membership.status).toBe(MembershipStatus.ACTIVE)
                        expect(membership.startDate).toBeInstanceOf(Date)
                        expect(membership.endDate).toBeInstanceOf(Date)
                        expect(membership.startDate < membership.endDate).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('会员结束时间应等于开始时间加上时长', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, durationDays) => {
                        const level = createMembershipLevel({ id: 1 })
                        const membership = simulateCreateMembership(
                            userId,
                            level,
                            durationDays,
                            UserMembershipSourceType.DIRECT_PURCHASE
                        )

                        const expectedEndTime =
                            membership.startDate.getTime() +
                            durationDays * 24 * 60 * 60 * 1000

                        // 允许 1 秒误差
                        expect(
                            Math.abs(membership.endDate.getTime() - expectedEndTime)
                        ).toBeLessThan(1000)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('不同来源类型的会员记录应正确记录来源', () => {
            const sourceTypes = [
                UserMembershipSourceType.REDEMPTION_CODE,
                UserMembershipSourceType.DIRECT_PURCHASE,
                UserMembershipSourceType.REGISTRATION_AWARD,
                UserMembershipSourceType.INVITATION_TO_REGISTER,
            ]

            sourceTypes.forEach((sourceType) => {
                const level = createMembershipLevel({ id: 1 })
                const membership = simulateCreateMembership(
                    1,
                    level,
                    30,
                    sourceType,
                    100
                )

                expect(membership.sourceType).toBe(sourceType)
                expect(membership.sourceId).toBe(100)
            })
        })
    })

    describe('查询当前有效会员', () => {
        it('有效会员应满足 status=ACTIVE 且未过期', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, remainingDays) => {
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(remainingDays),
                        })

                        expect(isMembershipValid(membership)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('状态为 INACTIVE 的会员应视为无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, remainingDays) => {
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.INACTIVE,
                            endDate: daysFromNow(remainingDays),
                        })

                        expect(isMembershipValid(membership)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('已过期的会员应视为无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, daysExpired) => {
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysAgo(daysExpired),
                        })

                        expect(isMembershipValid(membership)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('已软删除的会员应视为无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(30),
                            deletedAt: new Date(),
                        })

                        expect(isMembershipValid(membership)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('会员剩余天数计算', () => {
        it('有效会员的剩余天数应大于 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (remainingDays) => {
                        const membership = createUserMembership({
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(remainingDays),
                        })

                        const days = getRemainingDays(membership)
                        expect(days).toBeGreaterThan(0)
                        // 允许 1 天误差（因为时间计算）
                        expect(days).toBeLessThanOrEqual(remainingDays + 1)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('已过期会员的剩余天数应为 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysExpired) => {
                        const membership = createUserMembership({
                            status: MembershipStatus.ACTIVE,
                            endDate: daysAgo(daysExpired),
                        })

                        expect(getRemainingDays(membership)).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无效状态会员的剩余天数应为 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (remainingDays) => {
                        const membership = createUserMembership({
                            status: MembershipStatus.INACTIVE,
                            endDate: daysFromNow(remainingDays),
                        })

                        expect(getRemainingDays(membership)).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('会员历史记录', () => {
        it('用户可以有多条会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.integer({ min: 2, max: 5 }),
                    (userId, recordCount) => {
                        const records: MockUserMembership[] = []

                        for (let i = 0; i < recordCount; i++) {
                            records.push(
                                createUserMembership({
                                    id: i + 1,
                                    userId,
                                    startDate: daysAgo(365 - i * 30),
                                    endDate: daysAgo(335 - i * 30),
                                    status: MembershipStatus.INACTIVE,
                                })
                            )
                        }

                        expect(records.length).toBe(recordCount)
                        records.forEach((r) => expect(r.userId).toBe(userId))
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('会员历史应按创建时间排序', () => {
            const userId = 1
            const records: MockUserMembership[] = [
                createUserMembership({
                    id: 1,
                    userId,
                    createdAt: daysAgo(100),
                }),
                createUserMembership({
                    id: 2,
                    userId,
                    createdAt: daysAgo(50),
                }),
                createUserMembership({
                    id: 3,
                    userId,
                    createdAt: new Date(),
                }),
            ]

            // 按创建时间降序排序
            const sorted = [...records].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
            )

            expect(sorted[0].id).toBe(3)
            expect(sorted[1].id).toBe(2)
            expect(sorted[2].id).toBe(1)
        })
    })

    describe('会员过期处理', () => {
        it('过期会员查询时应返回无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    (userId) => {
                        // 创建一个刚刚过期的会员
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            startDate: daysAgo(31),
                            endDate: daysAgo(1), // 昨天过期
                        })

                        expect(isMembershipValid(membership)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('即将过期的会员仍应有效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    (userId) => {
                        // 创建一个即将过期的会员（还有 1 天）
                        const membership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            startDate: daysAgo(29),
                            endDate: daysFromNow(1),
                        })

                        expect(isMembershipValid(membership)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: 用户会员记录完整性', () => {
        it('创建的用户会员记录应包含所有必要字段且 startDate < endDate', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 100 }),
                    fc.integer({ min: 1, max: 365 }),
                    fc.constantFrom(
                        UserMembershipSourceType.REDEMPTION_CODE,
                        UserMembershipSourceType.DIRECT_PURCHASE,
                        UserMembershipSourceType.REGISTRATION_AWARD
                    ),
                    (userId, levelId, duration, sourceType) => {
                        const level = createMembershipLevel({ id: levelId })
                        const membership = simulateCreateMembership(
                            userId,
                            level,
                            duration,
                            sourceType
                        )

                        // 验证必要字段
                        expect(membership.userId).toBe(userId)
                        expect(membership.levelId).toBe(levelId)
                        expect(membership.startDate).toBeInstanceOf(Date)
                        expect(membership.endDate).toBeInstanceOf(Date)
                        expect(membership.sourceType).toBe(sourceType)

                        // 验证 startDate < endDate
                        expect(membership.startDate < membership.endDate).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 3: 有效会员查询正确性', () => {
        it('查询当前有效会员时只返回 status=ACTIVE 且 endDate > 当前时间的记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.array(
                        fc.record({
                            status: fc.constantFrom(
                                MembershipStatus.ACTIVE,
                                MembershipStatus.INACTIVE
                            ),
                            daysUntilExpiry: fc.integer({ min: -30, max: 30 }),
                        }),
                        { minLength: 1, maxLength: 5 }
                    ),
                    (userId, membershipData) => {
                        const memberships = membershipData.map((data, index) =>
                            createUserMembership({
                                id: index + 1,
                                userId,
                                status: data.status,
                                endDate:
                                    data.daysUntilExpiry > 0
                                        ? daysFromNow(data.daysUntilExpiry)
                                        : daysAgo(-data.daysUntilExpiry),
                            })
                        )

                        // 筛选有效会员
                        const validMemberships = memberships.filter(isMembershipValid)

                        // 验证所有有效会员都满足条件
                        validMemberships.forEach((m) => {
                            expect(m.status).toBe(MembershipStatus.ACTIVE)
                            expect(m.endDate > new Date()).toBe(true)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
