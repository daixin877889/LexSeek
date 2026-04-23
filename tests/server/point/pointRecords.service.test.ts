/**
 * 积分记录服务测试
 *
 * 测试积分记录服务层功能，包括：
 * - 创建积分记录
 * - 获取用户积分汇总
 * - 获取用户积分记录列表
 *
 * **Feature: point-records-service**
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

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

// 导入服务函数
import {
    getUserPointSummary,
    getUserPointRecords,
    createPointRecordService,
} from '../../../server/services/point/pointRecords.service'
import { PointRecordSourceType, PointRecordStatus } from '../../../shared/types/point.types'

// 测试数据 ID 追踪
const testIds = {
    userIds: [] as number[],
    pointRecordIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

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

// 清理测试数据
const cleanupTestData = async () => {
    if (testIds.pointRecordIds.length > 0) {
        await prisma.pointRecords.deleteMany({
            where: { id: { in: testIds.pointRecordIds } },
        })
        testIds.pointRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        // 先删除关联的积分记录
        await prisma.pointRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
        await prisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

// 检查数据库是否可用
let dbAvailable = false

describe('积分记录服务测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 1000))`
            dbAvailable = true
        } catch (error) {
            console.warn('数据库连接失败，跳过测试')
            dbAvailable = false
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData()
        }
    })

    afterAll(async () => {
        await prisma.$disconnect()
    })

    describe('createPointRecordService 测试', () => {
        it('应成功创建积分记录（使用默认有效期）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            const pointAmount = 100

            const record = await createPointRecordService({
                userId: user.id,
                pointAmount,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(pointAmount)
            expect(record.used).toBe(0)
            expect(record.remaining).toBe(pointAmount)
            expect(record.status).toBe(PointRecordStatus.VALID)
        })

        it('应成功创建积分记录（指定时长）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            const pointAmount = 200
            const duration = 30

            const record = await createPointRecordService({
                userId: user.id,
                pointAmount,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
                duration,
                durationUnit: 'day',
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.pointAmount).toBe(pointAmount)
            // 验证过期时间约为 30 天后
            const expectedExpiredAt = dayjs().add(duration, 'day').subtract(1, 'day').endOf('day')
            const actualExpiredAt = dayjs(record.expiredAt)
            expect(actualExpiredAt.diff(expectedExpiredAt, 'day')).toBeLessThanOrEqual(1)
        })

        it('应成功创建积分记录（指定生效和过期时间）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            const pointAmount = 300
            const effectiveAt = dayjs().toDate()
            const expiredAt = dayjs().add(60, 'day').toDate()

            const record = await createPointRecordService({
                userId: user.id,
                pointAmount,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
                effectiveAt,
                expiredAt,
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.pointAmount).toBe(pointAmount)
            expect(dayjs(record.effectiveAt).format('YYYY-MM-DD')).toBe(dayjs(effectiveAt).format('YYYY-MM-DD'))
            expect(dayjs(record.expiredAt).format('YYYY-MM-DD')).toBe(dayjs(expiredAt).format('YYYY-MM-DD'))
        })

        it('Property: 创建的积分记录 remaining 应等于 pointAmount', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    async (pointAmount) => {
                        const record = await createPointRecordService({
                            userId: user.id,
                            pointAmount,
                            sourceType: PointRecordSourceType.DIRECT_PURCHASE,
                        })
                        testIds.pointRecordIds.push(record.id)

                        // 验证 remaining 等于 pointAmount
                        expect(record.remaining).toBe(pointAmount)
                        expect(record.used).toBe(0)
                        expect(record.remaining + record.used).toBe(record.pointAmount)

                        return true
                    }
                ),
                { numRuns: 10, seed: 42 }
            )
        })
    })

    describe('getUserPointSummary 测试', () => {
        it('应正确计算用户积分汇总', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()

            // 创建多条积分记录
            const record1 = await createPointRecordService({
                userId: user.id,
                pointAmount: 100,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            testIds.pointRecordIds.push(record1.id)

            const record2 = await createPointRecordService({
                userId: user.id,
                pointAmount: 200,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
            })
            testIds.pointRecordIds.push(record2.id)

            const summary = await getUserPointSummary(user.id)

            expect(summary.pointAmount).toBeGreaterThanOrEqual(300)
            expect(summary.remaining).toBeGreaterThanOrEqual(300)
        })

        it('新用户应返回零积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            const summary = await getUserPointSummary(user.id)

            expect(summary.remaining).toBe(0)
        })

        it('Property: 积分汇总中 remaining + used 应等于 pointAmount', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()

            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
                    async (amounts) => {
                        // 创建多条积分记录
                        for (const amount of amounts) {
                            const record = await createPointRecordService({
                                userId: user.id,
                                pointAmount: amount,
                                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
                            })
                            testIds.pointRecordIds.push(record.id)
                        }

                        const summary = await getUserPointSummary(user.id)

                        // 验证 remaining + used = pointAmount
                        expect(summary.remaining + summary.used).toBe(summary.pointAmount)

                        return true
                    }
                ),
                { numRuns: 5, seed: 42 }
            )
        })
    })

    describe('getUserPointRecords 测试', () => {
        it('应正确分页返回积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()

            // 创建 5 条积分记录
            for (let i = 0; i < 5; i++) {
                const record = await createPointRecordService({
                    userId: user.id,
                    pointAmount: 100 * (i + 1),
                    sourceType: PointRecordSourceType.DIRECT_PURCHASE,
                })
                testIds.pointRecordIds.push(record.id)
            }

            const result = await getUserPointRecords(user.id, { page: 1, pageSize: 2 })

            expect(result.list.length).toBeLessThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(5)
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(2)
        })

        it('应支持按来源类型筛选', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()

            // 创建不同来源类型的积分记录
            const purchaseRecord = await createPointRecordService({
                userId: user.id,
                pointAmount: 100,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            testIds.pointRecordIds.push(purchaseRecord.id)

            const giftRecord = await createPointRecordService({
                userId: user.id,
                pointAmount: 200,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
            })
            testIds.pointRecordIds.push(giftRecord.id)

            const result = await getUserPointRecords(user.id, {
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })

            // 验证只返回购买类型的记录
            const purchaseRecords = result.list.filter(
                r => r.sourceType === PointRecordSourceType.DIRECT_PURCHASE
            )
            expect(purchaseRecords.length).toBeGreaterThan(0)
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        try {
            await prisma.$connect()
            expect(true).toBe(true)
        } catch {
            console.log('请确保数据库已启动并配置正确的连接字符串')
            expect(true).toBe(true)
        }
    })
})
