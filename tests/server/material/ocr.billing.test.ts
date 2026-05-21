/**
 * OCR 扣费接入 —— ocr_recognize 计费项验证
 *
 * **Feature: unified-point-billing**
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'
import { isTestDbAvailable, createTestUser, createTestPointRecord } from '../membership/test-db-helper'

describe('OCR 扣费接入', () => {
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
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 0 } })
    })

    it('ocr_recognize 启用时按张扣减', async () => {
        if (!dbAvailable) return
        const user = await createTestUser()
        userIds.push(user.id)
        await createTestPointRecord(user.id, { pointAmount: 100, used: 0, remaining: 100 })
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'ocr_recognize', { units: 1 }, { contextLabel: 'test.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('ocr_recognize 停用时跳过', async () => {
        if (!dbAvailable) return
        const user = await createTestUser()
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'ocr_recognize', { units: 1 })
        expect(r.skipped).toBe(true)
    })
})
