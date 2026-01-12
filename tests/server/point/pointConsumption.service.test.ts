/**
 * 统一积分消耗服务测试
 *
 * 测试积分查询、直接扣减、预扣、结算、回滚等核心功能
 * 包含属性测试验证正确性属性
 *
 * **Feature: unified-point-service**
 * **Validates: Requirements 1.1-1.5, 2.1-2.4, 3.1-3.5, 4.1-4.5, 5.1-5.5, 6.1-6.4, 7.1-7.4, 8.1-8.4**
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

const testPrisma = createTestPrisma()

// 在导入服务之前设置全局变量
const mockLogger = {
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args),
    debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}
    ; (globalThis as any).logger = mockLogger
    ; (globalThis as any).prisma = testPrisma
    ; (globalThis as any).PointConsumptionItemStatus = { DISABLED: 0, ENABLED: 1 }
    ; (globalThis as any).PointConsumptionRecordStatus = { INVALID: 0, PRE_DEDUCT: 1, SETTLED: 2 }
    ; (globalThis as any).PointRecordStatus = { VALID: 1, MEMBERSHIP_UPGRADE_SETTLEMENT: 2, CANCELLED: 3 }

// 导入服务函数
import {
    checkPointsService,
    consumePointsService,
    preDeductPointsService,
    settlePointsService,
    rollbackPreDeductService,
    getConsumptionItemByKeyService,
    getAvailableConsumptionItemsService,
    getConsumptionRecordsService,
} from '../../../server/services/point/pointConsumption.service'

import {
    findConsumptionItemByKeyDao,
    findAvailableConsumptionItemsDao,
    findPreDeductRecordsByBatchIdDao,
    findValidPointRecordsForConsumeDao,
} from '../../../server/services/point/pointConsumption.dao'

import {
    PointRecordSourceType,
    PointRecordStatus,
    PointConsumptionItemStatus,
    PointConsumptionRecordStatus,
} from '../../../shared/types/point.types'

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
    const user = await testPrisma.users.create({
        data: {
            phone: `188${Date.now().toString().slice(-8)}`,
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
    const record = await testPrisma.pointRecords.create({
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

// 创建测试积分消耗项目（带 key）
const createTestPointConsumptionItem = async (options: {
    name?: string
    key?: string
    pointAmount?: number
    discount?: number
    status?: number
} = {}) => {
    const testId = generateTestId()
    const item = await testPrisma.pointConsumptionItems.create({
        data: {
            name: options.name ?? `测试消耗项目_${testId}`,
            key: options.key ?? `test_key_${testId}`,
            description: '测试用积分消耗项目',
            group: 'test_group',
            unit: '次',
            pointAmount: options.pointAmount ?? 10,
            discount: options.discount ?? 1,
            status: options.status ?? PointConsumptionItemStatus.ENABLED,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.pointConsumptionItemIds.push(item.id)
    return item
}

// 清理测试数据
const cleanupTestData = async () => {
    // 先删除消耗记录
    if (testIds.userIds.length > 0) {
        await testPrisma.pointConsumptionRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
    // 删除积分记录
    if (testIds.pointRecordIds.length > 0) {
        await testPrisma.pointRecords.deleteMany({
            where: { id: { in: testIds.pointRecordIds } },
        })
        testIds.pointRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        await testPrisma.pointRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
    // 删除消耗项目
    if (testIds.pointConsumptionItemIds.length > 0) {
        await testPrisma.pointConsumptionItems.deleteMany({
            where: { id: { in: testIds.pointConsumptionItemIds } },
        })
        testIds.pointConsumptionItemIds = []
    }
    // 删除用户
    if (testIds.userIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

// 检查数据库是否可用
let dbAvailable = false

describe('统一积分消耗服务测试', () => {
    beforeAll(async () => {
        try {
            await testPrisma.$connect()
            await testPrisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 2000))`
            await testPrisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 2000))`
            await testPrisma.$executeRaw`SELECT setval('point_consumption_items_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_items), 2000))`
            await testPrisma.$executeRaw`SELECT setval('point_consumption_records_id_seq', GREATEST((SELECT MAX(id) FROM point_consumption_records), 2000))`
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
        await testPrisma.$disconnect()
    })

    // ==================== DAO 层测试 ====================
    describe('DAO 层测试', () => {
        describe('findConsumptionItemByKeyDao - 通过 key 查询消耗项目', () => {
            it('应通过 key 返回消耗项目', async () => {
                if (!dbAvailable) return
                const item = await createTestPointConsumptionItem({ key: 'test_dao_key' })
                const result = await findConsumptionItemByKeyDao('test_dao_key')
                expect(result).not.toBeNull()
                expect(result!.id).toBe(item.id)
                expect(result!.key).toBe('test_dao_key')
            })

            it('应在 key 不存在时返回 null', async () => {
                if (!dbAvailable) return
                const result = await findConsumptionItemByKeyDao('non_existent_key')
                expect(result).toBeNull()
            })
        })

        describe('findAvailableConsumptionItemsDao - 查询可用消耗项目', () => {
            it('应只返回启用且有 key 的消耗项目', async () => {
                if (!dbAvailable) return
                const enabledItem = await createTestPointConsumptionItem({ key: 'enabled_key' })
                const disabledItem = await createTestPointConsumptionItem({ key: 'disabled_key', status: 0 })

                const result = await findAvailableConsumptionItemsDao()
                const keys = result.map(i => i.key)

                expect(keys).toContain('enabled_key')
                expect(keys).not.toContain('disabled_key')
            })
        })

        describe('findPreDeductRecordsByBatchIdDao - 通过批次 ID 查询预扣记录', () => {
            it('应返回指定批次的所有预扣记录', async () => {
                if (!dbAvailable) return
                const user = await createTestUser()
                const pointRecord = await createTestPointRecord(user.id, 100)
                const item = await createTestPointConsumptionItem({ key: 'batch_test_key', pointAmount: 10 })

                // 执行预扣
                const preDeductResult = await preDeductPointsService(user.id, 'batch_test_key', 1)

                // 查询预扣记录
                const records = await findPreDeductRecordsByBatchIdDao(preDeductResult.batchId)

                expect(records.length).toBeGreaterThan(0)
                expect(records[0].batchId).toBe(preDeductResult.batchId)
                expect(records[0].pointRecords).toBeDefined()
                expect(records[0].pointConsumptionItems).toBeDefined()
            })
        })
    })

    // ==================== 服务层测试 ====================
    describe('getConsumptionItemByKeyService - 获取消耗项目', () => {
        it('应通过 key 返回启用的消耗项目', async () => {
            if (!dbAvailable) return
            const item = await createTestPointConsumptionItem({ key: 'service_test_key' })
            const result = await getConsumptionItemByKeyService('service_test_key')
            expect(result.id).toBe(item.id)
            expect(result.key).toBe('service_test_key')
        })

        it('应在消耗项目不存在时抛出错误', async () => {
            if (!dbAvailable) return
            await expect(getConsumptionItemByKeyService('invalid_key')).rejects.toThrow('消耗项目不存在: invalid_key')
        })

        it('应在消耗项目已禁用时抛出错误', async () => {
            if (!dbAvailable) return
            await createTestPointConsumptionItem({ key: 'disabled_service_key', status: 0 })
            await expect(getConsumptionItemByKeyService('disabled_service_key')).rejects.toThrow('消耗项目已禁用: disabled_service_key')
        })
    })

    describe('getAvailableConsumptionItemsService - 获取可用消耗项目列表', () => {
        it('应返回所有启用且有 key 的消耗项目', async () => {
            if (!dbAvailable) return
            await createTestPointConsumptionItem({ key: 'available_key_1', name: '项目1', pointAmount: 10 })
            await createTestPointConsumptionItem({ key: 'available_key_2', name: '项目2', pointAmount: 20 })

            const result = await getAvailableConsumptionItemsService()
            const keys = result.map(i => i.key)

            expect(keys).toContain('available_key_1')
            expect(keys).toContain('available_key_2')

            const item1 = result.find(i => i.key === 'available_key_1')
            expect(item1).toBeDefined()
            expect(item1!.name).toBe('项目1')
            expect(item1!.pointAmount).toBe(10)
        })
    })

    // ==================== 属性测试 ====================
    /**
     * Property 1: 积分查询正确性
     * Property 2: 积分充足性判断正确性
     * 
     * *For any* 用户和其积分记录集合，查询返回的可用积分应等于所有有效积分记录的 remaining 之和
     * checkPoints 返回的 sufficient 字段应等于 (available >= required)
     * 
     * **Feature: unified-point-service, Property 1 & 2**
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
     */
    describe('Property 1 & 2: 积分查询正确性和充足性判断', () => {
        it('查询返回的可用积分应等于所有有效积分记录的 remaining 之和', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 10, max: 500 }), { minLength: 1, maxLength: 5 }),
                    fc.integer({ min: 1, max: 10 }),
                    async (pointAmounts, quantity) => {
                        const user = await createTestUser()
                        const item = await createTestPointConsumptionItem({
                            key: `check_${generateTestId()}`,
                            pointAmount: 10
                        })

                        // 创建多条积分记录
                        for (const amount of pointAmounts) {
                            await createTestPointRecord(user.id, amount)
                        }

                        const expectedTotal = pointAmounts.reduce((sum, a) => sum + a, 0)
                        const result = await checkPointsService(user.id, item.key!, quantity)

                        // 验证可用积分等于所有记录的 remaining 之和
                        expect(result.available).toBe(expectedTotal)

                        // 验证充足性判断正确
                        const required = 10 * quantity // pointAmount * quantity
                        expect(result.sufficient).toBe(expectedTotal >= required)
                        expect(result.required).toBe(required)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    /**
     * Property 4: FIFO 扣减策略
     * Property 5: 积分不足时数据不变性
     * Property 6: 扣减结果正确性
     * 
     * **Feature: unified-point-service, Property 4, 5, 6**
     * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
     */
    describe('Property 4, 5, 6: 直接扣减属性测试', () => {
        it('Property 4: 应按 FIFO 策略优先扣减即将过期的积分', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 50, max: 150 }),
                    async (deductAmount) => {
                        const user = await createTestUser()
                        const item = await createTestPointConsumptionItem({
                            key: `fifo_${generateTestId()}`,
                            pointAmount: deductAmount
                        })

                        const now = new Date()
                        // 创建三条积分记录，过期时间不同
                        const record1 = await createTestPointRecord(user.id, 100, new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000))
                        const record2 = await createTestPointRecord(user.id, 100, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
                        const record3 = await createTestPointRecord(user.id, 100, new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000))

                        await consumePointsService(user.id, item.key!, 1)

                        // 查询扣减后的积分记录
                        const updatedRecords = await testPrisma.pointRecords.findMany({
                            where: { id: { in: [record1.id, record2.id, record3.id] } },
                            orderBy: { expiredAt: 'asc' },
                        })

                        const r1 = updatedRecords.find(r => r.id === record1.id)!
                        const r2 = updatedRecords.find(r => r.id === record2.id)!
                        const r3 = updatedRecords.find(r => r.id === record3.id)!

                        // 验证 FIFO 顺序
                        if (deductAmount <= 100) {
                            expect(r1.remaining).toBe(100 - deductAmount)
                            expect(r2.remaining).toBe(100)
                            expect(r3.remaining).toBe(100)
                        } else if (deductAmount <= 200) {
                            expect(r1.remaining).toBe(0)
                            expect(r2.remaining).toBe(200 - deductAmount)
                            expect(r3.remaining).toBe(100)
                        } else {
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

        it('Property 5: 积分不足时应抛出错误且不产生任何变动', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 10, max: 100 }),
                    fc.integer({ min: 1, max: 100 }),
                    async (userPoints, extraAmount) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, userPoints)

                        const deductAmount = userPoints + extraAmount
                        const item = await createTestPointConsumptionItem({
                            key: `insufficient_${generateTestId()}`,
                            pointAmount: deductAmount
                        })

                        // 获取扣减前的积分
                        const recordsBefore = await findValidPointRecordsForConsumeDao(user.id)
                        const totalBefore = recordsBefore.reduce((sum, r) => sum + r.remaining, 0)

                        // 执行扣减，应抛出错误
                        let errorThrown = false
                        try {
                            await consumePointsService(user.id, item.key!, 1)
                        } catch (error: any) {
                            errorThrown = true
                            expect(error.message).toContain('积分不足')
                        }

                        expect(errorThrown).toBe(true)

                        // 验证积分没有变动
                        const recordsAfter = await findValidPointRecordsForConsumeDao(user.id)
                        const totalAfter = recordsAfter.reduce((sum, r) => sum + r.remaining, 0)
                        expect(totalAfter).toBe(totalBefore)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 6: 扣减结果正确性', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 1, max: 10 }),
                    fc.integer({ min: 1, max: 10 }),
                    async (totalPoints, pointAmount, quantity) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, totalPoints)

                        const item = await createTestPointConsumptionItem({
                            key: `consume_${generateTestId()}`,
                            pointAmount
                        })

                        const expectedConsume = pointAmount * quantity
                        if (expectedConsume > totalPoints) return true // 跳过积分不足的情况

                        const result = await consumePointsService(user.id, item.key!, quantity)

                        expect(result.consumedAmount).toBe(expectedConsume)
                        expect(result.consumptionRecords.length).toBeGreaterThan(0)

                        // 验证积分减少了正确的数量
                        const recordsAfter = await findValidPointRecordsForConsumeDao(user.id)
                        const totalAfter = recordsAfter.reduce((sum, r) => sum + r.remaining, 0)
                        expect(totalAfter).toBe(totalPoints - expectedConsume)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    /**
     * Property 7: 预扣创建正确性
     * Property 8: 预扣影响可用积分
     * 
     * **Feature: unified-point-service, Property 7, 8**
     * **Validates: Requirements 4.1, 4.4, 4.5**
     */
    describe('Property 7, 8: 预扣属性测试', () => {
        it('Property 7: 预扣应创建状态为 PRE_DEDUCT 的记录并返回有效 batchId', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 1, max: 10 }),
                    async (totalPoints, quantity) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, totalPoints)

                        const item = await createTestPointConsumptionItem({
                            key: `prededuct_${generateTestId()}`,
                            pointAmount: 10
                        })

                        const expectedDeduct = 10 * quantity
                        if (expectedDeduct > totalPoints) return true

                        const result = await preDeductPointsService(user.id, item.key!, quantity)

                        // 验证返回的 batchId 是有效的 UUID
                        expect(result.batchId).toBeDefined()
                        expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/)
                        expect(result.preDeductAmount).toBe(expectedDeduct)

                        // 验证创建的记录状态为预扣
                        const records = await findPreDeductRecordsByBatchIdDao(result.batchId)
                        expect(records.length).toBeGreaterThan(0)
                        expect(records[0].status).toBe(PointConsumptionRecordStatus.PRE_DEDUCT)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 8: 预扣后可用积分应减少预扣数量', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 1, max: 5 }),
                    async (totalPoints, quantity) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, totalPoints)

                        const item = await createTestPointConsumptionItem({
                            key: `prededuct_avail_${generateTestId()}`,
                            pointAmount: 10
                        })

                        const expectedDeduct = 10 * quantity
                        if (expectedDeduct > totalPoints) return true

                        // 预扣前的可用积分
                        const recordsBefore = await findValidPointRecordsForConsumeDao(user.id)
                        const availableBefore = recordsBefore.reduce((sum, r) => sum + r.remaining, 0)

                        await preDeductPointsService(user.id, item.key!, quantity)

                        // 预扣后的可用积分
                        const recordsAfter = await findValidPointRecordsForConsumeDao(user.id)
                        const availableAfter = recordsAfter.reduce((sum, r) => sum + r.remaining, 0)

                        expect(availableAfter).toBe(availableBefore - expectedDeduct)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    /**
     * Property 9: 结算状态更新
     * Property 10: 结算数量调整
     * 
     * **Feature: unified-point-service, Property 9, 10**
     * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
     */
    describe('Property 9, 10: 结算属性测试', () => {
        it('Property 9: 结算后预扣记录状态应更新为 SETTLED', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 500 }),
                    async (totalPoints) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, totalPoints)

                        const item = await createTestPointConsumptionItem({
                            key: `settle_${generateTestId()}`,
                            pointAmount: 10
                        })

                        // 预扣
                        const preDeductResult = await preDeductPointsService(user.id, item.key!, 1)

                        // 结算
                        await settlePointsService(preDeductResult.batchId)

                        // 验证状态更新为已结算
                        const records = await findPreDeductRecordsByBatchIdDao(preDeductResult.batchId)
                        expect(records.length).toBeGreaterThan(0)
                        expect(records[0].status).toBe(PointConsumptionRecordStatus.SETTLED)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 10: 实际消耗小于预扣时应退还差额', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const item = await createTestPointConsumptionItem({
                key: `settle_refund_${generateTestId()}`,
                pointAmount: 10
            })

            // 预扣 5 个单位 = 50 积分
            const preDeductResult = await preDeductPointsService(user.id, item.key!, 5)

            // 预扣后的可用积分
            const recordsAfterPreDeduct = await findValidPointRecordsForConsumeDao(user.id)
            const availableAfterPreDeduct = recordsAfterPreDeduct.reduce((sum, r) => sum + r.remaining, 0)
            expect(availableAfterPreDeduct).toBe(450)

            // 结算时实际只消耗 2 个单位 = 20 积分
            const settleResult = await settlePointsService(preDeductResult.batchId, 2)
            expect(settleResult.consumedAmount).toBe(20)

            // 结算后应退还 30 积分
            const recordsAfterSettle = await findValidPointRecordsForConsumeDao(user.id)
            const availableAfterSettle = recordsAfterSettle.reduce((sum, r) => sum + r.remaining, 0)
            expect(availableAfterSettle).toBe(480) // 500 - 20 = 480
        })
    })

    /**
     * Property 11: 回滚状态更新和积分恢复
     * Property 12: 回滚幂等性
     * 
     * **Feature: unified-point-service, Property 11, 12**
     * **Validates: Requirements 6.1, 6.2, 6.4**
     */
    describe('Property 11, 12: 回滚属性测试', () => {
        it('Property 11: 回滚后预扣记录状态应更新为 INVALID 且积分恢复', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 1, max: 5 }),
                    async (totalPoints, quantity) => {
                        const user = await createTestUser()
                        await createTestPointRecord(user.id, totalPoints)

                        const item = await createTestPointConsumptionItem({
                            key: `rollback_${generateTestId()}`,
                            pointAmount: 10
                        })

                        const expectedDeduct = 10 * quantity
                        if (expectedDeduct > totalPoints) return true

                        // 预扣
                        const preDeductResult = await preDeductPointsService(user.id, item.key!, quantity)

                        // 回滚
                        const rollbackResult = await rollbackPreDeductService(preDeductResult.batchId)
                        expect(rollbackResult.releasedAmount).toBe(expectedDeduct)

                        // 验证状态更新为无效
                        const records = await findPreDeductRecordsByBatchIdDao(preDeductResult.batchId)
                        expect(records.length).toBeGreaterThan(0)
                        expect(records[0].status).toBe(PointConsumptionRecordStatus.INVALID)

                        // 验证积分恢复
                        const recordsAfter = await findValidPointRecordsForConsumeDao(user.id)
                        const availableAfter = recordsAfter.reduce((sum, r) => sum + r.remaining, 0)
                        expect(availableAfter).toBe(totalPoints)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 12: 多次回滚应幂等，不会重复增加积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const item = await createTestPointConsumptionItem({
                key: `rollback_idempotent_${generateTestId()}`,
                pointAmount: 10
            })

            // 预扣
            const preDeductResult = await preDeductPointsService(user.id, item.key!, 5)

            // 第一次回滚
            const rollback1 = await rollbackPreDeductService(preDeductResult.batchId)
            expect(rollback1.releasedAmount).toBe(50)

            const recordsAfter1 = await findValidPointRecordsForConsumeDao(user.id)
            const available1 = recordsAfter1.reduce((sum, r) => sum + r.remaining, 0)

            // 第二次回滚（幂等）
            const rollback2 = await rollbackPreDeductService(preDeductResult.batchId)
            expect(rollback2.releasedAmount).toBe(0) // 幂等返回 0

            const recordsAfter2 = await findValidPointRecordsForConsumeDao(user.id)
            const available2 = recordsAfter2.reduce((sum, r) => sum + r.remaining, 0)

            // 积分应该相同
            expect(available2).toBe(available1)
            expect(available2).toBe(500)
        })
    })

    /**
     * Property 13: 事务原子性
     * 
     * **Feature: unified-point-service, Property 13**
     * **Validates: Requirements 7.4**
     */
    describe('Property 13: 事务原子性测试', () => {
        it('事务中操作失败时应回滚所有变更', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 100)

            const item = await createTestPointConsumptionItem({
                key: `tx_atomic_${generateTestId()}`,
                pointAmount: 200 // 大于用户积分，会失败
            })

            // 获取操作前的积分
            const recordsBefore = await findValidPointRecordsForConsumeDao(user.id)
            const availableBefore = recordsBefore.reduce((sum, r) => sum + r.remaining, 0)

            // 尝试扣减（会失败）
            let errorThrown = false
            try {
                await consumePointsService(user.id, item.key!, 1)
            } catch (error) {
                errorThrown = true
            }

            expect(errorThrown).toBe(true)

            // 验证积分没有变动（事务回滚）
            const recordsAfter = await findValidPointRecordsForConsumeDao(user.id)
            const availableAfter = recordsAfter.reduce((sum, r) => sum + r.remaining, 0)
            expect(availableAfter).toBe(availableBefore)
        })
    })

    /**
     * Property 14: 消耗记录完整性
     * Property 15: 消耗记录查询正确性
     * 
     * **Feature: unified-point-service, Property 14, 15**
     * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
     */
    describe('Property 14, 15: 消耗记录属性测试', () => {
        it('Property 14: 消耗记录应包含传入的 sourceId 和 remark', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const item = await createTestPointConsumptionItem({
                key: `record_complete_${generateTestId()}`,
                pointAmount: 10
            })

            const sourceId = 12345
            const remark = '测试备注信息'

            await consumePointsService(user.id, item.key!, 1, { sourceId, remark })

            // 查询消耗记录
            const { list } = await getConsumptionRecordsService({ userId: user.id })

            expect(list.length).toBeGreaterThan(0)
            const record = list[0]
            expect(record.sourceId).toBe(sourceId)
            expect(record.remark).toBe(remark)
        })

        it('Property 15: 查询消耗记录应包含关联的积分记录和消耗项目信息', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const item = await createTestPointConsumptionItem({
                key: `record_query_${generateTestId()}`,
                pointAmount: 10,
                name: '测试查询项目'
            })

            await consumePointsService(user.id, item.key!, 1)

            // 查询消耗记录
            const { list, total } = await getConsumptionRecordsService({ userId: user.id })

            expect(total).toBeGreaterThan(0)
            expect(list.length).toBeGreaterThan(0)

            const record = list[0]
            // 验证包含关联的积分记录
            expect(record.pointRecords).toBeDefined()
            expect(record.pointRecords.userId).toBe(user.id)

            // 验证包含关联的消耗项目
            expect(record.pointConsumptionItems).toBeDefined()
            expect(record.pointConsumptionItems.name).toBe('测试查询项目')
        })

        it('应支持按时间范围查询消耗记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const item = await createTestPointConsumptionItem({
                key: `record_time_${generateTestId()}`,
                pointAmount: 10
            })

            await consumePointsService(user.id, item.key!, 1)

            const now = new Date()
            const startTime = new Date(now.getTime() - 60 * 60 * 1000) // 1小时前
            const endTime = new Date(now.getTime() + 60 * 60 * 1000) // 1小时后

            const { list } = await getConsumptionRecordsService({
                userId: user.id,
                startTime,
                endTime
            })

            expect(list.length).toBeGreaterThan(0)
        })
    })
})
