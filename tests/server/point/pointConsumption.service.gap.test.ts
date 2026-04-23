/**
 * 统一积分消耗服务 - 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 pointConsumption.service.ts 中未被现有测试覆盖的路径：
 * - consumePointsService / preDeductPointsService / settlePointsService / rollbackPreDeductService
 *   传入外部 tx 参数的分支（行 209, 302, 392, 527）
 * - 预扣积分不足错误（行 332）
 * - 结算 - 批次不存在错误（行 412）
 * - 结算 - 批次已处理错误（行 418）
 * - 结算 - 实际消耗 > 预扣 的补扣分支（行 439-472）
 * - 结算 - 补扣积分不足错误
 * - 回滚 - 批次不存在错误（行 546）
 * - 回滚 - 已结算无法回滚错误（行 557）
 * - getConsumptionRecordsService 使用 itemKey 过滤（行 608-610）
 *
 * **Feature: unified-point-service**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

// 设置全局变量（在导入服务之前）
const mockLogger = {
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args),
    debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}
;(globalThis as any).logger = mockLogger
;(globalThis as any).prisma = testPrisma
;(globalThis as any).PointConsumptionItemStatus = { DISABLED: 0, ENABLED: 1 }
;(globalThis as any).PointConsumptionRecordStatus = { INVALID: 0, PRE_DEDUCT: 1, SETTLED: 2 }
;(globalThis as any).PointRecordStatus = { VALID: 1, MEMBERSHIP_UPGRADE_SETTLEMENT: 2, CANCELLED: 3 }

import {
    consumePointsService,
    preDeductPointsService,
    settlePointsService,
    rollbackPreDeductService,
    getConsumptionRecordsService,
} from '../../../server/services/point/pointConsumption.service'

import {
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
}

const generateTestId = () => `gap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

const createTestUser = async () => {
    const user = await testPrisma.users.create({
        data: {
            phone: `188${Date.now().toString().slice(-8)}`,
            name: `gap_user_${generateTestId()}`,
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

const createTestPointRecord = async (userId: number, pointAmount: number) => {
    const now = new Date()
    const record = await testPrisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: 0,
            remaining: pointAmount,
            sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            effectiveAt: now,
            expiredAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            status: PointRecordStatus.VALID,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.pointRecordIds.push(record.id)
    return record
}

const createTestItem = async (options: { key?: string; pointAmount?: number } = {}) => {
    const item = await testPrisma.pointConsumptionItems.create({
        data: {
            name: `gap_item_${generateTestId()}`,
            key: options.key ?? `gap_key_${generateTestId()}`,
            description: '测试积分消耗项目',
            group: 'test_group',
            unit: '次',
            pointAmount: options.pointAmount ?? 10,
            discount: 1,
            status: PointConsumptionItemStatus.ENABLED,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.pointConsumptionItemIds.push(item.id)
    return item
}

const cleanupTestData = async () => {
    if (testIds.userIds.length > 0) {
        await testPrisma.pointConsumptionRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
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
    if (testIds.pointConsumptionItemIds.length > 0) {
        await testPrisma.pointConsumptionItems.deleteMany({
            where: { id: { in: testIds.pointConsumptionItemIds } },
        })
        testIds.pointConsumptionItemIds = []
    }
    if (testIds.userIds.length > 0) {
        await testPrisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

describe('统一积分消耗服务 - 覆盖率补齐（gap）', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await testPrisma.$disconnect()
    })

    describe('tx 参数分支 - 服务接受外部事务客户端', () => {
        it('consumePointsService 传入 tx 时应复用外部事务', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_consume_tx', pointAmount: 10 })

            // 外部事务执行扣减
            const result = await testPrisma.$transaction(async (tx) => {
                return consumePointsService(user.id, item.key!, 1, { tx })
            })

            expect(result.consumedAmount).toBe(10)
            expect(result.consumptionRecords.length).toBeGreaterThan(0)

            // 验证事务提交后积分扣减生效
            const records = await findValidPointRecordsForConsumeDao(user.id)
            const total = records.reduce((sum, r) => sum + r.remaining, 0)
            expect(total).toBe(490)
        })

        it('preDeductPointsService 传入 tx 时应复用外部事务', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_prededuct_tx', pointAmount: 10 })

            const result = await testPrisma.$transaction(async (tx) => {
                return preDeductPointsService(user.id, item.key!, 2, { tx })
            })

            expect(result.batchId).toBeDefined()
            expect(result.preDeductAmount).toBe(20)
        })

        it('settlePointsService 传入 tx 时应复用外部事务', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_settle_tx', pointAmount: 10 })

            const preDeduct = await preDeductPointsService(user.id, item.key!, 2)

            const settleResult = await testPrisma.$transaction(async (tx) => {
                return settlePointsService(preDeduct.batchId, undefined, tx)
            })

            expect(settleResult.consumedAmount).toBe(20)
            const records = await findPreDeductRecordsByBatchIdDao(preDeduct.batchId)
            expect(records[0]!.status).toBe(PointConsumptionRecordStatus.SETTLED)
        })

        it('rollbackPreDeductService 传入 tx 时应复用外部事务', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_rollback_tx', pointAmount: 10 })

            const preDeduct = await preDeductPointsService(user.id, item.key!, 3)

            const rollbackResult = await testPrisma.$transaction(async (tx) => {
                return rollbackPreDeductService(preDeduct.batchId, tx)
            })

            expect(rollbackResult.releasedAmount).toBe(30)
            const records = await findPreDeductRecordsByBatchIdDao(preDeduct.batchId)
            expect(records[0]!.status).toBe(PointConsumptionRecordStatus.INVALID)
        })
    })

    describe('预扣边界 - 积分不足应抛错', () => {
        it('预扣积分不足时应抛出错误', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 30)
            const item = await createTestItem({ key: 'gap_prededuct_insufficient', pointAmount: 50 })

            // 需要 50，可用 30
            await expect(
                preDeductPointsService(user.id, item.key!, 1)
            ).rejects.toThrow(/积分不足/)
        })
    })

    describe('结算异常分支', () => {
        it('批次不存在时应抛出错误', async () => {
            await expect(
                settlePointsService('00000000-0000-0000-0000-000000000000')
            ).rejects.toThrow(/预扣批次不存在/)
        })

        it('批次已结算时再次结算应抛错（状态不是 PRE_DEDUCT）', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_settle_twice', pointAmount: 10 })

            const preDeduct = await preDeductPointsService(user.id, item.key!, 1)
            await settlePointsService(preDeduct.batchId)

            // 第二次结算应抛错
            await expect(
                settlePointsService(preDeduct.batchId)
            ).rejects.toThrow(/预扣批次已处理/)
        })
    })

    describe('结算补扣分支 - 实际消耗 > 预扣', () => {
        it('当实际消耗超过预扣时应从有效积分中补扣', async () => {
            const user = await createTestUser()
            // 总共 500 积分
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_settle_supplement', pointAmount: 10 })

            // 预扣 2 个单位 = 20 积分
            const preDeduct = await preDeductPointsService(user.id, item.key!, 2)

            // 验证预扣后可用积分
            const recordsAfterPreDeduct = await findValidPointRecordsForConsumeDao(user.id)
            const availableAfterPreDeduct = recordsAfterPreDeduct.reduce(
                (sum, r) => sum + r.remaining,
                0
            )
            expect(availableAfterPreDeduct).toBe(480)

            // 结算时实际消耗 5 个单位 = 50 积分（预扣 20 + 补扣 30）
            const settleResult = await settlePointsService(preDeduct.batchId, 5)
            expect(settleResult.consumedAmount).toBe(50)

            // 结算后可用积分应减少 30（补扣的部分）
            const recordsAfterSettle = await findValidPointRecordsForConsumeDao(user.id)
            const availableAfterSettle = recordsAfterSettle.reduce(
                (sum, r) => sum + r.remaining,
                0
            )
            expect(availableAfterSettle).toBe(450) // 500 - 50 = 450
        })

        it('补扣时积分不足应抛出错误', async () => {
            const user = await createTestUser()
            // 仅有 25 积分
            await createTestPointRecord(user.id, 25)
            const item = await createTestItem({
                key: 'gap_settle_supplement_insufficient',
                pointAmount: 10,
            })

            // 预扣 1 个单位 = 10 积分，预扣后剩 15
            const preDeduct = await preDeductPointsService(user.id, item.key!, 1)

            // 结算时实际消耗 5 个单位 = 50 积分（需补扣 40，但只有 15 可用）
            await expect(
                settlePointsService(preDeduct.batchId, 5)
            ).rejects.toThrow(/补扣积分不足/)
        })
    })

    describe('回滚异常分支', () => {
        it('批次不存在时应抛出错误', async () => {
            await expect(
                rollbackPreDeductService('00000000-0000-0000-0000-000000000000')
            ).rejects.toThrow(/预扣批次不存在/)
        })

        it('批次已结算时回滚应抛出错误', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_rollback_settled', pointAmount: 10 })

            const preDeduct = await preDeductPointsService(user.id, item.key!, 1)
            await settlePointsService(preDeduct.batchId)

            await expect(
                rollbackPreDeductService(preDeduct.batchId)
            ).rejects.toThrow(/预扣批次已结算，无法回滚/)
        })
    })

    describe('getConsumptionRecordsService - 按 itemKey 过滤', () => {
        it('传入 itemKey 时应按对应 itemId 过滤', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const itemA = await createTestItem({ key: 'gap_query_key_a', pointAmount: 10 })
            const itemB = await createTestItem({ key: 'gap_query_key_b', pointAmount: 20 })

            // 两种 item 各消耗一次
            await consumePointsService(user.id, itemA.key!, 1)
            await consumePointsService(user.id, itemB.key!, 1)

            // 按 itemKey 过滤
            const { list, total } = await getConsumptionRecordsService({
                userId: user.id,
                itemKey: 'gap_query_key_a',
            })

            expect(total).toBeGreaterThanOrEqual(1)
            expect(list.every(r => r.itemId === itemA.id)).toBe(true)
        })

        it('传入不存在的 itemKey 时不应报错（itemId 会保持 undefined）', async () => {
            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)
            const item = await createTestItem({ key: 'gap_query_existing', pointAmount: 10 })
            await consumePointsService(user.id, item.key!, 1)

            // 不存在的 itemKey
            const { list } = await getConsumptionRecordsService({
                userId: user.id,
                itemKey: 'gap_query_nonexistent_key_xyz',
            })

            // 函数不会抛错，list 应包含用户的所有消耗记录（因 itemId 保持 undefined）
            expect(Array.isArray(list)).toBe(true)
        })
    })
})
