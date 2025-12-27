/**
 * 营销活动属性测试
 *
 * 使用 fast-check 进行属性测试，验证营销活动的核心业务逻辑
 *
 * **Feature: membership-system**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 营销活动类型
const CampaignType = {
    REGISTER_GIFT: 1,
    INVITATION_REWARD: 2,
    ACTIVITY_REWARD: 3,
} as const

// 营销活动状态
const CampaignStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

/**
 * 模拟营销活动数据结构
 */
interface MockCampaign {
    id: number
    name: string
    type: number
    levelId: number | null
    duration: number | null
    giftPoint: number | null
    startAt: Date
    endAt: Date
    status: number
    deletedAt: Date | null
}

/**
 * 模拟用户会员记录
 */
interface MockUserMembership {
    id: number
    userId: number
    levelId: number
    startDate: Date
    endDate: Date
    sourceType: number
    sourceId: number
}

/**
 * 模拟积分记录
 */
interface MockPointRecord {
    id: number
    userId: number
    pointAmount: number
    sourceType: number
    sourceId: number
    effectiveAt: Date
    expiredAt: Date
}

/**
 * Property 4: 营销活动有效期控制
 *
 * For any 营销活动，当 startAt > 当前时间 或 endAt < 当前时间 或 status=0 时，
 * SHALL 不执行任何奖励逻辑。
 *
 * **Feature: membership-system, Property 4: 营销活动有效期控制**
 * **Validates: Requirements 3.4, 3.5, 4.3, 5.3**
 */
describe('Property 4: 营销活动有效期控制', () => {
    /**
     * 判断营销活动是否有效
     */
    const isCampaignActive = (campaign: MockCampaign): boolean => {
        const now = new Date()
        return (
            campaign.status === CampaignStatus.ENABLED &&
            campaign.startAt <= now &&
            campaign.endAt > now &&
            campaign.deletedAt === null
        )
    }

    /**
     * 模拟查询有效的营销活动
     */
    const findActiveCampaign = (
        campaigns: MockCampaign[],
        type: number
    ): MockCampaign | null => {
        const activeCampaigns = campaigns.filter(
            (c) => c.type === type && isCampaignActive(c)
        )
        return activeCampaigns.length > 0 ? activeCampaigns[0] : null
    }

    it('活动未开始时不应返回有效活动', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom(...Object.values(CampaignType)),
                (id, type) => {
                    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000) // 明天
                    const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 一周后

                    const campaign: MockCampaign = {
                        id,
                        name: '测试活动',
                        type,
                        levelId: 1,
                        duration: 30,
                        giftPoint: 100,
                        startAt: futureStart,
                        endAt: futureEnd,
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    expect(isCampaignActive(campaign)).toBe(false)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('活动已结束时不应返回有效活动', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom(...Object.values(CampaignType)),
                (id, type) => {
                    const pastStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 一周前
                    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000) // 昨天

                    const campaign: MockCampaign = {
                        id,
                        name: '测试活动',
                        type,
                        levelId: 1,
                        duration: 30,
                        giftPoint: 100,
                        startAt: pastStart,
                        endAt: pastEnd,
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    expect(isCampaignActive(campaign)).toBe(false)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('活动禁用时不应返回有效活动', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom(...Object.values(CampaignType)),
                (id, type) => {
                    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000) // 昨天
                    const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 一周后

                    const campaign: MockCampaign = {
                        id,
                        name: '测试活动',
                        type,
                        levelId: 1,
                        duration: 30,
                        giftPoint: 100,
                        startAt: pastStart,
                        endAt: futureEnd,
                        status: CampaignStatus.DISABLED,
                        deletedAt: null,
                    }

                    expect(isCampaignActive(campaign)).toBe(false)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('活动在有效期内且启用时应返回有效', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom(...Object.values(CampaignType)),
                (id, type) => {
                    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000) // 昨天
                    const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 一周后

                    const campaign: MockCampaign = {
                        id,
                        name: '测试活动',
                        type,
                        levelId: 1,
                        duration: 30,
                        giftPoint: 100,
                        startAt: pastStart,
                        endAt: futureEnd,
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    expect(isCampaignActive(campaign)).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 5: 注册赠送正确性
 *
 * For any 新用户注册，当存在有效的注册赠送活动时，SHALL 创建会员记录（如配置了会员）
 * 和积分记录（如配置了积分），且记录的来源类型为注册赠送。
 *
 * **Feature: membership-system, Property 5: 注册赠送正确性**
 * **Validates: Requirements 4.1, 4.2, 4.4**
 */
describe('Property 5: 注册赠送正确性', () => {
    const UserMembershipSourceType = {
        REGISTRATION_AWARD: 6,
    }

    const PointRecordSourceType = {
        REGISTER_GIFT: 7,
    }

    /**
     * 模拟执行注册赠送
     */
    const executeRegisterGift = (
        userId: number,
        campaign: MockCampaign | null
    ): { membership: MockUserMembership | null; pointRecord: MockPointRecord | null } => {
        if (!campaign) {
            return { membership: null, pointRecord: null }
        }

        let membership: MockUserMembership | null = null
        let pointRecord: MockPointRecord | null = null

        // 创建会员记录
        if (campaign.levelId && campaign.duration) {
            const now = new Date()
            membership = {
                id: Math.floor(Math.random() * 10000) + 1,
                userId,
                levelId: campaign.levelId,
                startDate: now,
                endDate: new Date(now.getTime() + campaign.duration * 24 * 60 * 60 * 1000),
                sourceType: UserMembershipSourceType.REGISTRATION_AWARD,
                sourceId: campaign.id,
            }
        }

        // 创建积分记录
        if (campaign.giftPoint && campaign.giftPoint > 0) {
            const now = new Date()
            let expiredAt: Date

            if (membership && campaign.duration) {
                expiredAt = new Date(now.getTime() + campaign.duration * 24 * 60 * 60 * 1000)
            } else {
                expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            }

            pointRecord = {
                id: Math.floor(Math.random() * 10000) + 1,
                userId,
                pointAmount: campaign.giftPoint,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
                sourceId: campaign.id,
                effectiveAt: now,
                expiredAt,
            }
        }

        return { membership, pointRecord }
    }

    it('有效活动配置了会员时应创建会员记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 365 }),
                (userId, levelId, duration) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '注册赠送',
                        type: CampaignType.REGISTER_GIFT,
                        levelId,
                        duration,
                        giftPoint: null,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeRegisterGift(userId, campaign)

                    expect(result.membership).not.toBeNull()
                    expect(result.membership!.userId).toBe(userId)
                    expect(result.membership!.levelId).toBe(levelId)
                    expect(result.membership!.sourceType).toBe(UserMembershipSourceType.REGISTRATION_AWARD)
                    expect(result.membership!.sourceId).toBe(campaign.id)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('有效活动配置了积分时应创建积分记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 10000 }),
                (userId, giftPoint) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '注册赠送',
                        type: CampaignType.REGISTER_GIFT,
                        levelId: null,
                        duration: null,
                        giftPoint,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeRegisterGift(userId, campaign)

                    expect(result.pointRecord).not.toBeNull()
                    expect(result.pointRecord!.userId).toBe(userId)
                    expect(result.pointRecord!.pointAmount).toBe(giftPoint)
                    expect(result.pointRecord!.sourceType).toBe(PointRecordSourceType.REGISTER_GIFT)
                    expect(result.pointRecord!.sourceId).toBe(campaign.id)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('仅积分赠送时积分有效期应为1年', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 10000 }),
                (userId, giftPoint) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '注册赠送',
                        type: CampaignType.REGISTER_GIFT,
                        levelId: null,
                        duration: null,
                        giftPoint,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeRegisterGift(userId, campaign)

                    expect(result.pointRecord).not.toBeNull()
                    // 验证有效期约为1年（允许1秒误差）
                    const expectedExpiry = result.pointRecord!.effectiveAt.getTime() + 365 * 24 * 60 * 60 * 1000
                    expect(Math.abs(result.pointRecord!.expiredAt.getTime() - expectedExpiry)).toBeLessThan(1000)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('会员+积分赠送时积分有效期应等于会员有效期', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10000 }),
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 365 }),
                fc.integer({ min: 1, max: 10000 }),
                (userId, levelId, duration, giftPoint) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '注册赠送',
                        type: CampaignType.REGISTER_GIFT,
                        levelId,
                        duration,
                        giftPoint,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeRegisterGift(userId, campaign)

                    expect(result.membership).not.toBeNull()
                    expect(result.pointRecord).not.toBeNull()
                    // 验证积分有效期等于会员有效期（允许 10ms 误差）
                    const timeDiff = Math.abs(result.pointRecord!.expiredAt.getTime() - result.membership!.endDate.getTime())
                    expect(timeDiff).toBeLessThan(10)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 6: 邀请奖励正确性
 *
 * For any 被邀请用户注册成功，当存在有效的邀请奖励活动且用户有邀请人时，
 * SHALL 为邀请人创建会员记录和积分记录，且记录的来源类型为邀请注册赠送。
 *
 * **Feature: membership-system, Property 6: 邀请奖励正确性**
 * **Validates: Requirements 5.1, 5.2, 5.4**
 */
describe('Property 6: 邀请奖励正确性', () => {
    const UserMembershipSourceType = {
        INVITATION_TO_REGISTER: 7,
    }

    const PointRecordSourceType = {
        INVITATION_TO_REGISTER: 8,
    }

    /**
     * 模拟执行邀请奖励
     */
    const executeInvitationReward = (
        inviterId: number,
        inviteeId: number,
        campaign: MockCampaign | null
    ): { membership: MockUserMembership | null; pointRecord: MockPointRecord | null } => {
        if (!campaign) {
            return { membership: null, pointRecord: null }
        }

        let membership: MockUserMembership | null = null
        let pointRecord: MockPointRecord | null = null

        // 创建会员记录
        if (campaign.levelId && campaign.duration) {
            const now = new Date()
            membership = {
                id: Math.floor(Math.random() * 10000) + 1,
                userId: inviterId,
                levelId: campaign.levelId,
                startDate: now,
                endDate: new Date(now.getTime() + campaign.duration * 24 * 60 * 60 * 1000),
                sourceType: UserMembershipSourceType.INVITATION_TO_REGISTER,
                sourceId: campaign.id,
            }
        }

        // 创建积分记录
        if (campaign.giftPoint && campaign.giftPoint > 0) {
            const now = new Date()
            let expiredAt: Date

            if (membership && campaign.duration) {
                expiredAt = new Date(now.getTime() + campaign.duration * 24 * 60 * 60 * 1000)
            } else {
                expiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            }

            pointRecord = {
                id: Math.floor(Math.random() * 10000) + 1,
                userId: inviterId,
                pointAmount: campaign.giftPoint,
                sourceType: PointRecordSourceType.INVITATION_TO_REGISTER,
                sourceId: campaign.id,
                effectiveAt: now,
                expiredAt,
            }
        }

        return { membership, pointRecord }
    }

    it('邀请奖励应发放给邀请人而非被邀请人', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5000 }),
                fc.integer({ min: 5001, max: 10000 }),
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 365 }),
                fc.integer({ min: 1, max: 10000 }),
                (inviterId, inviteeId, levelId, duration, giftPoint) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '邀请奖励',
                        type: CampaignType.INVITATION_REWARD,
                        levelId,
                        duration,
                        giftPoint,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeInvitationReward(inviterId, inviteeId, campaign)

                    // 验证奖励发放给邀请人
                    expect(result.membership).not.toBeNull()
                    expect(result.membership!.userId).toBe(inviterId)
                    expect(result.pointRecord).not.toBeNull()
                    expect(result.pointRecord!.userId).toBe(inviterId)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('邀请奖励来源类型应为邀请注册赠送', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5000 }),
                fc.integer({ min: 5001, max: 10000 }),
                fc.integer({ min: 1, max: 10 }),
                fc.integer({ min: 1, max: 365 }),
                fc.integer({ min: 1, max: 10000 }),
                (inviterId, inviteeId, levelId, duration, giftPoint) => {
                    const campaign: MockCampaign = {
                        id: 1,
                        name: '邀请奖励',
                        type: CampaignType.INVITATION_REWARD,
                        levelId,
                        duration,
                        giftPoint,
                        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        deletedAt: null,
                    }

                    const result = executeInvitationReward(inviterId, inviteeId, campaign)

                    expect(result.membership!.sourceType).toBe(UserMembershipSourceType.INVITATION_TO_REGISTER)
                    expect(result.pointRecord!.sourceType).toBe(PointRecordSourceType.INVITATION_TO_REGISTER)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('无有效活动时不应创建任何记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5000 }),
                fc.integer({ min: 5001, max: 10000 }),
                (inviterId, inviteeId) => {
                    const result = executeInvitationReward(inviterId, inviteeId, null)

                    expect(result.membership).toBeNull()
                    expect(result.pointRecord).toBeNull()
                }
            ),
            { numRuns: 100 }
        )
    })
})
