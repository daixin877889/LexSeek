/**
 * 积分消费记录测试
 *
 * 测试积分消费相关功能，包括：
 * - 创建积分消费记录
 * - 查询用户积分消费记录列表
 * - 统计积分记录关联的消耗总量
 *
 * **Feature: point-consumption**
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
    pointRecordIds: [] as number[],
    pointConsumptionRecordIds: [] as number[],
    pointConsumptionItemIds: [] as number[],
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

// 创建测试积分记录
const createTestPointRecord = async (userId: number, pointAmount: number = 1000) => {
    const now = new Date()
    const record = await prisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: 0,
            remaining: pointAmount,
            sourceType: 2, // DIRECT_PURCHASE
            effectiveAt: now,
            expiredAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            status: 1,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.pointRecordIds.push(record.id)
    return record
}

// 创建测试积分消耗项目
const createTestPointConsumptionItem = async (options: { name?: string; pointAmount?: number; group?: string } = {}) => {
    const testId = generateTestId()
    const item = await prisma.pointConsumptionItems.create({
        data: {
            name: options.name ?? `测试消耗项目_${testId}`,
            description: '测试用积分消耗项目',
            group: options.group ?? 'test_group',
            unit: '次',
            pointAmount: options.pointAmount ?? 10,
            status: 1, // ENABLED
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.pointConsumptionItemIds.push(item.id)
    return item
}

// 创建测试积分消费记录
const createTestPointConsumptionRecord = async (
    userId: number,
    pointRecordId: number,
    itemId: number,
    pointAmount: number
) => {
    const record = await prisma.pointConsumptionRecords.create({
        data: {
            userId,
            pointRecordId,
            itemId,
            pointAmount,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.pointConsumptionRecordIds.push(record.id)
    return record
}

// 清理测试数据
const cleanupTestData = async () => {
    if (testIds.pointConsumptionRecordIds.length > 0) {
        await prisma.pointConsumptionRecords.deleteMany({
            where: { id: { in: testIds.pointConsumptionRecordIds } },
        })
        testIds.pointConsumptionRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.pointConsumptionRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
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
    if (testIds.pointConsumptionItemIds.length > 0) {
        await prisma.pointConsumptionItems.deleteMany({
            where: { id: { in: testIds.pointConsumptionItemIds } },
        })
        testIds.pointConsumptionItemIds = []
    }
    if (testIds.userIds.length > 0) {
        await prisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

describe('积分消费记录测试', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
            await prisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 1000))`
            await prisma.$executeRaw`SELECT setval('point_consumption_records_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_records), 1000))`
            await prisma.$executeRaw`SELECT setval('point_consumption_items_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_items), 1000))`
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

    describe('创建积分消费记录', () => {
        it('应成功创建积分消费记录', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 1000)
            const item = await createTestPointConsumptionItem({ pointAmount: 10 })

            const consumptionRecord = await createTestPointConsumptionRecord(
                user.id,
                pointRecord.id,
                item.id,
                10
            )

            expect(consumptionRecord.id).toBeGreaterThan(0)
            expect(consumptionRecord.userId).toBe(user.id)
            expect(consumptionRecord.pointRecordId).toBe(pointRecord.id)
            expect(consumptionRecord.itemId).toBe(item.id)
            expect(consumptionRecord.pointAmount).toBe(10)
        })

        it('属性测试：消费记录应保留所有输入属性', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 10000)
            const item = await createTestPointConsumptionItem()

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async (pointAmount) => {
                        const record = await createTestPointConsumptionRecord(
                            user.id,
                            pointRecord.id,
                            item.id,
                            pointAmount
                        )

                        expect(record.userId).toBe(user.id)
                        expect(record.pointRecordId).toBe(pointRecord.id)
                        expect(record.itemId).toBe(item.id)
                        expect(record.pointAmount).toBe(pointAmount)

                        // 清理
                        await prisma.pointConsumptionRecords.delete({ where: { id: record.id } })
                        testIds.pointConsumptionRecordIds = testIds.pointConsumptionRecordIds.filter(
                            id => id !== record.id
                        )
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('查询用户积分消费记录列表', () => {
        it('应正确分页返回消费记录', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 1000)
            const item = await createTestPointConsumptionItem()

            // 创建 5 条消费记录
            for (let i = 0; i < 5; i++) {
                await createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, 10)
            }

            const page1 = await prisma.pointConsumptionRecords.findMany({
                where: { userId: user.id, deletedAt: null },
                skip: 0,
                take: 2,
                orderBy: { createdAt: 'desc' },
                include: { pointConsumptionItems: true },
            })

            const page2 = await prisma.pointConsumptionRecords.findMany({
                where: { userId: user.id, deletedAt: null },
                skip: 2,
                take: 2,
                orderBy: { createdAt: 'desc' },
                include: { pointConsumptionItems: true },
            })

            expect(page1.length).toBe(2)
            expect(page2.length).toBe(2)
        })

        it('应包含关联的消耗项目信息', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 1000)
            const item = await createTestPointConsumptionItem({ name: '测试项目' })

            await createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, 10)

            const records = await prisma.pointConsumptionRecords.findMany({
                where: { userId: user.id, deletedAt: null },
                include: { pointConsumptionItems: true },
            })

            expect(records.length).toBe(1)
            expect(records[0].pointConsumptionItems).not.toBeNull()
            expect(records[0].pointConsumptionItems.name).toBe('测试项目')
        })
    })

    describe('统计积分记录关联的消耗总量', () => {
        it('应正确计算消耗总量', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 1000)
            const item = await createTestPointConsumptionItem()

            // 创建多条消费记录
            await createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, 10)
            await createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, 20)
            await createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, 30)

            const result = await prisma.pointConsumptionRecords.aggregate({
                where: { pointRecordId: pointRecord.id, deletedAt: null },
                _sum: { pointAmount: true },
            })

            expect(result._sum.pointAmount).toBe(60)
        })

        it('属性测试：消耗总量应等于所有消费记录之和', async () => {
            const user = await createTestUser()
            const pointRecord = await createTestPointRecord(user.id, 10000)
            const item = await createTestPointConsumptionItem()

            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
                    async (amounts) => {
                        const records = await Promise.all(
                            amounts.map(amount =>
                                createTestPointConsumptionRecord(user.id, pointRecord.id, item.id, amount)
                            )
                        )

                        const result = await prisma.pointConsumptionRecords.aggregate({
                            where: { pointRecordId: pointRecord.id, deletedAt: null },
                            _sum: { pointAmount: true },
                        })

                        const expectedTotal = amounts.reduce((sum, amount) => sum + amount, 0)
                        expect(result._sum.pointAmount).toBe(expectedTotal)

                        // 清理
                        await prisma.pointConsumptionRecords.deleteMany({
                            where: { id: { in: records.map(r => r.id) } },
                        })
                        testIds.pointConsumptionRecordIds = testIds.pointConsumptionRecordIds.filter(
                            id => !records.map(r => r.id).includes(id)
                        )
                    }
                ),
                { numRuns: 5 }
            )
        })
    })

    describe('积分消耗项目查询', () => {
        it('应只返回启用状态的项目', async () => {
            // 创建启用和禁用的项目
            const enabledItem = await createTestPointConsumptionItem({ name: '启用项目' })
            const disabledItem = await prisma.pointConsumptionItems.create({
                data: {
                    name: `禁用项目_${generateTestId()}`,
                    description: '测试用',
                    group: 'test_group',
                    unit: '次',
                    pointAmount: 10,
                    status: 0, // DISABLED
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.pointConsumptionItemIds.push(disabledItem.id)

            const enabledItems = await prisma.pointConsumptionItems.findMany({
                where: { status: 1, deletedAt: null },
                orderBy: { id: 'asc' },
            })

            const enabledIds = enabledItems.map(i => i.id)
            expect(enabledIds).toContain(enabledItem.id)
            expect(enabledIds).not.toContain(disabledItem.id)
        })
    })
})
