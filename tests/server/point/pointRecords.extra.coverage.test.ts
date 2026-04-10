/**
 * 积分记录 - 额外覆盖率补充测试
 *
 * **Feature: point-records-coverage**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
import { prisma } from '../../../server/utils/db'
import { sumUserValidPointsDao } from '../../../server/services/point/pointRecords.dao'
import {
    createPointRecordService,
    getUserPointRecords,
} from '../../../server/services/point/pointRecords.service'
import { PointRecordSourceType, PointRecordStatus } from '../../../shared/types/point.types'

const testIds = { pointRecordIds: [] as number[] }
let testUserId: number | null = null

describe('积分记录 - 额外覆盖率', () => {
    beforeAll(async () => {
        const user = await prisma.users.findFirst({ where: { deletedAt: null }, select: { id: true } })
        testUserId = user?.id ?? null
    })

    afterAll(async () => {
        if (testIds.pointRecordIds.length > 0) {
            await prisma.pointRecords.deleteMany({ where: { id: { in: testIds.pointRecordIds } } })
        }
    })

    const makeRecord = async (sourceType: number, extra: Record<string, any> = {}) => {
        if (!testUserId) return null
        const record = await prisma.pointRecords.create({
            data: {
                userId: testUserId,
                pointAmount: extra.pointAmount ?? 100,
                used: 0,
                remaining: extra.remaining ?? extra.pointAmount ?? 100,
                sourceType,
                effectiveAt: extra.effectiveAt ?? dayjs().subtract(1, 'day').toDate(),
                expiredAt: extra.expiredAt ?? dayjs().add(1, 'year').toDate(),
                status: PointRecordStatus.VALID,
            },
        })
        testIds.pointRecordIds.push(record.id)
        return record
    }

    describe('sumUserValidPointsDao - 各来源类型细分', () => {
        it('应区分 purchasePoint（MEMBERSHIP_GIFT）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.MEMBERSHIP_GIFT, { pointAmount: 200 })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.purchasePoint).toBeGreaterThanOrEqual(200)
        })

        it('应区分 purchasePoint（DIRECT_PURCHASE）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.DIRECT_PURCHASE, { pointAmount: 150 })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.purchasePoint).toBeGreaterThanOrEqual(150)
        })

        it('应区分 purchasePoint（MEMBERSHIP_UPGRADE_COMPENSATION）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION, { pointAmount: 50 })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.purchasePoint).toBeGreaterThanOrEqual(50)
        })

        it('应区分 purchasePoint（MEMBERSHIP_UPGRADE_TRANSFER）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER, { pointAmount: 80 })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.purchasePoint).toBeGreaterThanOrEqual(80)
        })

        it('应区分 otherPoint（非购买来源）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.ACTIVITY_REWARD, { pointAmount: 30 })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.otherPoint).toBeGreaterThanOrEqual(30)
        })

        it('应计算 pendingPoint（未生效的积分）', async () => {
            if (!testUserId) return
            await makeRecord(PointRecordSourceType.OTHER, { pointAmount: 100, effectiveAt: dayjs().add(30, 'day').toDate() })
            const s = await sumUserValidPointsDao(testUserId)
            expect(s.pendingPoint).toBeGreaterThanOrEqual(100)
        })
    })

    describe('服务层补充', () => {
        it('getUserPointRecords - 按 sourceType 筛选', async () => {
            if (!testUserId) return
            const r = await getUserPointRecords(testUserId, { sourceType: PointRecordSourceType.OTHER })
            for (const rec of r.list) expect(rec.sourceType).toBe(PointRecordSourceType.OTHER)
        })

        it('createPointRecordService - userMembershipId 为 null', async () => {
            if (!testUserId) return
            const r = await createPointRecordService({ userId: testUserId, pointAmount: 10, sourceType: PointRecordSourceType.OTHER, userMembershipId: null })
            testIds.pointRecordIds.push(r.id)
            expect(r.userMembershipId).toBeNull()
        })

        it('createPointRecordService - 自定义 effectiveAt', async () => {
            if (!testUserId) return
            const customDate = dayjs().add(5, 'day').startOf('day').toDate()
            const r = await createPointRecordService({ userId: testUserId, pointAmount: 10, sourceType: PointRecordSourceType.OTHER, effectiveAt: customDate })
            testIds.pointRecordIds.push(r.id)
            expect(dayjs(r.effectiveAt).startOf('day').valueOf()).toBe(dayjs(customDate).startOf('day').valueOf())
        })
    })
})
