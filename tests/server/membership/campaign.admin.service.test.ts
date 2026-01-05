/**
 * 营销活动管理服务测试
 *
 * 测试管理后台营销活动管理的服务层功能，包括：
 * - 营销活动列表查询（分页、筛选）
 * - 营销活动 CRUD 操作
 * - 营销活动状态切换
 *
 * **Feature: admin-campaign-management**
 * **Validates: Requirements 6.4, 6.5, 6.6, 7.2, 7.4, 8.2, 9.1, 10.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { prisma } from '../../../server/utils/db'
import {
    getCampaignsForAdminService,
    createCampaignService,
    updateCampaignService,
    toggleCampaignStatusService,
    deleteCampaignService,
    getCampaignByIdService,
} from '../../../server/services/campaign/campaign.service'
import { CampaignType, CampaignStatus } from '../../../shared/types/campaign'

// 测试数据追踪
const testCampaignIds: number[] = []
let testLevelId: number | null = null

describe('营销活动管理服务测试', () => {
    beforeAll(async () => {
        // 获取一个测试用的会员级别
        const level = await prisma.membershipLevels.findFirst({
            where: { deletedAt: null, status: 1 },
            select: { id: true },
        })
        testLevelId = level?.id || null
    })

    afterEach(async () => {
        // 清理测试创建的营销活动
        if (testCampaignIds.length > 0) {
            await prisma.campaigns.deleteMany({
                where: { id: { in: testCampaignIds } },
            })
            testCampaignIds.length = 0
        }
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('getCampaignsForAdminService 测试', () => {
        it('应返回分页的营销活动列表', async () => {
            const result = await getCampaignsForAdminService({ page: 1, pageSize: 10 })

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(Array.isArray(result.list)).toBe(true)
            expect(typeof result.total).toBe('number')
        })

        it('应正确按类型筛选', async () => {
            const result = await getCampaignsForAdminService({
                page: 1,
                pageSize: 100,
                type: CampaignType.REGISTER_GIFT,
            })

            for (const campaign of result.list) {
                expect(campaign.type).toBe(CampaignType.REGISTER_GIFT)
            }
        })

        it('应正确按状态筛选', async () => {
            const result = await getCampaignsForAdminService({
                page: 1,
                pageSize: 100,
                status: CampaignStatus.ENABLED,
            })

            for (const campaign of result.list) {
                expect(campaign.status).toBe(CampaignStatus.ENABLED)
            }
        })
    })

    describe('createCampaignService 测试', () => {
        it('应成功创建营销活动（有结束时间）', async () => {
            if (!testLevelId) {
                console.log('没有可用的会员级别，跳过测试')
                return
            }

            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
            const endAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

            const campaign = await createCampaignService({
                name: '测试营销活动_' + Date.now(),
                type: CampaignType.REGISTER_GIFT,
                levelId: testLevelId,
                duration: 30,
                giftPoint: 100,
                startAt,
                endAt,
                status: CampaignStatus.DISABLED,
            })
            testCampaignIds.push(campaign.id)

            expect(campaign.id).toBeGreaterThan(0)
            expect(campaign.type).toBe(CampaignType.REGISTER_GIFT)
            expect(campaign.levelId).toBe(testLevelId)
            expect(campaign.duration).toBe(30)
            expect(campaign.giftPoint).toBe(100)
            expect(campaign.endAt).not.toBeNull()
        })

        it('应成功创建长期营销活动（无结束时间）', async () => {
            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)

            const campaign = await createCampaignService({
                name: '测试长期活动_' + Date.now(),
                type: CampaignType.INVITATION_REWARD,
                giftPoint: 50,
                startAt,
                endAt: null, // 长期活动
                status: CampaignStatus.DISABLED,
            })
            testCampaignIds.push(campaign.id)

            expect(campaign.id).toBeGreaterThan(0)
            expect(campaign.type).toBe(CampaignType.INVITATION_REWARD)
            expect(campaign.endAt).toBeNull()
        })
    })

    describe('updateCampaignService 测试', () => {
        it('应成功更新营销活动信息', async () => {
            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)

            // 先创建一个营销活动
            const created = await createCampaignService({
                name: '测试活动_更新前_' + Date.now(),
                type: CampaignType.ACTIVITY_REWARD,
                giftPoint: 50,
                startAt,
                status: CampaignStatus.DISABLED,
            })
            testCampaignIds.push(created.id)

            // 更新营销活动
            const updated = await updateCampaignService(created.id, {
                name: '测试活动_更新后',
                giftPoint: 200,
            })

            expect(updated.name).toBe('测试活动_更新后')
            expect(updated.giftPoint).toBe(200)
        })

        it('更新不存在的营销活动应抛出错误', async () => {
            await expect(
                updateCampaignService(999999, { name: '不存在' })
            ).rejects.toThrow('营销活动不存在')
        })
    })

    describe('toggleCampaignStatusService 测试', () => {
        it('应成功切换营销活动状态', async () => {
            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)

            // 创建一个禁用的营销活动
            const created = await createCampaignService({
                name: '测试活动_状态切换_' + Date.now(),
                type: CampaignType.REGISTER_GIFT,
                giftPoint: 100,
                startAt,
                status: CampaignStatus.DISABLED,
            })
            testCampaignIds.push(created.id)

            // 切换状态（禁用 -> 启用）
            const toggled = await toggleCampaignStatusService(created.id)
            expect(toggled.status).toBe(CampaignStatus.ENABLED)

            // 再次切换（启用 -> 禁用）
            const toggledAgain = await toggleCampaignStatusService(created.id)
            expect(toggledAgain.status).toBe(CampaignStatus.DISABLED)
        })

        it('切换不存在的营销活动状态应抛出错误', async () => {
            await expect(
                toggleCampaignStatusService(999999)
            ).rejects.toThrow('营销活动不存在')
        })
    })

    describe('deleteCampaignService 测试', () => {
        it('应成功软删除营销活动', async () => {
            const now = new Date()
            const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)

            // 创建一个营销活动
            const created = await createCampaignService({
                name: '测试活动_删除_' + Date.now(),
                type: CampaignType.REGISTER_GIFT,
                giftPoint: 100,
                startAt,
                status: CampaignStatus.DISABLED,
            })
            // 不加入 testCampaignIds，因为会被删除

            // 删除营销活动
            await deleteCampaignService(created.id)

            // 验证营销活动已被软删除
            const found = await getCampaignByIdService(created.id)
            expect(found).toBeNull()

            // 验证数据库中 deletedAt 已设置
            const dbCampaign = await prisma.campaigns.findUnique({
                where: { id: created.id },
            })
            expect(dbCampaign).not.toBeNull()
            expect(dbCampaign!.deletedAt).not.toBeNull()

            // 清理
            await prisma.campaigns.delete({ where: { id: created.id } })
        })

        it('删除不存在的营销活动应抛出错误', async () => {
            await expect(
                deleteCampaignService(999999)
            ).rejects.toThrow('营销活动不存在')
        })
    })
})

/**
 * Property 4: 营销活动筛选结果一致性
 *
 * 对于任意筛选条件，返回的所有营销活动都应满足该筛选条件
 */
describe('Property 4: 营销活动筛选结果一致性', () => {
    it('按类型筛选的结果应全部匹配该类型', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(
                    CampaignType.REGISTER_GIFT,
                    CampaignType.INVITATION_REWARD,
                    CampaignType.ACTIVITY_REWARD
                ),
                async (type) => {
                    const result = await getCampaignsForAdminService({
                        page: 1,
                        pageSize: 100,
                        type,
                    })

                    for (const campaign of result.list) {
                        expect(campaign.type).toBe(type)
                    }
                    return true
                }
            ),
            { numRuns: 10 }
        )
    })

    it('按状态筛选的结果应全部匹配该状态', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(CampaignStatus.ENABLED, CampaignStatus.DISABLED),
                async (status) => {
                    const result = await getCampaignsForAdminService({
                        page: 1,
                        pageSize: 100,
                        status,
                    })

                    for (const campaign of result.list) {
                        expect(campaign.status).toBe(status)
                    }
                    return true
                }
            ),
            { numRuns: 10 }
        )
    })
})

/**
 * Property 7: 营销活动状态切换幂等性
 *
 * 连续两次切换状态应恢复原状态
 */
describe('Property 7: 营销活动状态切换幂等性', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.campaigns.deleteMany({
                where: { id: { in: createdIds } },
            })
            createdIds.length = 0
        }
    })

    it('连续两次切换状态应恢复原状态', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(CampaignStatus.ENABLED, CampaignStatus.DISABLED),
                async (initialStatus) => {
                    const now = new Date()
                    const startAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)

                    // 创建营销活动
                    const campaign = await createCampaignService({
                        name: '测试活动_幂等性_' + Date.now() + '_' + Math.random(),
                        type: CampaignType.REGISTER_GIFT,
                        giftPoint: 100,
                        startAt,
                        status: initialStatus,
                    })
                    createdIds.push(campaign.id)

                    // 第一次切换
                    const toggled1 = await toggleCampaignStatusService(campaign.id)
                    expect(toggled1.status).not.toBe(initialStatus)

                    // 第二次切换
                    const toggled2 = await toggleCampaignStatusService(campaign.id)
                    expect(toggled2.status).toBe(initialStatus)

                    return true
                }
            ),
            { numRuns: 10 }
        )
    })
})

/**
 * Property 8: 分页数据完整性
 *
 * 分页查询的总数应等于所有页数据的总和
 */
describe('Property 8: 分页数据完整性（营销活动）', () => {
    it('分页查询的数据应完整', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 20 }),
                async (pageSize) => {
                    // 获取第一页和总数
                    const firstPage = await getCampaignsForAdminService({
                        page: 1,
                        pageSize,
                    })

                    const totalPages = Math.ceil(firstPage.total / pageSize)
                    let totalItems = 0

                    // 遍历所有页
                    for (let page = 1; page <= totalPages; page++) {
                        const result = await getCampaignsForAdminService({
                            page,
                            pageSize,
                        })
                        totalItems += result.list.length
                    }

                    // 验证总数一致
                    expect(totalItems).toBe(firstPage.total)
                    return true
                }
            ),
            { numRuns: 5 }
        )
    })
})
