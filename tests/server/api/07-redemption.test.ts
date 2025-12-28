/**
 * 兑换码 API 测试
 *
 * 测试兑换码查询、使用、历史记录相关 API
 * 用户创建通过注册 API 完成
 * 兑换码创建通过数据库操作（作为测试数据准备，因为没有公开的创建 API）
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
    testPrisma,
} from './test-api-helpers'
import { createApiClient } from './test-api-client'
import {
    createTestRedemptionCode,
    RedemptionCodeType,
} from '../membership/test-db-helper'

describe('兑换码 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    // 测试数据追踪（用于清理）
    const createdCodeIds: number[] = []

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        // 清理测试兑换码
        if (createdCodeIds.length > 0) {
            await testPrisma.redemptionRecords.deleteMany({
                where: { codeId: { in: createdCodeIds } },
            })
            await testPrisma.redemptionCodes.deleteMany({
                where: { id: { in: createdCodeIds } },
            })
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('兑换码查询测试', () => {
        it('应能查询有效兑换码信息', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            // 创建测试兑换码（数据准备，没有公开 API）
            const code = await createTestRedemptionCode(null, {
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 100,
            })
            createdCodeIds.push(code.id)

            // 通过 API 查询兑换码
            const response = await client.get('/api/v1/redemption-codes/info', {
                query: { code: code.code },
            })

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
            expect(response.data.code).toBe(code.code)
        })

        it('查询不存在的兑换码应返回错误', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/redemption-codes/info', {
                query: { code: 'NONEXISTENT_CODE_12345' },
            })

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(404)
        })

        it('查询空兑换码应返回参数错误', async () => {
            // 需要先登录（API 需要认证）
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/redemption-codes/info', {
                query: { code: '' },
            })

            expect(response.success).toBe(false)
        })
    })

    describe('兑换码使用测试', () => {
        it('已认证用户应能使用有效兑换码', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            // 创建测试兑换码（数据准备）
            const code = await createTestRedemptionCode(null, {
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 50,
            })
            createdCodeIds.push(code.id)

            // 通过 API 使用兑换码
            const response = await client.post('/api/v1/redemption-codes/redeem', {
                code: code.code,
            })

            expect(response.success).toBe(true)
            expect(response.message).toBe('兑换成功')
        })

        it('应拒绝使用已使用的兑换码', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            // 创建测试兑换码
            const code = await createTestRedemptionCode(null, {
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 50,
            })
            createdCodeIds.push(code.id)

            // 第一次通过 API 兑换
            const firstResponse = await client.post('/api/v1/redemption-codes/redeem', {
                code: code.code,
            })
            expect(firstResponse.success).toBe(true)

            // 第二次通过 API 兑换应失败
            const secondResponse = await client.post('/api/v1/redemption-codes/redeem', {
                code: code.code,
            })
            expect(secondResponse.success).toBe(false)
        })

        it('未认证用户应无法使用兑换码', async () => {
            const unauthClient = createApiClient()

            const response = await unauthClient.post('/api/v1/redemption-codes/redeem', {
                code: 'SOME_CODE',
            })

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })
    })

    describe('兑换历史测试', () => {
        it('已认证用户应能获取兑换历史', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/redemption-codes/me')

            expect(response.success).toBe(true)
            expect(response.data).toHaveProperty('list')
            expect(response.data).toHaveProperty('total')
            expect(response.data).toHaveProperty('page')
            expect(response.data).toHaveProperty('pageSize')
        })

        it('兑换后应出现在兑换历史中', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            // 创建并通过 API 使用兑换码
            const code = await createTestRedemptionCode(null, {
                type: RedemptionCodeType.POINTS_ONLY,
                pointAmount: 30,
            })
            createdCodeIds.push(code.id)

            await client.post('/api/v1/redemption-codes/redeem', {
                code: code.code,
            })

            // 通过 API 获取兑换历史
            const response = await client.get('/api/v1/redemption-codes/me')

            expect(response.success).toBe(true)
            expect(response.data.list.length).toBeGreaterThan(0)

            // 验证兑换记录
            const record = response.data.list.find((r: any) => r.code === code.code)
            expect(record).toBeDefined()
        })

        it('未认证用户应无法获取兑换历史', async () => {
            const unauthClient = createApiClient()

            const response = await unauthClient.get('/api/v1/redemption-codes/me')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })
    })
})
