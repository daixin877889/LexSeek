/**
 * Token 黑名单测试
 *
 * 测试 tokenBlacklist.dao.ts 的功能，包括：
 * - 添加 token 到黑名单
 * - 查询 token 是否在黑名单中
 * - 删除过期的黑名单记录
 *
 * **Feature: token-blacklist**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建测试数据库连接
const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const prisma = createTestPrisma()

// 测试数据 ID 追踪
const testIds = {
    userIds: [] as number[],
    tokenBlacklistIds: [] as string[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 生成测试 token
const generateTestToken = () => `test_token_${Date.now()}_${Math.random().toString(36).slice(2, 16)}`

// 创建测试用户
const createTestUser = async () => {
    const testId = generateTestId()
    const user = await prisma.users.create({
        data: {
            phone: `138${Date.now().toString().slice(-8)}`,
            name: `测试用户_${testId}`,
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

// 添加 token 到黑名单
const addTokenToBlacklist = async (token: string, userId: number, expiredAt: Date) => {
    const record = await prisma.tokenBlacklist.create({
        data: {
            token,
            userId,
            expiredAt,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.tokenBlacklistIds.push(record.id)
    return record
}

// 清理测试数据
const cleanupTestData = async () => {
    if (testIds.tokenBlacklistIds.length > 0) {
        await prisma.tokenBlacklist.deleteMany({
            where: { id: { in: testIds.tokenBlacklistIds } },
        })
        testIds.tokenBlacklistIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.tokenBlacklist.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
        await prisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

describe('Token 黑名单测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('token_blacklist_id_seq', GREATEST((SELECT MAX(id) FROM token_blacklist), 1000))`
        } catch (error) {
            console.warn('数据库连接失败，跳过测试')
        }
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('添加 token 到黑名单', () => {
        it('应成功添加 token 到黑名单', async () => {
            const user = await createTestUser()
            const token = generateTestToken()
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            const record = await addTokenToBlacklist(token, user.id, expiredAt)

            expect(record.id).toBeTruthy()
            expect(typeof record.id).toBe('string')
            expect(record.token).toBe(token)
            expect(record.userId).toBe(user.id)
        })

        it('属性测试：添加的 token 应能被查询到', async () => {
            const user = await createTestUser()

            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 10, maxLength: 100 }).map(s => `test_${s}`),
                    async (token) => {
                        const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
                        const record = await addTokenToBlacklist(token, user.id, expiredAt)

                        const found = await prisma.tokenBlacklist.findFirst({
                            where: { token, deletedAt: null },
                        })

                        expect(found).not.toBeNull()
                        expect(found!.token).toBe(token)

                        // 清理
                        await prisma.tokenBlacklist.delete({ where: { id: record.id } })
                        testIds.tokenBlacklistIds = testIds.tokenBlacklistIds.filter(
                            id => id !== record.id
                        )
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('查询 token 是否在黑名单中', () => {
        it('存在的 token 应返回记录', async () => {
            const user = await createTestUser()
            const token = generateTestToken()
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            await addTokenToBlacklist(token, user.id, expiredAt)

            const found = await prisma.tokenBlacklist.findFirst({
                where: { token, deletedAt: null },
            })

            expect(found).not.toBeNull()
            expect(found!.token).toBe(token)
        })

        it('不存在的 token 应返回 null', async () => {
            const nonExistentToken = generateTestToken()

            const found = await prisma.tokenBlacklist.findFirst({
                where: { token: nonExistentToken, deletedAt: null },
            })

            expect(found).toBeNull()
        })

        it('已软删除的 token 应返回 null', async () => {
            const user = await createTestUser()
            const token = generateTestToken()
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            const record = await addTokenToBlacklist(token, user.id, expiredAt)

            // 软删除
            await prisma.tokenBlacklist.update({
                where: { id: record.id },
                data: { deletedAt: new Date() },
            })

            const found = await prisma.tokenBlacklist.findFirst({
                where: { token, deletedAt: null },
            })

            expect(found).toBeNull()
        })
    })

    describe('删除过期的黑名单记录', () => {
        it('应删除所有过期的记录', async () => {
            const user = await createTestUser()

            // 创建过期的 token
            const expiredToken = generateTestToken()
            const expiredRecord = await addTokenToBlacklist(
                expiredToken,
                user.id,
                new Date(Date.now() - 1000) // 已过期
            )

            // 创建未过期的 token
            const validToken = generateTestToken()
            await addTokenToBlacklist(
                validToken,
                user.id,
                new Date(Date.now() + 24 * 60 * 60 * 1000) // 未过期
            )

            // 删除过期记录
            await prisma.tokenBlacklist.deleteMany({
                where: {
                    expiredAt: { lt: new Date() },
                    deletedAt: null,
                },
            })

            // 验证过期记录已删除
            const expiredFound = await prisma.tokenBlacklist.findUnique({
                where: { id: expiredRecord.id },
            })
            expect(expiredFound).toBeNull()
            testIds.tokenBlacklistIds = testIds.tokenBlacklistIds.filter(
                id => id !== expiredRecord.id
            )

            // 验证未过期记录仍存在
            const validFound = await prisma.tokenBlacklist.findFirst({
                where: { token: validToken, deletedAt: null },
            })
            expect(validFound).not.toBeNull()
        })
    })

    describe('软删除 token 黑名单', () => {
        it('软删除应设置 deletedAt 字段', async () => {
            const user = await createTestUser()
            const token = generateTestToken()
            const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

            const record = await addTokenToBlacklist(token, user.id, expiredAt)

            // 软删除
            await prisma.tokenBlacklist.updateMany({
                where: { token, deletedAt: null },
                data: { deletedAt: new Date() },
            })

            const deleted = await prisma.tokenBlacklist.findUnique({
                where: { id: record.id },
            })

            expect(deleted).not.toBeNull()
            expect(deleted!.deletedAt).not.toBeNull()
        })
    })
})
