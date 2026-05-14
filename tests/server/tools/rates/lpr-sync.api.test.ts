/**
 * LPR 同步 API 测试
 *
 * **Feature: lpr-auto-sync**
 *
 * 注：测试目录放在 tests/server/tools/rates/ 而非 tests/server/api/...，
 * 因为 tests/server/api/** 被 vitest exclude（参考 PR1a-T7 implementer 的踩坑修正）
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../../_helpers/handler-test'
import { prisma } from '~~/server/utils/db'
import syncStatusHandler from '~~/server/api/v1/admin/rates/lpr/sync-status.get'

function buildAdminEvent() {
    return {
        context: { auth: { user: { id: 1, role: 'super_admin' } } },
    } as any
}

describe('GET /api/v1/admin/rates/lpr/sync-status', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lprSyncLogs.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const res: any = await syncStatusHandler({ context: { auth: undefined } } as any)
        expect(res.code).toBe(401)
    })

    it('有日志时返回最近一条', async () => {
        const log = await prisma.lprSyncLogs.create({
            data: {
                startedAt: new Date(),
                finishedAt: new Date(),
                status: 'success',
                triggeredBy: 'manual',
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-01'),
                fetchedCount: 5,
                insertedCount: 1,
                operatorId: 1,
            },
        })
        createdIds.push(log.id)

        const res: any = await syncStatusHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(res.data?.id).toBe(log.id)
        expect(res.data?.status).toBe('success')
        expect(res.data?.fetchedCount).toBe(5)
        expect(res.data?.insertedCount).toBe(1)
    })
})
