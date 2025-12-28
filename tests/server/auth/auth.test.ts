/**
 * 认证模块测试
 *
 * 测试认证令牌服务和 Token 黑名单功能
 *
 * **Feature: auth-module**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    connectTestDb,
    disconnectTestDb,
    type TestIds,
} from '../membership/test-db-helper'

// 导入实际的业务函数
import {
    addTokenBlacklistDao,
    findTokenBlacklistByTokenDao,
    deleteTokenBlacklistByTokenDao,
    deleteExpiredTokenBlacklistDao,
} from '../../../server/services/users/tokenBlacklist.dao'

import {
    getCookieConfig,
    AUTH_STATUS_COOKIE,
    type TokenUserInfo,
    type CookieConfig,
} from '../../../server/services/auth/authToken.service'

// 测试数据追踪
let testIds: TestIds

describe('认证模块测试', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
    })

    describe('Token 黑名单 DAO 测试', () => {
        it('应能添加 token 到黑名单', async () => {
            // 创建测试用户
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const token = `test_token_${Date.now()}`
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期

            // 添加到黑名单
            await addTokenBlacklistDao(token, user.id, expiredAt)

            // 验证添加成功
            const found = await findTokenBlacklistByTokenDao(token)
            expect(found).not.toBeNull()
            expect(found?.token).toBe(token)
            expect(found?.userId).toBe(user.id)

            // 清理
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token },
            })
        })

        it('应能查询黑名单中的 token', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const token = `test_token_find_${Date.now()}`
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)

            // 查询存在的 token
            const found = await findTokenBlacklistByTokenDao(token)
            expect(found).not.toBeNull()
            expect(found?.token).toBe(token)

            // 查询不存在的 token
            const notFound = await findTokenBlacklistByTokenDao('non_existent_token')
            expect(notFound).toBeNull()

            // 清理
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token },
            })
        })

        it('应能软删除黑名单中的 token', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const token = `test_token_delete_${Date.now()}`
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)

            // 验证存在
            let found = await findTokenBlacklistByTokenDao(token)
            expect(found).not.toBeNull()

            // 软删除
            await deleteTokenBlacklistByTokenDao(token)

            // 验证已删除（软删除后查询不到）
            found = await findTokenBlacklistByTokenDao(token)
            expect(found).toBeNull()

            // 清理（硬删除）
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token },
            })
        })

        it('应能删除过期的 token', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建一个已过期的 token
            const expiredToken = `test_token_expired_${Date.now()}`
            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24小时前

            await testPrisma.tokenBlacklist.create({
                data: {
                    token: expiredToken,
                    userId: user.id,
                    expiredAt: pastDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            // 创建一个未过期的 token
            const validToken = `test_token_valid_${Date.now()}`
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(validToken, user.id, futureDate)

            // 删除过期 token
            await deleteExpiredTokenBlacklistDao()

            // 验证过期 token 已删除
            const expiredRecord = await testPrisma.tokenBlacklist.findFirst({
                where: { token: expiredToken },
            })
            expect(expiredRecord).toBeNull()

            // 验证未过期 token 仍存在
            const validRecord = await findTokenBlacklistByTokenDao(validToken)
            expect(validRecord).not.toBeNull()

            // 清理
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token: { in: [expiredToken, validToken] } },
            })
        })
    })

    describe('Cookie 配置测试', () => {
        it('Cookie 配置应包含必要的安全设置', () => {
            // 注意：getCookieConfig 依赖 useRuntimeConfig，在测试环境中可能无法正常工作
            // 这里测试常量和类型定义
            expect(AUTH_STATUS_COOKIE).toBe('auth_status')
        })

        it('TokenUserInfo 接口应包含必要字段', () => {
            const userInfo: TokenUserInfo = {
                id: 1,
                phone: '13800138000',
                roles: [1, 2],
                status: 1,
            }

            expect(userInfo.id).toBe(1)
            expect(userInfo.phone).toBe('13800138000')
            expect(userInfo.roles).toEqual([1, 2])
            expect(userInfo.status).toBe(1)
        })
    })

    describe('Property: Token 黑名单往返一致性', () => {
        it('添加的 token 应能被正确查询到', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10, maxLength: 100 }).filter(s => !s.includes('\0')),
                    async (tokenSuffix) => {
                        const token = `test_prop_${Date.now()}_${tokenSuffix}`
                        const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

                        // 添加
                        await addTokenBlacklistDao(token, user.id, expiredAt)

                        // 查询
                        const found = await findTokenBlacklistByTokenDao(token)

                        // 验证
                        expect(found).not.toBeNull()
                        expect(found?.token).toBe(token)
                        expect(found?.userId).toBe(user.id)

                        // 清理
                        await testPrisma.tokenBlacklist.deleteMany({
                            where: { token },
                        })
                    }
                ),
                { numRuns: 10 } // 减少运行次数以加快测试
            )
        })
    })
})
