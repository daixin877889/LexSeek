/**
 * Token 黑名单 DAO 覆盖测试
 *
 * 直接测试 tokenBlacklist.dao.ts 导出的函数
 *
 * **Feature: token-blacklist-coverage**
 * **Validates: Requirements 1.3, 1.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

import {
    addTokenBlacklistDao,
    findTokenBlacklistByTokenDao,
    deleteTokenBlacklistByTokenDao,
    deleteExpiredTokenBlacklistDao,
} from '../../../server/services/users/tokenBlacklist.dao'

// 设置全局变量
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

const createdUserIds: number[] = []
const createdTokens: string[] = []

describe('Token 黑名单 DAO 覆盖测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        // 清理 token 记录
        if (createdTokens.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token: { in: createdTokens } },
            })
        }
        if (createdUserIds.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { userId: { in: createdUserIds } },
            })
            await testPrisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        if (createdTokens.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token: { in: createdTokens } },
            })
            createdTokens.length = 0
        }
    })

    describe('addTokenBlacklistDao', () => {
        it('应成功添加 token 到黑名单', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_dao_token_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)

            // 验证已添加
            const found = await testPrisma.tokenBlacklist.findFirst({
                where: { token, deletedAt: null },
            })
            expect(found).not.toBeNull()
            expect(found!.token).toBe(token)
            expect(found!.userId).toBe(user.id)
        })

        it('使用事务客户端应正常工作', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_dao_tx_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt, testPrisma as any)

            const found = await testPrisma.tokenBlacklist.findFirst({
                where: { token, deletedAt: null },
            })
            expect(found).not.toBeNull()
        })
    })

    describe('findTokenBlacklistByTokenDao', () => {
        it('存在的 token 应返回记录', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_find_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)

            const found = await findTokenBlacklistByTokenDao(token)
            expect(found).not.toBeNull()
            expect(found!.token).toBe(token)
        })

        it('不存在的 token 应返回 null', async () => {
            const found = await findTokenBlacklistByTokenDao(`nonexistent_${Date.now()}`)
            expect(found).toBeNull()
        })

        it('已软删除的 token 应返回 null', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_softdel_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)
            await deleteTokenBlacklistByTokenDao(token)

            const found = await findTokenBlacklistByTokenDao(token)
            expect(found).toBeNull()
        })
    })

    describe('deleteTokenBlacklistByTokenDao', () => {
        it('应软删除 token', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_del_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)
            await deleteTokenBlacklistByTokenDao(token)

            // 记录应存在但已软删除
            const raw = await testPrisma.tokenBlacklist.findFirst({
                where: { token },
            })
            expect(raw).not.toBeNull()
            expect(raw!.deletedAt).not.toBeNull()
        })

        it('使用事务客户端应正常工作', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const token = `test_del_tx_${Date.now()}`
            createdTokens.push(token)
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenBlacklistDao(token, user.id, expiredAt)
            await deleteTokenBlacklistByTokenDao(token, testPrisma as any)

            const found = await findTokenBlacklistByTokenDao(token)
            expect(found).toBeNull()
        })
    })

    describe('deleteExpiredTokenBlacklistDao', () => {
        it('应删除过期的 token 记录', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            // 创建已过期的 token
            const expiredToken = `test_expired_${Date.now()}`
            createdTokens.push(expiredToken)
            await addTokenBlacklistDao(
                expiredToken,
                user.id,
                new Date(Date.now() - 1000) // 已过期
            )

            // 创建未过期的 token
            const validToken = `test_valid_${Date.now()}`
            createdTokens.push(validToken)
            await addTokenBlacklistDao(
                validToken,
                user.id,
                new Date(Date.now() + 24 * 60 * 60 * 1000)
            )

            await deleteExpiredTokenBlacklistDao()

            // 过期的应已删除
            const expiredFound = await testPrisma.tokenBlacklist.findFirst({
                where: { token: expiredToken },
            })
            expect(expiredFound).toBeNull()

            // 未过期的应仍存在
            const validFound = await findTokenBlacklistByTokenDao(validToken)
            expect(validFound).not.toBeNull()
        })

        it('使用事务客户端应正常工作', async () => {
            await deleteExpiredTokenBlacklistDao(testPrisma as any)
            // 不抛错即为通过
        })
    })
})
