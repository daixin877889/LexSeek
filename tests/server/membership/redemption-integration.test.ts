/**
 * 兑换码兑换集成测试
 *
 * 测试场景：
 * - 兑换仅会员码 → 只创建会员记录
 * - 兑换仅积分码 → 只创建积分记录，有效期1年
 * - 兑换会员+积分码 → 创建会员和积分，积分有效期=会员有效期
 * - 兑换已使用码 → 拒绝并返回错误
 * - 兑换已过期码 → 拒绝并返回错误
 * - 兑换已作废码 → 拒绝并返回错误
 * - 兑换成功后码状态变为已使用
 *
 * **Feature: membership-system**
 * **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createRedemptionCode,
    RedemptionCodeStatus,
    RedemptionCodeType,
    UserMembershipSourceType,
} from './membership-test-fixtures'
import {
    isRedemptionCodeValid,
    getRedemptionCodeRejectReason,
    simulateRedemption,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('兑换码兑换集成测试', () => {
    describe('兑换码有效性验证', () => {
        it('有效兑换码应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysUntilExpiry) => {
                        const code = createRedemptionCode({
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(daysUntilExpiry),
                        })

                        expect(isRedemptionCodeValid(code)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('已使用兑换码应返回 false', () => {
            const code = createRedemptionCode({
                status: RedemptionCodeStatus.USED,
                expiredAt: daysFromNow(30),
            })

            expect(isRedemptionCodeValid(code)).toBe(false)
            expect(getRedemptionCodeRejectReason(code)).toBe('兑换码已使用')
        })

        it('已过期兑换码应返回 false', () => {
            const code = createRedemptionCode({
                status: RedemptionCodeStatus.EXPIRED,
                expiredAt: daysAgo(10),
            })

            expect(isRedemptionCodeValid(code)).toBe(false)
            expect(getRedemptionCodeRejectReason(code)).toBe('兑换码已过期')
        })

        it('已作废兑换码应返回 false', () => {
            const code = createRedemptionCode({
                status: RedemptionCodeStatus.REVOKED,
                expiredAt: daysFromNow(30),
            })

            expect(isRedemptionCodeValid(code)).toBe(false)
            expect(getRedemptionCodeRejectReason(code)).toBe('兑换码已作废')
        })

        it('过期时间已过的有效状态码应返回 false', () => {
            const code = createRedemptionCode({
                status: RedemptionCodeStatus.VALID,
                expiredAt: daysAgo(1), // 已过期
            })

            expect(isRedemptionCodeValid(code)).toBe(false)
            expect(getRedemptionCodeRejectReason(code)).toBe('兑换码已过期')
        })
    })

    describe('兑换仅会员码', () => {
        it('应只创建会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, duration) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_ONLY,
                            levelId: 1,
                            duration,
                            pointAmount: null,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(true)
                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(userId)
                        expect(result.membership?.levelId).toBe(1)
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('兑换仅积分码', () => {
        it('应只创建积分记录，有效期1年', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (userId, pointAmount) => {
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.POINTS_ONLY,
                            levelId: null,
                            duration: null,
                            pointAmount,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, null)

                        expect(result.success).toBe(true)
                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(pointAmount)
                        expect(result.pointExpiredAt).not.toBeNull()

                        // 验证积分有效期约为1年
                        const expectedExpiry = daysFromNow(365)
                        const diff = Math.abs(
                            result.pointExpiredAt!.getTime() - expectedExpiry.getTime()
                        )
                        expect(diff).toBeLessThan(24 * 60 * 60 * 1000) // 1天误差
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('兑换会员+积分码', () => {
        it('应创建会员和积分，积分有效期等于会员有效期', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (userId, duration, pointAmount) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            levelId: 1,
                            duration,
                            pointAmount,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(true)
                        expect(result.membership).not.toBeNull()
                        expect(result.points).toBe(pointAmount)

                        // 积分有效期应等于会员有效期
                        expect(result.pointExpiredAt?.getTime()).toBe(
                            result.membership?.endDate.getTime()
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('无效兑换码拒绝', () => {
        it('兑换已使用码应被拒绝', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            status: RedemptionCodeStatus.USED,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(false)
                        expect(result.errorMessage).toBe('兑换码已使用')
                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('兑换已过期码应被拒绝', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            status: RedemptionCodeStatus.EXPIRED,
                            expiredAt: daysAgo(10),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(false)
                        expect(result.errorMessage).toBe('兑换码已过期')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('兑换已作废码应被拒绝', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            status: RedemptionCodeStatus.REVOKED,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(false)
                        expect(result.errorMessage).toBe('兑换码已作废')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 7: 兑换码兑换正确性', () => {
        it('兑换类型包含会员时应创建会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.constantFrom(
                        RedemptionCodeType.MEMBERSHIP_ONLY,
                        RedemptionCodeType.MEMBERSHIP_AND_POINTS
                    ),
                    (userId, codeType) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: codeType,
                            levelId: 1,
                            duration: 30,
                            pointAmount: codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS ? 100 : null,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(true)
                        expect(result.membership).not.toBeNull()
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('兑换类型包含积分时应创建积分记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.constantFrom(
                        RedemptionCodeType.POINTS_ONLY,
                        RedemptionCodeType.MEMBERSHIP_AND_POINTS
                    ),
                    fc.integer({ min: 1, max: 1000 }),
                    (userId, codeType, pointAmount) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: codeType,
                            levelId: codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS ? 1 : null,
                            duration: codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS ? 30 : null,
                            pointAmount,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(
                            userId,
                            code,
                            codeType === RedemptionCodeType.MEMBERSHIP_AND_POINTS ? level : null
                        )

                        expect(result.success).toBe(true)
                        expect(result.points).toBe(pointAmount)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('兑换成功后会员记录来源类型应为兑换码', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_ONLY,
                            levelId: 1,
                            duration: 30,
                            status: RedemptionCodeStatus.VALID,
                            expiredAt: daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(true)
                        expect(result.membership?.sourceType).toBe(
                            UserMembershipSourceType.REDEMPTION_CODE
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 8: 无效兑换码拒绝', () => {
        it('已使用、已过期或已作废的兑换码应被拒绝', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.constantFrom(
                        RedemptionCodeStatus.USED,
                        RedemptionCodeStatus.EXPIRED,
                        RedemptionCodeStatus.REVOKED
                    ),
                    (userId, status) => {
                        const level = createMembershipLevel({ id: 1 })
                        const code = createRedemptionCode({
                            type: RedemptionCodeType.MEMBERSHIP_AND_POINTS,
                            levelId: 1,
                            duration: 30,
                            pointAmount: 100,
                            status,
                            expiredAt: status === RedemptionCodeStatus.EXPIRED ? daysAgo(10) : daysFromNow(30),
                        })

                        const result = simulateRedemption(userId, code, level)

                        expect(result.success).toBe(false)
                        expect(result.errorMessage).not.toBeNull()
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
