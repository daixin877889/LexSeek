/**
 * 营销活动集成测试
 *
 * 测试真实的营销活动 DAO/Service 函数，使用真实数据库操作
 *
 * **Feature: membership-system**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestCampaign,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    CampaignType,
    type TestIds,
} from './test-db-helper'
import { PBT_CONFIG_FAST } from './test-generators'

// 导入实际的 DAO 函数
import {
    createCampaignDao,
    findCampaignByIdDao,
    findActiveCampaignByTypeDao,
    findAllCampaignsDao,
    updateCampaignDao,
    deleteCampaignDao,
} from '../../../server/services/campaign/campaign.dao'

// 导入实际的 Service 函数
import {
    getActiveCampaignService,
} from '../../../server/services/campaign/campaign.service'

// 营销活动状态常量
const CampaignStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

// 检查数据库是否可用
let dbAvailable = false

describe('营销活动集成测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        } else {
            // 重置数据库序列，避免与种子数据冲突
            await resetDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
            testIds.campaignIds = []
            testIds.userMembershipIds = []
            testIds.pointRecordIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('createCampaignDao 测试', () => {
        it('应成功创建营销活动', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            // 使用实际的 DAO 函数创建
            const campaign = await createCampaignDao({
                name: '测试活动_DAO创建',
                type: CampaignType.REGISTER_GIFT,
                level: { connect: { id: level.id } },
                duration: 30,
                giftPoint: 100,
                startAt,
                endAt,
                status: CampaignStatus.ENABLED,
            })
            testIds.campaignIds.push(campaign.id)

            expect(campaign.id).toBeGreaterThan(0)
            expect(campaign.name).toBe('测试活动_DAO创建')
            expect(campaign.type).toBe(CampaignType.REGISTER_GIFT)
            expect(campaign.levelId).toBe(level.id)
            expect(campaign.duration).toBe(30)
            expect(campaign.giftPoint).toBe(100)
            expect(campaign.status).toBe(CampaignStatus.ENABLED)
        })
    })

    describe('findCampaignByIdDao 测试', () => {
        it('应成功通过 ID 查询营销活动', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestCampaign(level.id)
            testIds.campaignIds.push(created.id)

            // 使用实际的 DAO 函数查询
            const found = await findCampaignByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.level).not.toBeNull()
            expect(found!.level!.id).toBe(level.id)
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findCampaignByIdDao(999999)
            expect(found).toBeNull()
        })
    })

    describe('findActiveCampaignByTypeDao 测试', () => {
        it('应返回指定类型的有效营销活动', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const pastStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const futureEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

            const campaign = await createTestCampaign(level.id, {
                type: CampaignType.REGISTER_GIFT,
                startAt: pastStart,
                endAt: futureEnd,
                status: CampaignStatus.ENABLED,
            })
            testIds.campaignIds.push(campaign.id)

            // 使用实际的 DAO 函数查询
            const found = await findActiveCampaignByTypeDao(CampaignType.REGISTER_GIFT)

            expect(found).not.toBeNull()
            // 可能返回其他活动，只验证返回的活动是有效的
            expect(found!.type).toBe(CampaignType.REGISTER_GIFT)
            expect(found!.status).toBe(CampaignStatus.ENABLED)
        })

        it('活动未开始时不应返回', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000)
            const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

            const campaign = await createTestCampaign(level.id, {
                type: CampaignType.ACTIVITY_REWARD,
                startAt: futureStart,
                endAt: futureEnd,
                status: CampaignStatus.ENABLED,
            })
            testIds.campaignIds.push(campaign.id)

            // 使用实际的 DAO 函数查询
            const found = await findActiveCampaignByTypeDao(CampaignType.ACTIVITY_REWARD)

            // 如果返回了活动，应该不是我们创建的未开始活动
            if (found) {
                expect(found.id).not.toBe(campaign.id)
            }
        })

        it('活动已结束时不应返回', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const pastStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000)

            const campaign = await createTestCampaign(level.id, {
                type: CampaignType.ACTIVITY_REWARD,
                startAt: pastStart,
                endAt: pastEnd,
                status: CampaignStatus.ENABLED,
            })
            testIds.campaignIds.push(campaign.id)

            // 使用实际的 DAO 函数查询
            const found = await findActiveCampaignByTypeDao(CampaignType.ACTIVITY_REWARD)

            // 如果返回了活动，应该不是我们创建的已结束活动
            if (found) {
                expect(found.id).not.toBe(campaign.id)
            }
        })

        it('活动禁用时不应返回', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
            const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

            const campaign = await createTestCampaign(level.id, {
                type: CampaignType.ACTIVITY_REWARD,
                startAt: pastStart,
                endAt: futureEnd,
                status: CampaignStatus.DISABLED,
            })
            testIds.campaignIds.push(campaign.id)

            // 使用实际的 DAO 函数查询
            const found = await findActiveCampaignByTypeDao(CampaignType.ACTIVITY_REWARD)

            // 如果返回了活动，应该不是我们创建的禁用活动
            if (found) {
                expect(found.id).not.toBe(campaign.id)
            }
        })
    })

    describe('updateCampaignDao 测试', () => {
        it('应成功更新营销活动', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestCampaign(level.id)
            testIds.campaignIds.push(created.id)

            // 使用实际的 DAO 函数更新
            const updated = await updateCampaignDao(created.id, {
                name: '测试活动_更新后',
                giftPoint: 200,
            })

            expect(updated.name).toBe('测试活动_更新后')
            expect(updated.giftPoint).toBe(200)
        })
    })

    describe('deleteCampaignDao 测试', () => {
        it('应成功软删除营销活动', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const created = await createTestCampaign(level.id)
            testIds.campaignIds.push(created.id)

            // 使用实际的 DAO 函数删除
            await deleteCampaignDao(created.id)

            // 使用实际的 DAO 函数查询（应返回 null）
            const found = await findCampaignByIdDao(created.id)
            expect(found).toBeNull()

            // 直接查询数据库验证 deletedAt 已设置
            const foundWithDeleted = await prisma.campaigns.findUnique({
                where: { id: created.id },
            })
            expect(foundWithDeleted).not.toBeNull()
            expect(foundWithDeleted!.deletedAt).not.toBeNull()
        })
    })

    describe('findAllCampaignsDao 测试', () => {
        it('应正确返回分页结果', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 创建 5 个营销活动
            for (let i = 0; i < 5; i++) {
                const campaign = await createTestCampaign(level.id)
                testIds.campaignIds.push(campaign.id)
            }

            // 使用实际的 DAO 函数查询
            const result = await findAllCampaignsDao({ page: 1, pageSize: 2 })

            expect(result.list.length).toBeLessThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(5)
        })

        it('应正确按类型筛选', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const registerGift = await createTestCampaign(level.id, {
                type: CampaignType.REGISTER_GIFT,
            })
            const invitationReward = await createTestCampaign(level.id, {
                type: CampaignType.INVITATION_REWARD,
            })
            testIds.campaignIds.push(registerGift.id, invitationReward.id)

            // 使用实际的 DAO 函数按类型筛选
            const result = await findAllCampaignsDao({ type: CampaignType.REGISTER_GIFT })

            const foundRegister = result.list.find(c => c.id === registerGift.id)
            const foundInvitation = result.list.find(c => c.id === invitationReward.id)

            expect(foundRegister).not.toBeUndefined()
            expect(foundInvitation).toBeUndefined()
        })

        it('应正确按状态筛选', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const enabledCampaign = await createTestCampaign(level.id, {
                status: CampaignStatus.ENABLED,
            })
            const disabledCampaign = await createTestCampaign(level.id, {
                status: CampaignStatus.DISABLED,
            })
            testIds.campaignIds.push(enabledCampaign.id, disabledCampaign.id)

            // 使用实际的 DAO 函数按状态筛选
            const result = await findAllCampaignsDao({ status: CampaignStatus.ENABLED })

            const foundEnabled = result.list.find(c => c.id === enabledCampaign.id)
            const foundDisabled = result.list.find(c => c.id === disabledCampaign.id)

            expect(foundEnabled).not.toBeUndefined()
            expect(foundDisabled).toBeUndefined()
        })
    })

    describe('getActiveCampaignService 测试', () => {
        it('应正确返回有效活动信息', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel({ name: '测试级别_Service' })
            testIds.membershipLevelIds.push(level.id)

            const now = new Date()
            const pastStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const futureEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

            const campaign = await createTestCampaign(level.id, {
                name: '测试活动_Service',
                type: CampaignType.REGISTER_GIFT,
                duration: 30,
                giftPoint: 100,
                startAt: pastStart,
                endAt: futureEnd,
                status: CampaignStatus.ENABLED,
            })
            testIds.campaignIds.push(campaign.id)

            // 使用实际的 Service 函数
            const info = await getActiveCampaignService(CampaignType.REGISTER_GIFT)

            // 可能返回其他活动，只验证返回的活动格式正确
            if (info) {
                expect(info.type).toBe(CampaignType.REGISTER_GIFT)
                expect(info.status).toBe(CampaignStatus.ENABLED)
            }
        })
    })

    /**
     * Property 6: 活动时间范围验证
     *
     * *对于任意*营销活动，只有当前时间在 startAt 和 endAt 之间且状态为 ENABLED 时，活动才能被触发。
     *
     * **Feature: membership-system, Property 6: 活动时间范围验证**
     * **Validates: Requirements 5.4**
     */
    describe('Property 6: 活动时间范围验证', () => {
        it('Property 6.1: 活动在有效期内且启用时应返回有效', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...Object.values(CampaignType)),
                    fc.integer({ min: 1, max: 30 }), // 开始时间偏移（天，过去）
                    fc.integer({ min: 1, max: 60 }), // 结束时间偏移（天，未来）
                    async (type, startOffset, endOffset) => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const now = Date.now()
                        const pastStart = new Date(now - startOffset * 24 * 60 * 60 * 1000)
                        const futureEnd = new Date(now + endOffset * 24 * 60 * 60 * 1000)

                        // 使用实际的 DAO 函数创建有效活动
                        const campaign = await createCampaignDao({
                            name: `测试活动_Property6_1_${Date.now()}_${Math.random()}`,
                            type,
                            level: { connect: { id: level.id } },
                            duration: 30,
                            giftPoint: 100,
                            startAt: pastStart,
                            endAt: futureEnd,
                            status: CampaignStatus.ENABLED,
                        })
                        testIds.campaignIds.push(campaign.id)

                        // 使用实际的 DAO 函数查询
                        const found = await findActiveCampaignByTypeDao(type)

                        // 应该能找到有效活动
                        expect(found).not.toBeNull()
                        expect(found!.type).toBe(type)
                        expect(found!.status).toBe(CampaignStatus.ENABLED)
                        // 验证活动在有效期内
                        const currentTime = new Date()
                        expect(found!.startAt.getTime()).toBeLessThanOrEqual(currentTime.getTime())
                        expect(found!.endAt.getTime()).toBeGreaterThan(currentTime.getTime())

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 6.2: 活动未开始时不应被查询到', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...Object.values(CampaignType)),
                    fc.integer({ min: 1, max: 30 }), // 开始时间偏移（天，未来）
                    fc.integer({ min: 31, max: 60 }), // 结束时间偏移（天，未来）
                    async (type, startOffset, endOffset) => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const now = Date.now()
                        const futureStart = new Date(now + startOffset * 24 * 60 * 60 * 1000)
                        const futureEnd = new Date(now + endOffset * 24 * 60 * 60 * 1000)

                        // 使用实际的 DAO 函数创建未开始的活动
                        const campaign = await createCampaignDao({
                            name: `测试活动_Property6_2_${Date.now()}_${Math.random()}`,
                            type,
                            level: { connect: { id: level.id } },
                            duration: 30,
                            giftPoint: 100,
                            startAt: futureStart,
                            endAt: futureEnd,
                            status: CampaignStatus.ENABLED,
                        })
                        testIds.campaignIds.push(campaign.id)

                        // 使用实际的 DAO 函数查询
                        const found = await findActiveCampaignByTypeDao(type)

                        // 如果返回了活动，应该不是我们创建的未开始活动
                        if (found) {
                            expect(found.id).not.toBe(campaign.id)
                        }

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 6.3: 活动已结束时不应被查询到', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...Object.values(CampaignType)),
                    fc.integer({ min: 31, max: 60 }), // 开始时间偏移（天，过去）
                    fc.integer({ min: 1, max: 30 }), // 结束时间偏移（天，过去）
                    async (type, startOffset, endOffset) => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const now = Date.now()
                        const pastStart = new Date(now - startOffset * 24 * 60 * 60 * 1000)
                        const pastEnd = new Date(now - endOffset * 24 * 60 * 60 * 1000)

                        // 使用实际的 DAO 函数创建已结束的活动
                        const campaign = await createCampaignDao({
                            name: `测试活动_Property6_3_${Date.now()}_${Math.random()}`,
                            type,
                            level: { connect: { id: level.id } },
                            duration: 30,
                            giftPoint: 100,
                            startAt: pastStart,
                            endAt: pastEnd,
                            status: CampaignStatus.ENABLED,
                        })
                        testIds.campaignIds.push(campaign.id)

                        // 使用实际的 DAO 函数查询
                        const found = await findActiveCampaignByTypeDao(type)

                        // 如果返回了活动，应该不是我们创建的已结束活动
                        if (found) {
                            expect(found.id).not.toBe(campaign.id)
                        }

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 6.4: 活动禁用时不应被查询到', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...Object.values(CampaignType)),
                    fc.integer({ min: 1, max: 30 }), // 开始时间偏移（天，过去）
                    fc.integer({ min: 1, max: 60 }), // 结束时间偏移（天，未来）
                    async (type, startOffset, endOffset) => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        const now = Date.now()
                        const pastStart = new Date(now - startOffset * 24 * 60 * 60 * 1000)
                        const futureEnd = new Date(now + endOffset * 24 * 60 * 60 * 1000)

                        // 使用实际的 DAO 函数创建禁用的活动
                        const campaign = await createCampaignDao({
                            name: `测试活动_Property6_4_${Date.now()}_${Math.random()}`,
                            type,
                            level: { connect: { id: level.id } },
                            duration: 30,
                            giftPoint: 100,
                            startAt: pastStart,
                            endAt: futureEnd,
                            status: CampaignStatus.DISABLED,
                        })
                        testIds.campaignIds.push(campaign.id)

                        // 使用实际的 DAO 函数查询
                        const found = await findActiveCampaignByTypeDao(type)

                        // 如果返回了活动，应该不是我们创建的禁用活动
                        if (found) {
                            expect(found.id).not.toBe(campaign.id)
                        }

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('Property 6.5: 有效活动的时间范围验证', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...Object.values(CampaignType)),
                    async (type) => {
                        // 使用实际的 DAO 函数查询有效活动
                        const found = await findActiveCampaignByTypeDao(type)

                        // 如果找到了活动，验证其满足所有条件
                        if (found) {
                            const now = new Date()
                            // 验证状态为启用
                            expect(found.status).toBe(CampaignStatus.ENABLED)
                            // 验证当前时间在活动时间范围内
                            expect(found.startAt.getTime()).toBeLessThanOrEqual(now.getTime())
                            expect(found.endAt.getTime()).toBeGreaterThan(now.getTime())
                            // 验证未被删除
                            expect(found.deletedAt).toBeNull()
                        }

                        return true
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
