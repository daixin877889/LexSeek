/**
 * 积分消耗 DAO 层 catch 分支覆盖测试
 *
 * 补充 pointConsumption.dao.ts 中各函数 catch 分支（Proxy 故障注入），
 * 以及 findConsumptionItemByKeyDao / findAvailableConsumptionItemsDao / 时间范围筛选等未覆盖路径。
 *
 * **Feature: server-test-coverage**
 * **Validates: pointConsumption.dao.ts catch 分支完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestPointRecord,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from '../membership/test-db-helper'
import {
    findConsumptionItemByKeyDao,
    findAvailableConsumptionItemsDao,
    findPreDeductRecordsByBatchIdDao,
    createConsumptionRecordDao,
    updatePointRecordUsageDao,
    findValidPointRecordsForConsumeDao,
    findConsumptionRecordsDao,
    updateConsumptionRecordStatusByBatchIdDao,
} from '../../../server/services/point/pointConsumption.dao'
import {
    PointConsumptionItemStatus,
    PointConsumptionRecordStatus,
    PointRecordStatus,
} from '../../../shared/types/point.types'

/** 故障注入 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

describe('积分消耗 DAO - catch 分支与边界覆盖', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()
    /** 创建的消耗项目 ID，用于清理 */
    const createdItemIds: number[] = []
    /** 创建的消耗记录 ID，用于清理 */
    const createdRecordIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        // 先删除消耗记录（依赖 users + pointRecords + items）
        if (createdRecordIds.length > 0) {
            await prisma.pointConsumptionRecords.deleteMany({
                where: { id: { in: createdRecordIds } },
            })
            createdRecordIds.length = 0
        }
        if (createdItemIds.length > 0) {
            await prisma.pointConsumptionItems.deleteMany({
                where: { id: { in: createdItemIds } },
            })
            createdItemIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds = []
        testIds.pointRecordIds = []
        testIds.membershipLevelIds = []
        testIds.userMembershipIds = []
        testIds.redemptionCodeIds = []
        testIds.redemptionRecordIds = []
        testIds.campaignIds = []
        testIds.membershipUpgradeRecordIds = []
        testIds.orderIds = []
        testIds.productIds = []
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('findConsumptionItemByKeyDao', () => {
        it('应按 key 查询消耗项目', async () => {
            if (!dbAvailable) return
            const key = `gap_item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            const item = await prisma.pointConsumptionItems.create({
                data: {
                    key,
                    group: 'test',
                    name: '消耗项目',
                    unit: '次',
                    pointAmount: 5,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })
            createdItemIds.push(item.id)

            const found = await findConsumptionItemByKeyDao(key)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(item.id)
        })

        it('不存在的 key 应返回 null', async () => {
            if (!dbAvailable) return
            const result = await findConsumptionItemByKeyDao(`missing_${Date.now()}`)
            expect(result).toBeNull()
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findConsumptionItemByKeyDao('x')).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findAvailableConsumptionItemsDao', () => {
        it('应返回所有启用且 key 非 null 的消耗项目', async () => {
            if (!dbAvailable) return
            const enabledKey = `gap_avail_en_${Date.now()}`
            const disabledKey = `gap_avail_dis_${Date.now()}`

            const enabled = await prisma.pointConsumptionItems.create({
                data: {
                    key: enabledKey,
                    group: 'test',
                    name: '启用项目',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })
            const disabled = await prisma.pointConsumptionItems.create({
                data: {
                    key: disabledKey,
                    group: 'test',
                    name: '禁用项目',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.DISABLED,
                },
            })
            createdItemIds.push(enabled.id, disabled.id)

            const list = await findAvailableConsumptionItemsDao()
            const ids = list.map(x => x.id)
            expect(ids).toContain(enabled.id)
            expect(ids).not.toContain(disabled.id)
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findAvailableConsumptionItemsDao()).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findConsumptionRecordsDao - 多条件组合', () => {
        it('应支持 itemId / status / startTime / endTime 组合筛选', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const pointRecord = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 100,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(pointRecord.id)
            const item = await prisma.pointConsumptionItems.create({
                data: {
                    key: `gap_multi_${Date.now()}`,
                    group: 'test',
                    name: '筛选测试',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })
            createdItemIds.push(item.id)

            const record = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.SETTLED,
            })
            createdRecordIds.push(record.id)

            const result = await findConsumptionRecordsDao({
                userId: user.id,
                itemId: item.id,
                status: PointConsumptionRecordStatus.SETTLED,
                startTime: new Date(Date.now() - 60 * 1000),
                endTime: new Date(Date.now() + 60 * 1000),
                page: 1,
                pageSize: 20,
            })
            expect(result.total).toBeGreaterThanOrEqual(1)
            expect(result.list.some(r => r.id === record.id)).toBe(true)
        })

        it('catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(findConsumptionRecordsDao({ userId: 1 })).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('catch 分支 - 其余 DAO', () => {
        it('findPreDeductRecordsByBatchIdDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findPreDeductRecordsByBatchIdDao('x')).rejects.toThrow('injected-fault')
            })
        })

        it('updateConsumptionRecordStatusByBatchIdDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    updateConsumptionRecordStatusByBatchIdDao('x', PointConsumptionRecordStatus.SETTLED)
                ).rejects.toThrow('injected-fault')
            })
        })

        it('createConsumptionRecordDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createConsumptionRecordDao({
                        userId: 1,
                        pointRecordId: 1,
                        itemId: 1,
                        pointAmount: 1,
                        status: PointConsumptionRecordStatus.PRE_DEDUCT,
                    })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('updatePointRecordUsageDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(updatePointRecordUsageDao(1, 10, 90)).rejects.toThrow('injected-fault')
            })
        })

        it('findValidPointRecordsForConsumeDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findValidPointRecordsForConsumeDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('createConsumptionRecordDao 透传新字段', () => {
        it('应落库 operationId / contextLabel / usageAmount', async () => {
            if (!dbAvailable) return
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const pointRecord = await createTestPointRecord(user.id, {
                pointAmount: 100,
                used: 0,
                remaining: 100,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(pointRecord.id)
            const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'doc_parse' } })
            const rec = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 5,
                status: PointConsumptionRecordStatus.SETTLED,
                operationId: 'op-test-1',
                contextLabel: '起诉状.pdf',
                usageAmount: 8,
            })
            createdRecordIds.push(rec.id)
            expect(rec.operationId).toBe('op-test-1')
            expect(rec.contextLabel).toBe('起诉状.pdf')
            expect(rec.usageAmount).toBe(8)
        })
    })
})
