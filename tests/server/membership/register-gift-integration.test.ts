/**
 * 注册赠送集成测试
 *
 * 测试场景：
 * - 有效活动期内注册 → 获得会员和积分
 * - 活动未开始时注册 → 不获得奖励
 * - 活动已结束时注册 → 不获得奖励
 * - 活动禁用时注册 → 不获得奖励
 * - 只配置会员不配置积分 → 只获得会员
 * - 只配置积分不配置会员 → 只获得积分
 *
 * **Feature: membership-system**
 * **Validates: Requirements 3.4, 3.5, 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createCampaign,
    CampaignType,
    type MockCampaign,
} from './membership-test-fixtures'
import {
    isCampaignActive,
    simulateRegisterGift,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('注册赠送集成测试', () => {
    describe('营销活动有效期验证', () => {
        it('活动在有效期内应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 30 }),
                    fc.integer({ min: 1, max: 30 }),
                    (daysStarted, daysRemaining) => {
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            startAt: daysAgo(daysStarted),
                            endAt: daysFromNow(daysRemaining),
                            status: 1,
                        })

                        expect(isCampaignActive(campaign)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动未开始应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 30 }),
                    (daysUntilStart) => {
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            startAt: daysFromNow(daysUntilStart),
                            endAt: daysFromNow(daysUntilStart + 30),
                            status: 1,
                        })

                        expect(isCampaignActive(campaign)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动已结束应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 30 }),
                    (daysEnded) => {
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            startAt: daysAgo(daysEnded + 30),
                            endAt: daysAgo(daysEnded),
                            status: 1,
                        })

                        expect(isCampaignActive(campaign)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动禁用应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 30 }),
                    (daysRemaining) => {
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(daysRemaining),
                            status: 0, // 禁用
                        })

                        expect(isCampaignActive(campaign)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('注册赠送执行', () => {
        it('有效活动期内注册应获得会员和积分', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (userId, duration, giftPoint) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration,
                            giftPoint,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(userId)
                        expect(result.membership?.levelId).toBe(1)
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动未开始时注册不应获得奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysFromNow(10), // 未开始
                            endAt: daysFromNow(40),
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动已结束时注册不应获得奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysAgo(40),
                            endAt: daysAgo(10), // 已结束
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动禁用时注册不应获得奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 0, // 禁用
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('只配置会员不配置积分时只获得会员', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, duration) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration,
                            giftPoint: null, // 不配置积分
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).not.toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('只配置积分不配置会员时只获得积分', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (userId, giftPoint) => {
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: null, // 不配置会员
                            duration: null,
                            giftPoint,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, null)

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 4: 营销活动有效期控制', () => {
        it('当 startAt > 当前时间时不执行奖励逻辑', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 100 }),
                    (userId, daysUntilStart) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            startAt: daysFromNow(daysUntilStart),
                            endAt: daysFromNow(daysUntilStart + 30),
                            status: 1,
                        })

                        expect(isCampaignActive(campaign)).toBe(false)

                        const result = simulateRegisterGift(userId, campaign, level)
                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('当 endAt < 当前时间时不执行奖励逻辑', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 100 }),
                    (userId, daysEnded) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            startAt: daysAgo(daysEnded + 30),
                            endAt: daysAgo(daysEnded),
                            status: 1,
                        })

                        expect(isCampaignActive(campaign)).toBe(false)

                        const result = simulateRegisterGift(userId, campaign, level)
                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('当 status=0 时不执行奖励逻辑', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 0,
                        })

                        expect(isCampaignActive(campaign)).toBe(false)

                        const result = simulateRegisterGift(userId, campaign, level)
                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 5: 注册赠送正确性', () => {
        it('有效活动时创建的会员记录来源类型应为注册赠送', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, duration) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.REGISTER_GIFT,
                            levelId: 1,
                            duration,
                            giftPoint: 100,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateRegisterGift(userId, campaign, level)

                        expect(result.membership).not.toBeNull()
                        // 来源类型应为注册赠送（6）
                        expect(result.membership?.sourceType).toBe(6)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
