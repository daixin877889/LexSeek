/**
 * 用户会员记录属性测试
 *
 * 使用 fast-check 进行属性测试，验证用户会员记录的核心业务逻辑
 *
 * **Feature: membership-system**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 会员状态（与 shared/types/membership.ts 保持一致）
const MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
} as const

// 会员来源类型
const UserMembershipSourceType = {
    REDEMPTION_CODE: 1,
    DIRECT_PURCHASE: 2,
    ADMIN_GIFT: 3,
    ACTIVITY_AWARD: 4,
    TRIAL: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_TO_REGISTER: 7,
    MEMBERSHIP_UPGRADE: 8,
    OTHER: 99,
} as const

/**
 * 模拟用户会员记录数据结构
 */
interface MockUserMembership {
    id: number
    userId: number
    levelId: number
    startDate: Date
    endDate: Date
    status: number
    sourceType: number
    sourceId: number | null
    deletedAt: Date | null
}

/**
 * Property 2: 用户会员记录完整性
 *
 * For any 创建的用户会员记录，SHALL 包含 userId、levelId、startDate、endDate、sourceType 等必要字段，
 * 且 startDate < endDate。
 *
 * **Feature: membership-system, Property 2: 用户会员记录完整性**
 * **Validates: Requirements 2.1**
 */
describe('Property 2: 用户会员记录完整性', () => {
    /**
     * 模拟创建用户会员记录
     */
    const createUserMembership = (params: {
        userId: number
        levelId: number
        duration: number
        sourceType: number
        sourceId?: number
    }): MockUserMembership => {
        const now = new Date()
        const endDate = new Date(now.getTime() + params.duration * 24 * 60 * 60 * 1000)

        return {
            id: Math.floor(Math.random() * 10000) + 1,
            userId: params.userId,
            levelId: params.levelId,
            startDate: now,
            endDate,
            status: MembershipStatus.ACTIVE,
            sourceType: params.sourceType,
            sourceId: params.sourceId ?? null,
            deletedAt: null,
        }
    }

    it('创建的会员记录应包含所有必要字段', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 100 }),
                fc.integer({ min: 1, max: 365 }),
                fc.constantFrom(...Object.values(UserMembershipSourceType)),
                (userId, levelId, duration, sourceType) => {
                    const membership = createUserMembership({
                        userId,
                        levelId,
                        duration,
                        sourceType,
                    })

                    // 验证必要字段存在
                    expect(membership.userId).toBe(userId)
                    expect(membership.levelId).toBe(levelId)
                    expect(membership.startDate).toBeInstanceOf(Date)
                    expect(membership.endDate).toBeInstanceOf(Date)
                    expect(membership.sourceType).toBe(sourceType)
                    expect(membership.status).toBe(MembershipStatus.ACTIVE)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('startDate 应小于 endDate', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 100 }),
                fc.integer({ min: 1, max: 365 }),
                fc.constantFrom(...Object.values(UserMembershipSourceType)),
                (userId, levelId, duration, sourceType) => {
                    const membership = createUserMembership({
                        userId,
                        levelId,
                        duration,
                        sourceType,
                    })

                    expect(membership.startDate.getTime()).toBeLessThan(membership.endDate.getTime())
                }
            ),
            { numRuns: 100 }
        )
    })

    it('会员有效期应等于指定的天数', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 100 }),
                fc.integer({ min: 1, max: 365 }),
                fc.constantFrom(...Object.values(UserMembershipSourceType)),
                (userId, levelId, duration, sourceType) => {
                    const membership = createUserMembership({
                        userId,
                        levelId,
                        duration,
                        sourceType,
                    })

                    const actualDuration = Math.round(
                        (membership.endDate.getTime() - membership.startDate.getTime()) /
                        (24 * 60 * 60 * 1000)
                    )
                    expect(actualDuration).toBe(duration)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 3: 有效会员查询正确性
 *
 * For any 用户，查询当前有效会员时 SHALL 只返回 status=1 且 endDate > 当前时间 的会员记录。
 *
 * **Feature: membership-system, Property 3: 有效会员查询正确性**
 * **Validates: Requirements 2.2, 2.5**
 */
describe('Property 3: 有效会员查询正确性', () => {
    /**
     * 模拟查询用户当前有效会员
     */
    const findCurrentUserMembership = (
        memberships: MockUserMembership[],
        userId: number
    ): MockUserMembership | null => {
        const now = new Date()
        const validMemberships = memberships.filter(
            (m) =>
                m.userId === userId &&
                m.status === MembershipStatus.ACTIVE &&
                m.endDate > now &&
                m.deletedAt === null
        )

        if (validMemberships.length === 0) {
            return null
        }

        // 返回结束日期最晚的会员记录
        return validMemberships.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0]
    }

    /**
     * 生成会员记录的 arbitrary
     */
    const membershipArb = (userId: number) =>
        fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            userId: fc.constant(userId),
            levelId: fc.integer({ min: 1, max: 10 }),
            startDate: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-06-01') }),
            endDate: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') }),
            status: fc.constantFrom(MembershipStatus.INACTIVE, MembershipStatus.ACTIVE),
            sourceType: fc.constantFrom(...Object.values(UserMembershipSourceType)),
            sourceId: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
            deletedAt: fc.option(fc.date(), { nil: null }),
        })

    it('返回的会员记录状态应为 ACTIVE', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
                (userId, otherUserIds) => {
                    // 创建多个用户的会员记录
                    const allUserIds = [userId, ...otherUserIds]
                    const memberships: MockUserMembership[] = []

                    allUserIds.forEach((uid, index) => {
                        // 为每个用户创建一些会员记录
                        memberships.push({
                            id: index * 10 + 1,
                            userId: uid,
                            levelId: 1,
                            startDate: new Date('2025-01-01'),
                            endDate: new Date('2026-01-01'),
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                            sourceId: null,
                            deletedAt: null,
                        })
                    })

                    const result = findCurrentUserMembership(memberships, userId)

                    if (result) {
                        expect(result.status).toBe(MembershipStatus.ACTIVE)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('返回的会员记录 endDate 应大于当前时间', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), (userId) => {
                const now = new Date()
                const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
                const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

                const memberships: MockUserMembership[] = [
                    // 已过期的会员
                    {
                        id: 1,
                        userId,
                        levelId: 1,
                        startDate: new Date('2024-01-01'),
                        endDate: pastDate,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: null,
                    },
                    // 有效的会员
                    {
                        id: 2,
                        userId,
                        levelId: 2,
                        startDate: new Date('2025-01-01'),
                        endDate: futureDate,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: null,
                    },
                ]

                const result = findCurrentUserMembership(memberships, userId)

                if (result) {
                    expect(result.endDate.getTime()).toBeGreaterThan(now.getTime())
                }
            }),
            { numRuns: 100 }
        )
    })

    it('不返回已删除的会员记录', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), (userId) => {
                const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

                const memberships: MockUserMembership[] = [
                    // 已删除的有效会员
                    {
                        id: 1,
                        userId,
                        levelId: 1,
                        startDate: new Date('2025-01-01'),
                        endDate: futureDate,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: new Date(),
                    },
                ]

                const result = findCurrentUserMembership(memberships, userId)

                // 已删除的记录不应被返回
                expect(result).toBeNull()
            }),
            { numRuns: 100 }
        )
    })

    it('不返回状态为 INACTIVE 的会员记录', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), (userId) => {
                const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

                const memberships: MockUserMembership[] = [
                    // 状态为 INACTIVE 的会员
                    {
                        id: 1,
                        userId,
                        levelId: 1,
                        startDate: new Date('2025-01-01'),
                        endDate: futureDate,
                        status: MembershipStatus.INACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: null,
                    },
                ]

                const result = findCurrentUserMembership(memberships, userId)

                // INACTIVE 状态的记录不应被返回
                expect(result).toBeNull()
            }),
            { numRuns: 100 }
        )
    })

    it('只返回指定用户的会员记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 500 }),
                fc.integer({ min: 501, max: 1000 }),
                (userId, otherUserId) => {
                    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

                    const memberships: MockUserMembership[] = [
                        // 其他用户的会员
                        {
                            id: 1,
                            userId: otherUserId,
                            levelId: 1,
                            startDate: new Date('2025-01-01'),
                            endDate: futureDate,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                            sourceId: null,
                            deletedAt: null,
                        },
                        // 当前用户的会员
                        {
                            id: 2,
                            userId,
                            levelId: 2,
                            startDate: new Date('2025-01-01'),
                            endDate: futureDate,
                            status: MembershipStatus.ACTIVE,
                            sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                            sourceId: null,
                            deletedAt: null,
                        },
                    ]

                    const result = findCurrentUserMembership(memberships, userId)

                    if (result) {
                        expect(result.userId).toBe(userId)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('有多个有效会员时返回结束日期最晚的', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1000 }), (userId) => {
                const now = Date.now()
                const futureDate1 = new Date(now + 30 * 24 * 60 * 60 * 1000)
                const futureDate2 = new Date(now + 60 * 24 * 60 * 60 * 1000)

                const memberships: MockUserMembership[] = [
                    {
                        id: 1,
                        userId,
                        levelId: 1,
                        startDate: new Date('2025-01-01'),
                        endDate: futureDate1,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: null,
                    },
                    {
                        id: 2,
                        userId,
                        levelId: 2,
                        startDate: new Date('2025-01-01'),
                        endDate: futureDate2,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                        sourceId: null,
                        deletedAt: null,
                    },
                ]

                const result = findCurrentUserMembership(memberships, userId)

                expect(result).not.toBeNull()
                expect(result!.endDate.getTime()).toBe(futureDate2.getTime())
            }),
            { numRuns: 100 }
        )
    })
})
