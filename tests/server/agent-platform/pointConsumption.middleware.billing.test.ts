/**
 * token 计费中间件 —— 统一计费接入测试
 *
 * **Feature: unified-point-billing**
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

// interrupt 在图运行上下文外调用会抛错，mock 成可观测的空操作。
// vi.mock 工厂会被提升到 import 之上，引用的变量必须用 vi.hoisted 一并提升。
const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }))
vi.mock('@langchain/langgraph', async (orig) => ({
    ...(await orig<any>()),
    interrupt: (...args: any[]) => interruptMock(...args),
}))
// 绕过会员校验：返回 truthy 会员
vi.mock('~~/server/services/membership/userMembership.service', () => ({
    getCurrentMembershipService: vi.fn(async () => ({ id: 1 })),
}))

import { prisma } from '~~/server/utils/db'
import { pointConsumptionMiddleware } from '~~/server/services/agent-platform/middleware/pointConsumption.middleware'
import { isTestDbAvailable, createTestUser, createTestPointRecord } from '../membership/test-db-helper'

describe('token 计费中间件统一计费接入', () => {
    let dbAvailable = false
    const userIds: number[] = []
    const keys: string[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        interruptMock.mockClear()
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointConsumptionItems.deleteMany({ where: { key: { in: keys } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        keys.length = 0
    })

    it('配置项停用时不中断、不产生消耗记录', async () => {
        if (!dbAvailable) return
        const key = `mw_disabled_${Date.now()}`
        keys.push(key)
        await prisma.pointConsumptionItems.create({
            data: {
                key, group: 'test', name: '停用项', unit: '千tokens',
                pointAmount: 1, status: 0, billingMode: 1,
            },
        })
        const user = await createTestUser()
        userIds.push(user.id)

        const mw: any = pointConsumptionMiddleware(user.id, key)
        await mw.beforeAgent.hook({ _resumingFromAfterModel: false } as any, {} as any)
        await mw.afterModel.hook(
            { messages: [{ content: 'hi', usage_metadata: { total_tokens: 2000 } }], _billingOperationId: '' } as any,
            {} as any,
        )

        expect(interruptMock).not.toHaveBeenCalled()
        const count = await prisma.pointConsumptionRecords.count({ where: { userId: user.id } })
        expect(count).toBe(0)
    })

    it('配置项启用且积分充足时按 token 扣减并写 operationId', async () => {
        if (!dbAvailable) return
        const key = `mw_enabled_${Date.now()}`
        keys.push(key)
        await prisma.pointConsumptionItems.create({
            data: {
                key, group: 'test', name: '启用项', unit: '千tokens',
                pointAmount: 1, status: 1, billingMode: 1, discount: '1.00',
            },
        })
        const user = await createTestUser()
        userIds.push(user.id)
        await createTestPointRecord(user.id, {
            pointAmount: 1000, used: 0, remaining: 1000,
        })

        const mw: any = pointConsumptionMiddleware(user.id, key)
        const beforeResult = await mw.beforeAgent.hook({ _resumingFromAfterModel: false } as any, {} as any)
        const opId = (beforeResult as any)._billingOperationId
        expect(opId).toBeTruthy()

        await mw.afterModel.hook(
            { messages: [{ content: 'x', usage_metadata: { total_tokens: 2000 } }], _billingOperationId: opId } as any,
            {} as any,
        )

        const recs = await prisma.pointConsumptionRecords.findMany({ where: { userId: user.id } })
        expect(recs.length).toBeGreaterThan(0)
        expect(recs[0]!.operationId).toBe(opId)
        expect(interruptMock).not.toHaveBeenCalled()
    })
})
