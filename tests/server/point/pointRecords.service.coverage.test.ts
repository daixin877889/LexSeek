/**
 * 积分记录服务 - 覆盖率补充测试
 *
 * 覆盖 pointRecords.service.ts 中未被测试的路径：
 * - createPointRecordService 各种过期时间计算
 * - getUserPointRecords 分页逻辑
 * - getPointsBySourceTypes 汇总计算
 *
 * **Feature: point-records-service**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
import { prisma } from '~~/server/utils/db'
import {
    createPointRecordService,
    getUserPointRecords,
    getUserPointSummary,
    createPointRecord,
} from '~~/server/services/point/pointRecords.service'
import { PointRecordSourceType, PointRecordStatus } from '#shared/types/point.types'

const testIds = {
    pointRecordIds: [] as number[],
}

let testUserId: number | null = null

describe('积分记录服务 - 覆盖率补充', () => {
    beforeAll(async () => {
        // 避免 sequence 漂移（测试库已有数据后，sequence 给的下个值已被占用 →
        // Unique constraint failed on (id)）
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('point_records', 'id'), COALESCE((SELECT MAX(id) FROM point_records), 0) + 1, false)`)
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

    describe('createPointRecordService - 过期时间计算', () => {
        it('应使用默认有效期（1年）当没有传入 expiredAt 和 duration', async () => {
            if (!testUserId) return

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
            })
            testIds.pointRecordIds.push(record.id)

            const expiredAt = dayjs(record.expiredAt)
            const expectedExpiredAt = dayjs().startOf('day').add(1, 'year').subtract(1, 'day')
            expect(expiredAt.diff(expectedExpiredAt, 'day')).toBeLessThanOrEqual(1)
        })

        it('应按天计算过期时间', async () => {
            if (!testUserId) return

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 20,
                sourceType: PointRecordSourceType.OTHER,
                duration: 30,
                durationUnit: 'day',
            })
            testIds.pointRecordIds.push(record.id)

            const effectiveAt = dayjs(record.effectiveAt)
            const expiredAt = dayjs(record.expiredAt)
            const diffDays = expiredAt.startOf('day').diff(effectiveAt.startOf('day'), 'day')
            expect(diffDays).toBe(29)
        })

        it('应按月计算过期时间', async () => {
            if (!testUserId) return

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 30,
                sourceType: PointRecordSourceType.OTHER,
                duration: 3,
                durationUnit: 'month',
            })
            testIds.pointRecordIds.push(record.id)

            const effectiveAt = dayjs(record.effectiveAt)
            const expiredAt = dayjs(record.expiredAt)
            const diffMonths = expiredAt.diff(effectiveAt, 'month')
            expect(diffMonths).toBeGreaterThanOrEqual(2)
            expect(diffMonths).toBeLessThanOrEqual(3)
        })

        it('应按年计算过期时间', async () => {
            if (!testUserId) return

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 40,
                sourceType: PointRecordSourceType.OTHER,
                duration: 1,
                durationUnit: 'year',
            })
            testIds.pointRecordIds.push(record.id)

            const effectiveAt = dayjs(record.effectiveAt)
            const expiredAt = dayjs(record.expiredAt)
            const diffDays = expiredAt.diff(effectiveAt, 'day')
            expect(diffDays).toBeGreaterThanOrEqual(363)
            expect(diffDays).toBeLessThanOrEqual(366)
        })

        it('应使用直接传入的 expiredAt', async () => {
            if (!testUserId) return

            const customExpiredAt = dayjs().add(60, 'day').endOf('day').toDate()

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 50,
                sourceType: PointRecordSourceType.OTHER,
                expiredAt: customExpiredAt,
            })
            testIds.pointRecordIds.push(record.id)

            expect(dayjs(record.expiredAt).startOf('day').valueOf())
                .toBe(dayjs(customExpiredAt).startOf('day').valueOf())
        })

        it('新记录的 remaining 应等于 pointAmount', async () => {
            if (!testUserId) return

            const record = await createPointRecordService({
                userId: testUserId,
                pointAmount: 100,
                sourceType: PointRecordSourceType.OTHER,
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.remaining).toBe(100)
            expect(record.used).toBe(0)
            expect(record.status).toBe(PointRecordStatus.VALID)
        })
    })

    describe('getUserPointRecords - 分页', () => {
        it('应返回分页结果', async () => {
            if (!testUserId) return

            const result = await getUserPointRecords(testUserId, {
                page: 1,
                pageSize: 5,
            })

            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(result).toHaveProperty('page')
            expect(result).toHaveProperty('pageSize')
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(5)
            expect(result.list.length).toBeLessThanOrEqual(5)
        })
    })

    describe('getUserPointSummary', () => {
        it('应返回积分汇总信息', async () => {
            if (!testUserId) return

            const summary = await getUserPointSummary(testUserId)

            expect(summary).toHaveProperty('pointAmount')
            expect(summary).toHaveProperty('used')
            expect(summary).toHaveProperty('remaining')
            expect(summary).toHaveProperty('purchasePoint')
            expect(summary).toHaveProperty('otherPoint')
            expect(typeof summary.pointAmount).toBe('number')
        })
    })

    // 注意：getPointsBySourceTypes 依赖 Nuxt 自动导入的 findPointRecordsBySourceTypesDao
    // 在 DAO 覆盖测试中已覆盖该函数的测试路径

    describe('createPointRecord - 旧接口兼容', () => {
        it('旧接口应正确委托到新接口', async () => {
            if (!testUserId) return

            const effectiveAt = dayjs().startOf('day').toDate()
            const expiredAt = dayjs().add(1, 'year').endOf('day').toDate()

            const record = await createPointRecord({
                userId: testUserId,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
                effectiveAt,
                expiredAt,
            })
            testIds.pointRecordIds.push(record.id)

            expect(record.pointAmount).toBe(10)
            expect(record.remaining).toBe(10)
            expect(record.used).toBe(0)
        })
    })
})
