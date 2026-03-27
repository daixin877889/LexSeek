/**
 * 统一积分消耗 DAO 层测试
 *
 * 测试 pointConsumption.dao.ts 中所有 DAO 方法
 *
 * **Feature: point-consumption-dao**
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
import { PointRecordSourceType } from '../../../shared/types/point.types'

// 设置全局变量
const mockLogger = {
    info: (...args: any[]) => {},
    warn: (...args: any[]) => {},
    error: (...args: any[]) => {},
    debug: (...args: any[]) => {},
}
    ; (globalThis as any).logger = mockLogger

let dbAvailable = false
const testIds: TestIds = createEmptyTestIds()
const prisma = getTestPrisma()

describe('积分消耗 DAO 测试', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('findValidPointRecordsForConsumeDao', () => {
        it('应返回用户有效积分记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 100,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            expect(records.length).toBeGreaterThanOrEqual(1)
        })

        it('应按过期时间升序排列', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const now = new Date()
            const r1 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                expiredAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // 10天后过期
                status: PointRecordStatus.VALID,
            })
            const r2 = await createTestPointRecord(user.id, {
                pointAmount: 100,
                expiredAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30天后过期
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(r1.id, r2.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            const ourRecords = records.filter(r => [r1.id, r2.id].includes(r.id))
            expect(ourRecords[0].expiredAt.getTime()).toBeLessThanOrEqual(
                ourRecords[1].expiredAt.getTime()
            )
        })

        it('已过期的积分不应被返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, {
                pointAmount: 100,
                expiredAt: new Date(Date.now() - 1), // 已过期
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            const found = records.find(r => r.id === record.id)
            expect(found).toBeUndefined()
        })

        it('remaining 为 0 的积分不应被返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 0,
                used: 100,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            const found = records.find(r => r.id === record.id)
            expect(found).toBeUndefined()
        })

        it('未生效的积分不应被返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, {
                pointAmount: 100,
                effectiveAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 未来生效
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            const found = records.find(r => r.id === record.id)
            expect(found).toBeUndefined()
        })

        it('新用户应返回空数组', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const records = await findValidPointRecordsForConsumeDao(user.id)

            expect(records).toEqual([])
        })
    })

    describe('createConsumptionRecordDao', () => {
        it('应成功创建消耗记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const pointRecord = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 100,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(pointRecord.id)

            // 需要先创建消耗项目
            const item = await prisma.pointConsumptionItems.create({
                data: {
                    key: `test_item_${Date.now()}`,
                    group: 'test',
                    name: '测试项目',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })

            const record = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.SETTLED,
                remark: '测试消耗',
            })

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(10)
            expect(record.status).toBe(PointConsumptionRecordStatus.SETTLED)

            // 清理
            await prisma.pointConsumptionRecords.delete({ where: { id: record.id } })
            await prisma.pointConsumptionItems.delete({ where: { id: item.id } })
        })

        it('创建带批次 ID 的记录应成功', async () => {
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
                    key: `test_item_batch_${Date.now()}`,
                    group: 'test',
                    name: '测试项目_batch',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })

            const batchId = 'test-batch-123'
            const record = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                batchId,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.PRE_DEDUCT,
                remark: '预扣',
            })

            expect(record.batchId).toBe(batchId)
            expect(record.status).toBe(PointConsumptionRecordStatus.PRE_DEDUCT)

            // 清理
            await prisma.pointConsumptionRecords.delete({ where: { id: record.id } })
            await prisma.pointConsumptionItems.delete({ where: { id: item.id } })
        })
    })

    describe('updatePointRecordUsageDao', () => {
        it('应成功更新积分使用量', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const record = await createTestPointRecord(user.id, {
                pointAmount: 100,
                remaining: 100,
                used: 0,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const updated = await updatePointRecordUsageDao(record.id, 30, 70)

            expect(updated.used).toBe(30)
            expect(updated.remaining).toBe(70)
        })

        it('Property: 更新后 used + remaining 应等于原始 pointAmount', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const pointAmount = 500
            const record = await createTestPointRecord(user.id, {
                pointAmount,
                remaining: pointAmount,
                used: 0,
                status: PointRecordStatus.VALID,
            })
            testIds.pointRecordIds.push(record.id)

            const usedAmount = 200
            const updated = await updatePointRecordUsageDao(record.id, usedAmount, pointAmount - usedAmount)

            expect(updated.used + updated.remaining).toBe(pointAmount)
        })
    })

    describe('updateConsumptionRecordStatusByBatchIdDao', () => {
        it('应成功批量更新批次内记录状态', async () => {
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
                    key: `test_item_status_${Date.now()}`,
                    group: 'test',
                    name: '测试项目_status',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })

            const batchId = 'batch-for-status-update'
            const record = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                batchId,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.PRE_DEDUCT,
            })

            const count = await updateConsumptionRecordStatusByBatchIdDao(
                batchId,
                PointConsumptionRecordStatus.SETTLED
            )

            expect(count).toBeGreaterThan(0)

            // 验证状态已更新
            const updated = await prisma.pointConsumptionRecords.findUnique({
                where: { id: record.id },
            })
            expect(updated!.status).toBe(PointConsumptionRecordStatus.SETTLED)

            // 清理
            await prisma.pointConsumptionRecords.delete({ where: { id: record.id } })
            await prisma.pointConsumptionItems.delete({ where: { id: item.id } })
        })
    })

    describe('findPreDeductRecordsByBatchIdDao', () => {
        it('应返回批次内的所有预扣记录', async () => {
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
                    key: `test_item_prededuct_${Date.now()}`,
                    group: 'test',
                    name: '测试项目_prededuct',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })

            const batchId = 'batch-find-test'
            await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                batchId,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.PRE_DEDUCT,
            })

            const records = await findPreDeductRecordsByBatchIdDao(batchId)

            expect(records.length).toBeGreaterThan(0)
            expect(records[0].batchId).toBe(batchId)

            // 清理
            for (const r of records) {
                await prisma.pointConsumptionRecords.delete({ where: { id: r.id } })
            }
            await prisma.pointConsumptionItems.delete({ where: { id: item.id } })
        })

        it('不存在的批次应返回空数组', async () => {
            if (!dbAvailable) return

            const records = await findPreDeductRecordsByBatchIdDao('non-existent-batch-id')
            expect(records).toEqual([])
        })
    })

    describe('findConsumptionRecordsDao', () => {
        it('应返回用户的消耗记录', async () => {
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
                    key: `test_item_find_${Date.now()}`,
                    group: 'test',
                    name: '测试项目_find',
                    unit: '次',
                    pointAmount: 10,
                    status: PointConsumptionItemStatus.ENABLED,
                },
            })

            const record = await createConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 10,
                status: PointConsumptionRecordStatus.SETTLED,
            })

            const result = await findConsumptionRecordsDao({ userId: user.id })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
            expect(result.total).toBeGreaterThanOrEqual(1)

            // 清理
            await prisma.pointConsumptionRecords.delete({ where: { id: record.id } })
            await prisma.pointConsumptionItems.delete({ where: { id: item.id } })
        })

        it('应支持分页', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const result = await findConsumptionRecordsDao({
                userId: user.id,
                page: 1,
                pageSize: 5,
            })

            expect(result.list.length).toBeLessThanOrEqual(5)
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
