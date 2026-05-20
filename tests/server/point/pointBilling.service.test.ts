/**
 * 统一计费服务测试
 *
 * **Feature: unified-point-billing**
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    billCheckService,
    billDirectService,
    billReserveService,
    billSettleService,
    billRollbackService,
} from '~~/server/services/point/pointBilling.service'
import { isTestDbAvailable, createTestUser, createTestPointRecord } from '../membership/test-db-helper'

const TEST_KEY_PREFIX = 'bill_test_'

async function setupFixture(opts: { billingMode: number; status: number; pointAmount: number; discount: string }) {
    const user = await createTestUser()
    await createTestPointRecord(user.id, {
        pointAmount: 1000,
        used: 0,
        remaining: 1000,
    })
    const key = `${TEST_KEY_PREFIX}${Date.now()}_${Math.floor(Math.random() * 10000)}`
    await prisma.pointConsumptionItems.create({
        data: {
            key,
            group: 'test',
            name: '计费测试项',
            unit: '次',
            pointAmount: opts.pointAmount,
            status: opts.status,
            discount: opts.discount,
            billingMode: opts.billingMode,
        },
    })
    return { user, key }
}

describe('统一计费服务', () => {
    let dbAvailable = false
    const createdUserIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await prisma.pointConsumptionItems.deleteMany({ where: { key: { startsWith: TEST_KEY_PREFIX } } })
        await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        createdUserIds.length = 0
    })

    it('停用的消耗项目应跳过扣减', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 })
        expect(r.skipped).toBe(true)
        expect(r.consumedAmount).toBe(0)
        const count = await prisma.pointConsumptionRecords.count({ where: { userId: user.id } })
        expect(count).toBe(0)
    })

    it('按次量模式应按 units 扣减并记录用量', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 }, { contextLabel: '身份证.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBe(15) // 5 * 3 * 1.0
        const rec = await prisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
        expect(rec.usageAmount).toBe(3)
        expect(rec.contextLabel).toBe('身份证.jpg')
        expect(rec.operationId).toBe(r.operationId)
    })

    it('按 token 模式应按 ceil(tokens/1000) 扣减且不记用量', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 1, status: 1, pointAmount: 2, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { tokens: 2400 })
        expect(r.consumedAmount).toBe(6) // 2 * ceil(2400/1000) = 2 * 3
        const rec = await prisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
        expect(rec.usageAmount).toBeNull()
    })

    it('billCheck 对停用项返回 skipped 且 sufficient=true', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const c = await billCheckService(user.id, key, { units: 1 })
        expect(c.skipped).toBe(true)
        expect(c.sufficient).toBe(true)
    })

    it('billReserve 预扣后 billSettle 应结算', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 4, discount: '1.00' })
        createdUserIds.push(user.id)
        const reserved = await billReserveService(user.id, key, { units: 2 }, { contextLabel: '录音.mp3' })
        expect(reserved.skipped).toBe(false)
        expect(reserved.preDeductAmount).toBe(8) // 4 * 2
        expect(reserved.batchId).not.toBe('')

        const settled = await billSettleService(reserved.batchId, 3) // 实际 3 分钟
        expect(settled.consumedAmount).toBe(12) // 4 * 3
    })

    it('billReserve 后 billRollback 应回滚', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 4, discount: '1.00' })
        createdUserIds.push(user.id)
        const reserved = await billReserveService(user.id, key, { units: 2 })
        const rolled = await billRollbackService(reserved.batchId)
        expect(rolled.releasedAmount).toBe(8)
    })

    it('停用项 billReserve 应跳过', async () => {
        if (!dbAvailable) return
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 4, discount: '1.00' })
        createdUserIds.push(user.id)
        const reserved = await billReserveService(user.id, key, { units: 2 })
        expect(reserved.skipped).toBe(true)
        expect(reserved.batchId).toBe('')
    })
})
