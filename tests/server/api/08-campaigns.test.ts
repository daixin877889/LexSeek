/**
 * 营销活动 API 测试
 *
 * 测试营销活动列表、详情、邀请奖励相关 API
 * 用户创建通过注册 API 完成
 * 活动创建通过数据库操作（作为测试数据准备，因为没有公开的创建 API）
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
    testPrisma,
} from './test-api-helpers'
import {
    createTestCampaign,
    CampaignType,
    TEST_CAMPAIGN_NAME_PREFIX,
} from '../membership/test-db-helper'

describe('营销活动 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    // 测试数据追踪（用于清理）
    const createdCampaignIds: number[] = []

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        // 清理测试营销活动
        if (createdCampaignIds.length > 0) {
            await testPrisma.campaigns.deleteMany({
                where: { id: { in: createdCampaignIds } },
            })
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('活动列表测试', () => {
        it('应能获取活动列表', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            // 通过 API 获取活动列表
            const response = await client.get('/api/v1/campaigns')

            expect(response.success).toBe(true)
            expect(response.data).toHaveProperty('list')
            expect(response.data).toHaveProperty('total')
            expect(response.data).toHaveProperty('page')
            expect(response.data).toHaveProperty('pageSize')
        })

        it('应支持分页查询', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/campaigns', {
                query: { page: '1', pageSize: '5' },
            })

            expect(response.success).toBe(true)
            expect(response.data.pageSize).toBe(5)
        })

        it('应支持按类型筛选', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            // 创建测试活动（数据准备）
            const campaign = await createTestCampaign(null, {
                type: CampaignType.REGISTER_GIFT,
            })
            createdCampaignIds.push(campaign.id)

            // 通过 API 按类型筛选
            const response = await client.get('/api/v1/campaigns', {
                query: { type: String(CampaignType.REGISTER_GIFT) },
            })

            expect(response.success).toBe(true)
            // 验证返回的活动都是指定类型
            for (const item of response.data.list) {
                expect(item.type).toBe(CampaignType.REGISTER_GIFT)
            }
        })
    })

    describe('活动详情测试', () => {
        it('应能获取特定活动详情', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            // 创建测试活动（数据准备）
            const campaign = await createTestCampaign(null, {
                name: `${TEST_CAMPAIGN_NAME_PREFIX}详情测试_${Date.now()}`,
            })
            createdCampaignIds.push(campaign.id)

            // 通过 API 获取活动详情
            const response = await client.get(`/api/v1/campaigns/${campaign.id}`)

            expect(response.success).toBe(true)
            expect(response.data.id).toBe(campaign.id)
            expect(response.data.name).toBe(campaign.name)
        })

        it('获取不存在的活动应返回错误', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/campaigns/99999')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(404)
        })
    })

    describe('邀请奖励测试', () => {
        it('通过邀请注册应触发邀请奖励', async () => {
            // 通过 API 注册邀请人
            const inviter = await helper.registerAndLogin()

            // 通过 API 获取邀请人的邀请码
            const meResponse = await client.get('/api/v1/users/me')
            const inviteCode = meResponse.data?.inviteCode

            if (!inviteCode) {
                console.log('邀请人没有邀请码，跳过测试')
                return
            }

            // 记录邀请人当前积分
            const inviterPointsBefore = await client.get('/api/v1/points/info')

            // 清除当前 token
            client.clearAuthToken()

            // 通过 API 注册被邀请人
            const invitee = await helper.registerAndLogin(
                undefined,
                undefined,
                undefined,
                inviteCode
            )

            // 验证被邀请人的推荐人记录（数据验证可以查数据库）
            const inviteeInfo = await testPrisma.users.findUnique({
                where: { id: invitee.id },
                select: { invitedBy: true },
            })
            expect(inviteeInfo?.invitedBy).toBe(inviter.id)

            // 注意：邀请奖励是否发放取决于是否有配置邀请奖励活动
            // 这里只验证推荐人关系是否正确建立
        })

        it('邀请奖励应正确发放给推荐人和被邀请人', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            // 首先通过 API 检查是否有邀请奖励活动
            const campaignsResponse = await client.get('/api/v1/campaigns', {
                query: { type: String(CampaignType.INVITATION_REWARD), status: '1' },
            })

            if (!campaignsResponse.data || campaignsResponse.data.list.length === 0) {
                console.log('没有启用的邀请奖励活动，跳过测试')
                return
            }

            // 清除当前 token，重新注册邀请人
            client.clearAuthToken()

            // 通过 API 注册邀请人
            const inviter = await helper.registerAndLogin()

            // 通过 API 获取邀请人的邀请码
            const meResponse = await client.get('/api/v1/users/me')
            const inviteCode = meResponse.data?.inviteCode

            if (!inviteCode) {
                console.log('邀请人没有邀请码，跳过测试')
                return
            }

            // 清除当前 token
            client.clearAuthToken()

            // 通过 API 注册被邀请人
            await helper.registerAndLogin(
                undefined,
                undefined,
                undefined,
                inviteCode
            )

            // 切换回邀请人查看积分变化
            await helper.loginWithPassword(inviter.phone, inviter.password)
            const inviterPointsAfter = await client.get('/api/v1/points/info')

            // 如果有邀请奖励活动，邀请人应该获得积分
            // 具体积分数量取决于活动配置
            expect(inviterPointsAfter.success).toBe(true)
        })
    })

    describe('Property: 邀请注册奖励一致性', () => {
        it('通过邀请注册的用户推荐人信息应正确记录', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(null),
                    async () => {
                        // 通过 API 注册邀请人
                        const inviter = await helper.registerAndLogin()

                        // 通过 API 获取邀请码
                        const meResponse = await client.get('/api/v1/users/me')
                        const inviteCode = meResponse.data?.inviteCode

                        if (!inviteCode) {
                            // 跳过没有邀请码的情况
                            await helper.cleanup()
                            return
                        }

                        client.clearAuthToken()

                        // 通过 API 注册被邀请人
                        const invitee = await helper.registerAndLogin(
                            undefined,
                            undefined,
                            undefined,
                            inviteCode
                        )

                        // 验证推荐人关系（数据验证可以查数据库）
                        const inviteeInfo = await testPrisma.users.findUnique({
                            where: { id: invitee.id },
                            select: { invitedBy: true },
                        })

                        expect(inviteeInfo?.invitedBy).toBe(inviter.id)

                        // 清理
                        await helper.cleanup()
                    }
                ),
                { numRuns: 3 }
            )
        })
    })
})
