/**
 * 邀请注册奖励集成测试
 *
 * 测试场景：
 * - 有邀请人且活动有效 → 邀请人获得奖励
 * - 无邀请人 → 不创建奖励
 * - 活动未开始 → 不创建奖励
 * - 活动已结束 → 不创建奖励
 * - 活动禁用 → 不创建奖励
 *
 * **Feature: membership-system**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createCampaign,
    CampaignType,
    UserMembershipSourceType,
} from './membership-test-fixtures'
import {
    isCampaignActive,
    simulateInvitationReward,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('邀请注册奖励集成测试', () => {
    describe('邀请奖励执行', () => {
        it('有邀请人且活动有效时邀请人应获得奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (inviterId, duration, giftPoint) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration,
                            giftPoint,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(inviterId)
                        expect(result.membership?.levelId).toBe(1)
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动未开始时不应创建奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (inviterId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysFromNow(10), // 未开始
                            endAt: daysFromNow(40),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动已结束时不应创建奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (inviterId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysAgo(40),
                            endAt: daysAgo(10), // 已结束
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('活动禁用时不应创建奖励', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (inviterId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 0, // 禁用
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('邀请奖励来源类型', () => {
        it('邀请奖励创建的会员记录来源类型应为邀请注册赠送', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (inviterId) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration: 30,
                            giftPoint: 100,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.sourceType).toBe(
                            UserMembershipSourceType.INVITATION_TO_REGISTER
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 6: 邀请奖励正确性', () => {
        it('有效活动且有邀请人时应为邀请人创建会员和积分记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (inviterId, duration, giftPoint) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration,
                            giftPoint,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        // 验证会员记录
                        expect(result.membership).not.toBeNull()
                        expect(result.membership?.userId).toBe(inviterId)
                        expect(result.membership?.sourceType).toBe(
                            UserMembershipSourceType.INVITATION_TO_REGISTER
                        )

                        // 验证积分
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('只配置会员时只创建会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (inviterId, duration) => {
                        const level = createMembershipLevel({ id: 1 })
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: 1,
                            duration,
                            giftPoint: null, // 不配置积分
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            level
                        )

                        expect(result.membership).not.toBeNull()
                        expect(result.points).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('只配置积分时只创建积分记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 1000 }),
                    (inviterId, giftPoint) => {
                        const campaign = createCampaign({
                            type: CampaignType.INVITATION_REWARD,
                            levelId: null, // 不配置会员
                            duration: null,
                            giftPoint,
                            startAt: daysAgo(10),
                            endAt: daysFromNow(10),
                            status: 1,
                        })

                        const result = simulateInvitationReward(
                            inviterId,
                            campaign,
                            null
                        )

                        expect(result.membership).toBeNull()
                        expect(result.points).toBe(giftPoint)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
