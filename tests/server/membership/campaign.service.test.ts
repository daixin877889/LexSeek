/**
 * 营销活动服务层补充测试
 *
 * 测试 campaign.service.ts 中未被 campaign.test.ts 覆盖的函数
 * 包括：executeRegisterGiftService, executeInvitationRewardService,
 * createCampaignService, updateCampaignService, toggleCampaignStatusService,
 * getCampaignByIdService, getCampaignsForAdminService, deleteCampaignService
 *
 * **Feature: membership-campaign**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestUser,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    type TestIds,
} from './test-db-helper'
import { CampaignType, CampaignStatus } from '../../../shared/types/campaign'

// 导入 DAO 函数
import {
    findCampaignByIdDao,
} from '../../../server/services/campaign/campaign.dao'

// 导入 Service 函数（仅测试未在 campaign.test.ts 中覆盖的）
import {
    executeRegisterGiftService,
    executeInvitationRewardService,
    getCampaignByIdService,
    getCampaignsForAdminService,
    createCampaignService,
    updateCampaignService,
    toggleCampaignStatusService,
    deleteCampaignService,
} from '../../../server/services/campaign/campaign.service'

describe('营销活动服务层补充测试', () => {
    const testIds: TestIds = createEmptyTestIds()

    beforeAll(async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.warn('数据库不可用，跳过测试')
        } else {
            await resetDatabaseSequences()
        }
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
        testIds.userIds = []
        testIds.membershipLevelIds = []
        testIds.campaignIds = []
        testIds.userMembershipIds = []
        testIds.pointRecordIds = []
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    // ==================== getCampaignByIdService ====================

    describe('getCampaignByIdService - 获取营销活动详情', () => {
        it('应返回存在的活动', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_详情' })
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: '测试活动_详情',
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    duration: 30,
                    giftPoint: 100,
                    startAt,
                    endAt,
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const info = await getCampaignByIdService(campaign.id)

            expect(info).not.toBeNull()
            expect(info!.id).toBe(campaign.id)
            expect(info!.name).toBe('测试活动_详情')
            expect(info!.type).toBe(CampaignType.REGISTER_GIFT)
            expect(info!.status).toBe(CampaignStatus.ENABLED)
        })

        it('不存在的 ID 应返回 null', async () => {
            const info = await getCampaignByIdService(999999)
            expect(info).toBeNull()
        })

        it('返回格式应包含 levelName', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_levelName' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: '测试活动_levelName',
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const info = await getCampaignByIdService(campaign.id)

            expect(info!.levelName).toBe('测试级别_levelName')
        })
    })

    // ==================== getCampaignsForAdminService ====================

    describe('getCampaignsForAdminService - 管理后台列表', () => {
        it('应返回分页结果', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_后台列表' })
            testIds.membershipLevelIds.push(level.id)

            for (let i = 0; i < 3; i++) {
                const prisma = getTestPrisma()
                const c = await prisma.campaigns.create({
                    data: {
                        name: `测试活动_后台列表_${Date.now()}_${i}`,
                        type: CampaignType.REGISTER_GIFT,
                        levelId: level.id,
                        startAt: new Date(),
                        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        status: CampaignStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                testIds.campaignIds.push(c.id)
            }

            const result = await getCampaignsForAdminService({ page: 1, pageSize: 10 })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应按类型筛选', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_后台类型筛选' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const c1 = await prisma.campaigns.create({
                data: {
                    name: `测试活动_后台类型1_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(c1.id)

            const result = await getCampaignsForAdminService({ type: CampaignType.REGISTER_GIFT })

            expect(result.list.every(c => c.type === CampaignType.REGISTER_GIFT)).toBe(true)
        })
    })

    // ==================== createCampaignService ====================

    describe('createCampaignService - 创建营销活动', () => {
        it('应成功创建活动', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_创建' })
            testIds.membershipLevelIds.push(level.id)

            const ts = Date.now()
            const now = new Date()
            const info = await createCampaignService({
                name: `测试创建Service_${ts}`,
                type: CampaignType.REGISTER_GIFT,
                levelId: level.id,
                duration: 30,
                giftPoint: 100,
                startAt: now,
                endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            })
            testIds.campaignIds.push(info.id)

            expect(info).toBeDefined()
            expect(info.id).toBeGreaterThan(0)
            expect(info.name).toBe(`测试创建Service_${ts}`)
            expect(info.levelId).toBe(level.id)
        })

        it('应返回 CampaignInfo 格式', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_格式' })
            testIds.membershipLevelIds.push(level.id)

            const ts = Date.now()
            const now = new Date()
            const info = await createCampaignService({
                name: `测试格式_${ts}`,
                type: CampaignType.INVITATION_REWARD,
                levelId: level.id,
                startAt: now,
                endAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            })
            testIds.campaignIds.push(info.id)

            expect(info).toHaveProperty('id')
            expect(info).toHaveProperty('name')
            expect(info).toHaveProperty('type')
            expect(info).toHaveProperty('levelId')
            expect(info).toHaveProperty('levelName')
            expect(info).toHaveProperty('giftPoint')
            expect(info).toHaveProperty('startAt')
            expect(info).toHaveProperty('endAt')
            expect(info).toHaveProperty('status')
        })
    })

    // ==================== updateCampaignService ====================

    describe('updateCampaignService - 更新营销活动', () => {
        it('应成功更新字段', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_更新' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const ts = Date.now()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试更新前_${ts}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    giftPoint: 50,
                    startAt: new Date(),
                    endAt: new Date(ts + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const updated = await updateCampaignService(campaign.id, {
                name: `测试更新后_${ts}`,
                giftPoint: 200,
            })

            expect(updated.name).toBe(`测试更新后_${ts}`)
            expect(updated.giftPoint).toBe(200)
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(
                updateCampaignService(999999, { name: '新名称' })
            ).rejects.toThrow('营销活动不存在')
        })

        it('应支持设置 levelId 为 null', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_清空' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试清空Level_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const updated = await updateCampaignService(campaign.id, { levelId: null })

            expect(updated.levelId).toBeNull()
        })
    })

    // ==================== toggleCampaignStatusService ====================

    describe('toggleCampaignStatusService - 切换状态', () => {
        it('应从启用切换到禁用', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_切换' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试切换状态_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const toggled = await toggleCampaignStatusService(campaign.id)

            expect(toggled.status).toBe(CampaignStatus.DISABLED)
        })

        it('应从禁用切换到启用', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_切换2' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试切换状态2_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const toggled = await toggleCampaignStatusService(campaign.id)

            expect(toggled.status).toBe(CampaignStatus.ENABLED)
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(toggleCampaignStatusService(999999)).rejects.toThrow('营销活动不存在')
        })
    })

    // ==================== deleteCampaignService ====================

    describe('deleteCampaignService - 删除营销活动', () => {
        it('应成功软删除', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_删除' })
            testIds.membershipLevelIds.push(level.id)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试删除Service_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            await deleteCampaignService(campaign.id)

            // 验证已被软删除
            const found = await findCampaignByIdDao(campaign.id)
            expect(found).toBeNull()
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(deleteCampaignService(999999)).rejects.toThrow('营销活动不存在')
        })
    })

    // ==================== executeRegisterGiftService ====================

    describe('executeRegisterGiftService - 执行注册赠送', () => {
        it('有会员+积分配置时应创建会员和积分记录，返回 true', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_注册赠送_会员积分' })
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser({ name: '注册赠送用户_会员积分' })
            testIds.userIds.push(user.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试注册赠送_会员积分_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    duration: 30,
                    giftPoint: 100,
                    startAt,
                    endAt,
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeRegisterGiftService(user.id)

            expect(result).toBe(true)

            // 验证会员记录
            const memberships = await prisma.userMemberships.findMany({ where: { userId: user.id } })
            expect(memberships.length).toBe(1)
            expect(memberships[0].levelId).toBe(level.id)
            expect(memberships[0].status).toBe(1) // ACTIVE
            testIds.userMembershipIds.push(memberships[0].id)

            // 验证积分记录
            const pointRecords = await prisma.pointRecords.findMany({ where: { userId: user.id } })
            expect(pointRecords.length).toBe(1)
            expect(pointRecords[0].pointAmount).toBe(100)
            expect(pointRecords[0].sourceType).toBe(7) // REGISTER_GIFT
            testIds.pointRecordIds.push(pointRecords[0].id)
        })

        it('只有积分配置（无会员）时应只创建积分记录，expiredAt 为今天+1年', async () => {
            const user = await createTestUser({ name: '注册赠送用户_仅积分' })
            testIds.userIds.push(user.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试注册赠送_仅积分_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: null,
                    duration: null,
                    giftPoint: 50,
                    startAt,
                    endAt,
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeRegisterGiftService(user.id)

            expect(result).toBe(true)

            // 验证无会员记录
            const memberships = await prisma.userMemberships.findMany({ where: { userId: user.id } })
            expect(memberships.length).toBe(0)

            // 验证积分记录
            const pointRecords = await prisma.pointRecords.findMany({ where: { userId: user.id } })
            expect(pointRecords.length).toBe(1)
            expect(pointRecords[0].pointAmount).toBe(50)
            testIds.pointRecordIds.push(pointRecords[0].id)

            // 验证 expiredAt 为今天+1年
            const expectedExpiredAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const actualExpiredAt = new Date(pointRecords[0].expiredAt)
            // 允许1分钟误差
            expect(Math.abs(actualExpiredAt.getTime() - expectedExpiredAt.getTime())).toBeLessThan(60 * 1000)
        })

        it('有会员配置但无积分时应只创建会员', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_注册赠送_仅会员' })
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser({ name: '注册赠送用户_仅会员' })
            testIds.userIds.push(user.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试注册赠送_仅会员_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    levelId: level.id,
                    duration: 7,
                    giftPoint: 0,
                    startAt,
                    endAt,
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeRegisterGiftService(user.id)

            expect(result).toBe(true)

            // 验证有会员记录
            const memberships = await prisma.userMemberships.findMany({ where: { userId: user.id } })
            expect(memberships.length).toBe(1)
            expect(memberships[0].levelId).toBe(level.id)
            testIds.userMembershipIds.push(memberships[0].id)

            // 验证无积分记录
            const pointRecords = await prisma.pointRecords.findMany({ where: { userId: user.id } })
            expect(pointRecords.length).toBe(0)
        })

        it('无有效活动时应返回 false，不创建任何记录', async () => {
            const user = await createTestUser({ name: '注册赠送用户_无活动' })
            testIds.userIds.push(user.id)

            const prisma = getTestPrisma()
            // 先禁用所有现有的 REGISTER_GIFT 活动，确保 findActiveCampaignByTypeDao 找不到任何活动
            await prisma.campaigns.updateMany({
                where: {
                    type: CampaignType.REGISTER_GIFT,
                    status: CampaignStatus.ENABLED,
                },
                data: { status: CampaignStatus.DISABLED },
            })
            // 创建一个已禁用的活动
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试注册赠送_已禁用_${Date.now()}`,
                    type: CampaignType.REGISTER_GIFT,
                    giftPoint: 100,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeRegisterGiftService(user.id)

            expect(result).toBe(false)

            // 验证无会员记录
            const memberships = await prisma.userMemberships.findMany({ where: { userId: user.id } })
            expect(memberships.length).toBe(0)

            // 验证无积分记录
            const pointRecords = await prisma.pointRecords.findMany({ where: { userId: user.id } })
            expect(pointRecords.length).toBe(0)
        })
    })

    // ==================== executeInvitationRewardService ====================

    describe('executeInvitationRewardService - 执行邀请奖励', () => {
        it('正常邀请奖励时应创建会员和积分记录到邀请人', async () => {
            const level = await createTestMembershipLevel({ name: '测试级别_邀请奖励_会员积分' })
            testIds.membershipLevelIds.push(level.id)

            const inviter = await createTestUser({ name: '邀请人_会员积分' })
            const invitee = await createTestUser({ name: '被邀请人_会员积分' })
            testIds.userIds.push(inviter.id, invitee.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const prisma = getTestPrisma()
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试邀请奖励_会员积分_${Date.now()}`,
                    type: CampaignType.INVITATION_REWARD,
                    levelId: level.id,
                    duration: 30,
                    giftPoint: 200,
                    startAt,
                    endAt,
                    status: CampaignStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeInvitationRewardService(inviter.id, invitee.id)

            expect(result).toBe(true)

            // 验证邀请人获得会员记录
            const inviterMemberships = await prisma.userMemberships.findMany({ where: { userId: inviter.id } })
            expect(inviterMemberships.length).toBe(1)
            expect(inviterMemberships[0].levelId).toBe(level.id)
            expect(inviterMemberships[0].status).toBe(1) // ACTIVE
            testIds.userMembershipIds.push(inviterMemberships[0].id)

            // 验证邀请人获得积分记录
            const inviterPoints = await prisma.pointRecords.findMany({ where: { userId: inviter.id } })
            expect(inviterPoints.length).toBe(1)
            expect(inviterPoints[0].pointAmount).toBe(200)
            expect(inviterPoints[0].sourceType).toBe(8) // INVITATION_TO_REGISTER
            testIds.pointRecordIds.push(inviterPoints[0].id)

            // 验证被邀请人无相关记录（奖励发给邀请人）
            const inviteeMemberships = await prisma.userMemberships.findMany({ where: { userId: invitee.id } })
            expect(inviteeMemberships.length).toBe(0)
            const inviteePoints = await prisma.pointRecords.findMany({ where: { userId: invitee.id } })
            expect(inviteePoints.length).toBe(0)
        })

        it('无有效活动时应返回 false，不创建任何记录', async () => {
            const inviter = await createTestUser({ name: '邀请人_无活动' })
            const invitee = await createTestUser({ name: '被邀请人_无活动' })
            testIds.userIds.push(inviter.id, invitee.id)

            const prisma = getTestPrisma()
            // 先禁用所有现有的 INVITATION_REWARD 活动，确保 findActiveCampaignByTypeDao 找不到任何活动
            await prisma.campaigns.updateMany({
                where: {
                    type: CampaignType.INVITATION_REWARD,
                    status: CampaignStatus.ENABLED,
                },
                data: { status: CampaignStatus.DISABLED },
            })
            // 创建一个已禁用的邀请奖励活动
            const campaign = await prisma.campaigns.create({
                data: {
                    name: `测试邀请奖励_已禁用_${Date.now()}`,
                    type: CampaignType.INVITATION_REWARD,
                    giftPoint: 200,
                    startAt: new Date(),
                    endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    status: CampaignStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.campaignIds.push(campaign.id)

            const result = await executeInvitationRewardService(inviter.id, invitee.id)

            expect(result).toBe(false)

            // 验证邀请人无记录
            const inviterMemberships = await prisma.userMemberships.findMany({ where: { userId: inviter.id } })
            expect(inviterMemberships.length).toBe(0)
            const inviterPoints = await prisma.pointRecords.findMany({ where: { userId: inviter.id } })
            expect(inviterPoints.length).toBe(0)

            // 验证被邀请人无记录
            const inviteeMemberships = await prisma.userMemberships.findMany({ where: { userId: invitee.id } })
            expect(inviteeMemberships.length).toBe(0)
            const inviteePoints = await prisma.pointRecords.findMany({ where: { userId: invitee.id } })
            expect(inviteePoints.length).toBe(0)
        })
    })
})
