/**
 * 消耗记录聚合查询测试
 *
 * **Feature: unified-point-billing**
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findAggregatedConsumptionRecordsByUserIdDao } from '~~/server/services/point/pointConsumptionRecords.dao'
import { isTestDbAvailable, createTestUser, createTestPointRecord } from '../membership/test-db-helper'

describe('消耗记录聚合查询', () => {
    let dbAvailable = false
    const userIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
    })

    it('同一 operationId 的多条记录应聚合成一行并合计积分', async () => {
        if (!dbAvailable) return
        const user = await createTestUser()
        userIds.push(user.id)
        const pr = await createTestPointRecord(user.id, { pointAmount: 100, used: 0, remaining: 100 })
        const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        for (const amt of [3, 2, 4]) {
            await prisma.pointConsumptionRecords.create({
                data: {
                    userId: user.id, pointRecordId: pr.id, itemId: item.id, pointAmount: amt, status: 2,
                    operationId: 'op-agg-1', contextLabel: '关于工伤认定的咨询',
                },
            })
        }
        const result = await findAggregatedConsumptionRecordsByUserIdDao(user.id, { page: 1, pageSize: 10 })
        expect(result.total).toBe(1)
        expect(result.list).toHaveLength(1)
        expect(result.list[0]!.totalPoints).toBe(9)
        expect(result.list[0]!.contextLabel).toBe('关于工伤认定的咨询')
        expect(result.list[0]!.recordCount).toBe(3)
    })

    it('operationId 为空的旧记录各自独立成行', async () => {
        if (!dbAvailable) return
        const user = await createTestUser()
        userIds.push(user.id)
        const pr = await createTestPointRecord(user.id, { pointAmount: 100, used: 0, remaining: 100 })
        const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        for (const amt of [3, 2]) {
            await prisma.pointConsumptionRecords.create({
                data: { userId: user.id, pointRecordId: pr.id, itemId: item.id, pointAmount: amt, status: 2 },
            })
        }
        const result = await findAggregatedConsumptionRecordsByUserIdDao(user.id, { page: 1, pageSize: 10 })
        expect(result.total).toBe(2)
    })
})
