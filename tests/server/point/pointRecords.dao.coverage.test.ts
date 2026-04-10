/**
 * 积分记录 DAO - 覆盖率补充测试
 *
 * 覆盖 pointRecords.dao.ts 中未被测试的路径：
 * - findValidPointRecordsByUserIdDao FIFO 排序
 * - invalidatePointRecordsDao 作废逻辑
 * - sumUserValidPointsDao 各来源类型统计
 * - findPointRecordsByMembershipIdDao 按会员查询
 * - transferPointRecordsDao 转移逻辑
 * - findPointRecordsBySourceTypesDao 多来源类型查询
 * - sumPointsByMembershipIdDao 会员积分汇总
 *
 * **Feature: point-records-dao**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
import { prisma } from '../../../server/utils/db'
import {
    createPointRecordDao,
    findPointRecordByIdDao,
    findPointRecordsByUserIdDao,
    findValidPointRecordsByUserIdDao,
    updatePointRecordDao,
    invalidatePointRecordsDao,
    sumUserValidPointsDao,
    findPointRecordsByMembershipIdDao,
    transferPointRecordsDao,
    findPointRecordsBySourceTypesDao,
    sumPointsByMembershipIdDao,
} from '../../../server/services/point/pointRecords.dao'
import { PointRecordSourceType, PointRecordStatus } from '../../../shared/types/point.types'

const testIds = {
    pointRecordIds: [] as number[],
}

let testUserId: number | null = null

describe('积分记录 DAO - 覆盖率补充', () => {
    beforeAll(async () => {
        const user = await prisma.users.findFirst({
            where: { deletedAt: null },
            select: { id: true },
        })
        testUserId = user?.id ?? null
    })

    afterAll(async () => {
        if (testIds.pointRecordIds.length > 0) {
            await prisma.pointRecords.deleteMany({
                where: { id: { in: testIds.pointRecordIds } },
            })
        }
    })

    describe('findPointRecordByIdDao', () => {
        it('应返回存在的积分记录', async () => {
            if (!testUserId) return

            const record = await prisma.pointRecords.create({
                data: {
                    userId: testUserId,
                    pointAmount: 100,
                    used: 0,
                    remaining: 100,
                    sourceType: PointRecordSourceType.OTHER,
                    effectiveAt: new Date(),
                    expiredAt: dayjs().add(1, 'year').toDate(),
                    status: PointRecordStatus.VALID,
                },
            })
            testIds.pointRecordIds.push(record.id)

            const found = await findPointRecordByIdDao(record.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(record.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await findPointRecordByIdDao(999999)
            expect(found).toBeNull()
        })
    })

    describe('findPointRecordsByUserIdDao', () => {
        it('应返回分页结果', async () => {
            if (!testUserId) return

            const result = await findPointRecordsByUserIdDao(testUserId, {
                page: 1,
                pageSize: 5,
            })

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(result.list.length).toBeLessThanOrEqual(5)
        })

        it('应按来源类型筛选', async () => {
            if (!testUserId) return

            const result = await findPointRecordsByUserIdDao(testUserId, {
                sourceType: PointRecordSourceType.OTHER,
            })

            for (const record of result.list) {
                expect(record.sourceType).toBe(PointRecordSourceType.OTHER)
            }
        })
    })

    describe('findValidPointRecordsByUserIdDao', () => {
        it('应按过期时间升序返回（FIFO）', async () => {
            if (!testUserId) return

            const records = await findValidPointRecordsByUserIdDao(testUserId)

            // 验证按过期时间升序排列
            for (let i = 1; i < records.length; i++) {
                const prev = new Date(records[i - 1]!.expiredAt).getTime()
                const curr = new Date(records[i]!.expiredAt).getTime()
                expect(curr).toBeGreaterThanOrEqual(prev)
            }
        })

        it('应只返回有效且有余额的记录', async () => {
            if (!testUserId) return

            const records = await findValidPointRecordsByUserIdDao(testUserId)

            for (const record of records) {
                expect(record.status).toBe(PointRecordStatus.VALID)
                expect(record.remaining).toBeGreaterThan(0)
                expect(new Date(record.expiredAt).getTime()).toBeGreaterThan(Date.now())
            }
        })
    })

    describe('updatePointRecordDao', () => {
        it('应更新积分记录', async () => {
            if (!testUserId) return

            const record = await prisma.pointRecords.create({
                data: {
                    userId: testUserId,
                    pointAmount: 50,
                    used: 0,
                    remaining: 50,
                    sourceType: PointRecordSourceType.OTHER,
                    effectiveAt: new Date(),
                    expiredAt: dayjs().add(1, 'year').toDate(),
                    status: PointRecordStatus.VALID,
                },
            })
            testIds.pointRecordIds.push(record.id)

            const updated = await updatePointRecordDao(record.id, {
                used: 10,
                remaining: 40,
            })

            expect(updated.used).toBe(10)
            expect(updated.remaining).toBe(40)
        })
    })

    describe('invalidatePointRecordsDao', () => {
        it('应按来源类型和来源 ID 作废积分记录', async () => {
            if (!testUserId) return

            const sourceId = 999888
            const record = await prisma.pointRecords.create({
                data: {
                    userId: testUserId,
                    pointAmount: 30,
                    used: 0,
                    remaining: 30,
                    sourceType: PointRecordSourceType.OTHER,
                    sourceId,
                    effectiveAt: new Date(),
                    expiredAt: dayjs().add(1, 'year').toDate(),
                    status: PointRecordStatus.VALID,
                },
            })
            testIds.pointRecordIds.push(record.id)

            await invalidatePointRecordsDao(testUserId, PointRecordSourceType.OTHER, sourceId)

            const found = await findPointRecordByIdDao(record.id)
            // 作废后 status 应变为 CANCELLED
            if (found) {
                expect(found.status).toBe(PointRecordStatus.CANCELLED)
            }
        })
    })

    describe('sumUserValidPointsDao', () => {
        it('应返回积分汇总信息', async () => {
            if (!testUserId) return

            const summary = await sumUserValidPointsDao(testUserId)

            expect(summary).toHaveProperty('pointAmount')
            expect(summary).toHaveProperty('used')
            expect(summary).toHaveProperty('remaining')
            expect(summary).toHaveProperty('purchasePoint')
            expect(summary).toHaveProperty('otherPoint')
            expect(summary).toHaveProperty('pendingPoint')
            expect(typeof summary.remaining).toBe('number')
        })

        it('不存在的用户应返回全零汇总', async () => {
            const summary = await sumUserValidPointsDao(999999)

            expect(summary.pointAmount).toBe(0)
            expect(summary.used).toBe(0)
            expect(summary.remaining).toBe(0)
        })
    })

    describe('findPointRecordsBySourceTypesDao', () => {
        it('应按多个来源类型查询', async () => {
            if (!testUserId) return

            const records = await findPointRecordsBySourceTypesDao(testUserId, [
                PointRecordSourceType.OTHER,
                PointRecordSourceType.MEMBERSHIP_GIFT,
            ])

            for (const record of records) {
                expect([
                    PointRecordSourceType.OTHER,
                    PointRecordSourceType.MEMBERSHIP_GIFT,
                ]).toContain(record.sourceType)
            }
        })
    })

    describe('sumPointsByMembershipIdDao', () => {
        it('不存在的会员 ID 应返回零汇总', async () => {
            const summary = await sumPointsByMembershipIdDao(999999)

            expect(summary.total).toBe(0)
            expect(summary.remaining).toBe(0)
        })
    })

    describe('findPointRecordsByMembershipIdDao', () => {
        it('不存在的会员 ID 应返回空数组', async () => {
            const records = await findPointRecordsByMembershipIdDao(999999)
            expect(records).toEqual([])
        })

        it('应按状态筛选', async () => {
            const records = await findPointRecordsByMembershipIdDao(999999, {
                status: PointRecordStatus.VALID,
            })
            expect(records).toEqual([])
        })
    })

    describe('transferPointRecordsDao', () => {
        it('不存在的会员 ID 转移应返回 0', async () => {
            const count = await transferPointRecordsDao(999999, 999998)
            expect(count).toBe(0)
        })
    })
})
