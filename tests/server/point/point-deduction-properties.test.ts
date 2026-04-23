/**
 * 积分扣减属性测试
 *
 * 测试积分扣减服务的核心属性，包括：
 * - Property 3: 积分扣减数据一致性
 * - Property 4: 积分扣减优先级正确性
 * - Property 5: 积分不足阻止操作
 *
 * **Feature: case-analysis**
 * **Validates: Requirements 16.6, 16.7, 16.8, 16.9, 16.15, 16.16**
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

// 设置全局变量（服务层依赖）
// @ts-expect-error 全局变量注入
globalThis.prisma = prisma
// @ts-expect-error 全局变量注入
globalThis.logger = { info: console.log, error: console.error, warn: console.warn, debug: console.debug }
// @ts-expect-error 全局变量注入
globalThis.PointConsumptionItemStatus = { ENABLED: 1, DISABLED: 0 }
// @ts-expect-error 全局变量注入
globalThis.PointConsumptionRecordStatus = { INVALID: 0, PRE_DEDUCT: 1, SETTLED: 2 }

// 导入服务函数
import { getUserPointSummary } from '../../../server/services/point/pointRecords.service'
import { consumePointsService } from '../../../server/services/point/pointConsumption.service'
import { PointRecordSourceType, PointRecordStatus, PointConsumptionItemStatus } from '../../../shared/types/point.types'

// 测试数据 ID 追踪
const testIds = {
    userIds: [] as number[],
    pointRecordIds: [] as number[],
    pointConsumptionItemIds: [] as number[],
    pointConsumptionRecordIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试用户
const createTestUser = async () => {
    const testId = generateTestId()
    const user = await prisma.users.create({
        data: {
            phone: `199${Date.now().toString().slice(-8)}`,
            name: `测试用户_${testId}`,
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

// 创建测试积分记录（支持指定过期时间）
const createTestPointRecord = async (
    userId: number,
    pointAmount: number,
    expiredAt?: Date
) => {
    const now = new Date()
    const defaultExpiredAt = expiredAt || new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
    const record = await prisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: 0,
            remaining: pointAmount,
            sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            effectiveAt: now,
            expiredAt: defaultExpiredAt,
            status: PointRecordStatus.VALID,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.pointRecordIds.push(record.id)
    return record
}

// 创建测试积分消耗项目（带 key 字段，用于新 API）
const createTestPointConsumptionItem = async (options: {
    name?: string
    pointAmount?: number
    discount?: number
} = {}) => {
    const testId = generateTestId()
    const itemKey = `test_item_${testId}`
    const item = await prisma.pointConsumptionItems.create({
        data: {
            key: itemKey,
            name: options.name ?? `测试消耗项目_${testId}`,
            description: '测试用积分消耗项目',
            group: 'test_group',
            unit: '次',
            pointAmount: options.pointAmount ?? 10,
            discount: options.discount ?? 1,
            status: PointConsumptionItemStatus.ENABLED,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.pointConsumptionItemIds.push(item.id)
    return { ...item, itemKey }
}

// 清理测试数据
const cleanupTestData = async () => {
    // 先删除消耗记录
    if (testIds.userIds.length > 0) {
        await prisma.pointConsumptionRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
    // 删除积分记录
    if (testIds.pointRecordIds.length > 0) {
        await prisma.pointRecords.deleteMany({
            where: { id: { in: testIds.pointRecordIds } },
        })
        testIds.pointRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.pointRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
    // 删除消耗项目
    if (testIds.pointConsumptionItemIds.length > 0) {
        await prisma.pointConsumptionItems.deleteMany({
            where: { id: { in: testIds.pointConsumptionItemIds } },
        })
        testIds.pointConsumptionItemIds = []
    }
    // 删除用户
    if (testIds.userIds.length > 0) {
        await prisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

// 检查数据库是否可用
let dbAvailable = false

describe('积分扣减属性测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 1000))`
            await prisma.$executeRaw`SELECT setval('point_consumption_items_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_items), 1000))`
            await prisma.$executeRaw`SELECT setval('point_consumption_records_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_records), 1000))`
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

    /**
     * Property 3: 积分扣减数据一致性
     * 
     * *For any* 积分扣减操作，扣减前的总可用积分减去扣减数量应等于扣减后的总可用积分，
     * 且所有积分记录的 remaining 字段之和应保持一致。
     * 
     * **Feature: case-analysis, Property 3: 积分扣减数据一致性**
     * **Validates: Requirements 16.9, 16.16**
     */
    describe('Property 3: 积分扣减数据一致性', () => {
        it('扣减前后积分总量应保持一致（扣减前 - 扣减量 = 扣减后）', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    // 生成积分记录数量（1-3条）
                    fc.integer({ min: 1, max: 3 }),
                    // 生成每条记录的积分数量（100-500）
                    fc.integer({ min: 100, max: 500 }),
                    // 生成扣减数量（10-100）
                    fc.integer({ min: 10, max: 100 }),
                    async (recordCount, pointPerRecord, deductAmount) => {
                        // 创建测试用户
                        const user = await createTestUser()

                        // 创建多条积分记录
                        const totalPoints = recordCount * pointPerRecord
                        for (let i = 0; i < recordCount; i++) {
                            await createTestPointRecord(user.id, pointPerRecord)
                        }

                        // 创建消耗项目
                        const item = await createTestPointConsumptionItem({ pointAmount: deductAmount })

                        // 获取扣减前的积分汇总
                        const summaryBefore = await getUserPointSummary(user.id)
                        const remainingBefore = summaryBefore.remaining

                        // 执行扣减（使用新的 consumePointsService，quantity=1 表示消耗 1 次）
                        const result = await consumePointsService(user.id, item.itemKey, 1)

                        // 获取扣减后的积分汇总
                        const summaryAfter = await getUserPointSummary(user.id)
                        const remainingAfter = summaryAfter.remaining

                        // 验证：扣减前 - 扣减量 = 扣减后
                        expect(remainingBefore - result.consumedAmount).toBe(remainingAfter)

                        // 验证：remaining + used = pointAmount（数据一致性）
                        expect(summaryAfter.remaining + summaryAfter.used).toBe(summaryAfter.pointAmount)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    /**
     * Property 4: 积分扣减优先级正确性
     * 
     * *For any* 涉及多条积分记录的扣减操作，应优先扣减到期时间最早的积分记录，
     * 直到该记录的 remaining 为 0 后再扣减下一条。
     * 
     * **Feature: case-analysis, Property 4: 积分扣减优先级正确性**
     * **Validates: Requirements 16.8, 16.15**
     */
    describe('Property 4: 积分扣减优先级正确性', () => {
        it('应优先扣减到期时间最早的积分记录（FIFO）', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    // 生成扣减数量（50-150，确保需要跨记录扣减）
                    fc.integer({ min: 50, max: 150 }),
                    async (deductAmount) => {
                        // 创建测试用户
                        const user = await createTestUser()

                        // 创建三条积分记录，过期时间不同
                        const now = new Date()
                        const record1 = await createTestPointRecord(
                            user.id,
                            100,
                            new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) // 10天后过期（最早）
                        )
                        const record2 = await createTestPointRecord(
                            user.id,
                            100,
                            new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30天后过期
                        )
                        const record3 = await createTestPointRecord(
                            user.id,
                            100,
                            new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) // 60天后过期（最晚）
                        )

                        // 创建消耗项目
                        const item = await createTestPointConsumptionItem({ pointAmount: deductAmount })

                        // 执行扣减（使用新的 consumePointsService，quantity=1 表示消耗 1 次）
                        await consumePointsService(user.id, item.itemKey, 1)

                        // 查询扣减后的积分记录
                        const updatedRecords = await prisma.pointRecords.findMany({
                            where: { id: { in: [record1.id, record2.id, record3.id] } },
                            orderBy: { expiredAt: 'asc' },
                        })

                        // 验证 FIFO 顺序：
                        // 如果扣减量 <= 100，只有 record1 被扣减
                        // 如果扣减量 <= 200，record1 完全扣减，record2 部分扣减
                        // 如果扣减量 <= 300，record1、record2 完全扣减，record3 部分扣减

                        const r1 = updatedRecords.find(r => r.id === record1.id)!
                        const r2 = updatedRecords.find(r => r.id === record2.id)!
                        const r3 = updatedRecords.find(r => r.id === record3.id)!

                        if (deductAmount <= 100) {
                            // 只扣减 record1
                            expect(r1.remaining).toBe(100 - deductAmount)
                            expect(r2.remaining).toBe(100)
                            expect(r3.remaining).toBe(100)
                        } else if (deductAmount <= 200) {
                            // record1 完全扣减，record2 部分扣减
                            expect(r1.remaining).toBe(0)
                            expect(r2.remaining).toBe(200 - deductAmount)
                            expect(r3.remaining).toBe(100)
                        } else {
                            // record1、record2 完全扣减，record3 部分扣减
                            expect(r1.remaining).toBe(0)
                            expect(r2.remaining).toBe(0)
                            expect(r3.remaining).toBe(300 - deductAmount)
                        }

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    /**
     * Property 5: 积分不足阻止操作
     * 
     * *For any* 积分扣减请求，当用户可用积分小于所需积分时，
     * 操作应被阻止且不产生任何积分变动。
     * 
     * **Feature: case-analysis, Property 5: 积分不足阻止操作**
     * **Validates: Requirements 16.6, 16.7**
     */
    describe('Property 5: 积分不足阻止操作', () => {
        it('积分不足时应抛出错误且不产生任何变动', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    // 生成用户积分（10-100）
                    fc.integer({ min: 10, max: 100 }),
                    // 生成扣减数量（比用户积分多 1-100）
                    fc.integer({ min: 1, max: 100 }),
                    async (userPoints, extraAmount) => {
                        // 创建测试用户
                        const user = await createTestUser()

                        // 创建积分记录
                        await createTestPointRecord(user.id, userPoints)

                        // 创建消耗项目（扣减数量大于用户积分）
                        const deductAmount = userPoints + extraAmount
                        const item = await createTestPointConsumptionItem({ pointAmount: deductAmount })

                        // 获取扣减前的积分汇总
                        const summaryBefore = await getUserPointSummary(user.id)

                        // 执行扣减，应抛出错误（使用新的 consumePointsService）
                        let errorThrown = false
                        try {
                            await consumePointsService(user.id, item.itemKey, 1)
                        } catch (error: any) {
                            errorThrown = true
                            expect(error.message).toContain('积分不足')
                        }

                        // 验证错误被抛出
                        expect(errorThrown).toBe(true)

                        // 获取扣减后的积分汇总
                        const summaryAfter = await getUserPointSummary(user.id)

                        // 验证：积分没有变动
                        expect(summaryAfter.remaining).toBe(summaryBefore.remaining)
                        expect(summaryAfter.used).toBe(summaryBefore.used)
                        expect(summaryAfter.pointAmount).toBe(summaryBefore.pointAmount)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
