/**
 * 积分系统 API 测试
 *
 * 测试积分信息、记录、使用情况相关 API
 * 所有用户创建都通过注册 API 完成
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
} from './test-api-helpers'
import { createApiClient } from './test-api-client'

describe('积分系统 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('积分信息测试', () => {
        it('已认证用户应能获取积分信息', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/points/info')

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
            // 新用户积分可能为 0
        })

        it('已认证用户应能获取积分记录', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/points/records')

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
        })

        it('应支持积分记录分页', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/points/records', {
                query: { page: '1', pageSize: '5' },
            })

            expect(response.success).toBe(true)
        })

        it('已认证用户应能获取积分使用情况', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/points/usage')

            expect(response.success).toBe(true)
            expect(response.data).toBeDefined()
        })

        it('未认证用户应无法获取积分信息', async () => {
            const unauthClient = createApiClient()

            const response = await unauthClient.get('/api/v1/points/info')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })
    })
})
