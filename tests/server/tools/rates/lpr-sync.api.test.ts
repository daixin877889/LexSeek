/**
 * LPR 同步 API 测试
 *
 * **Feature: lpr-auto-sync**
 *
 * 注：测试目录放在 tests/server/tools/rates/ 而非 tests/server/api/...，
 * 因为 tests/server/api/** 被 vitest exclude（参考 PR1a-T7 implementer 的踩坑修正）
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import '../../_helpers/handler-test'

// mock $fetch（ofetch）：在 Nitro/Nuxt 环境中 $fetch 是 globalThis 上的全局
// 须在 import handler 之前 stub，以便 handler 引入的 service 拿到 mock
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

// 测试结束时清理全局 stub，避免污染同 worker 内后续测试文件
afterAll(() => {
    vi.unstubAllGlobals()
})

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

import syncHandler from '~~/server/api/v1/admin/rates/lpr/sync.post'

describe('POST /api/v1/admin/rates/lpr/sync', () => {
    const createdLogIds: number[] = []
    const createdRateDates: string[] = []

    afterEach(async () => {
        fetchMock.mockReset()
        if (createdLogIds.length > 0) {
            await prisma.lprSyncLogs.deleteMany({ where: { id: { in: createdLogIds } } })
            createdLogIds.length = 0
        }
        if (createdRateDates.length > 0) {
            await prisma.lprRates.deleteMany({
                where: { effectDate: { in: createdRateDates.map((d) => new Date(d)) } },
            })
            createdRateDates.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const res: any = await syncHandler({ context: { auth: undefined } } as any)
        expect(res.code).toBe(401)
    })

    it('成功触发同步，返回 fetched + inserted + logId', async () => {
        const newDate = `2097-03-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(newDate)

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate, showDateEN: '' },
            ],
        })

        const res: any = await syncHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(res.data?.fetched).toBe(1)
        expect(res.data?.inserted).toBe(1)
        expect(typeof res.data?.logId).toBe('number')
        createdLogIds.push(res.data.logId)

        // 验证 log 的 operatorId
        const log = await prisma.lprSyncLogs.findUnique({ where: { id: res.data.logId } })
        expect(log?.operatorId).toBe(1)
        expect(log?.triggeredBy).toBe('manual')
    })

    it('chinamoney 报错时返回 500 + 错误消息', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        const res: any = await syncHandler(buildAdminEvent())
        expect(res.code).toBe(500)
        expect(res.message).toMatch(/chinamoney API 错误/)

        // 验证 failure log 已落库
        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', operatorId: 1 },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        createdLogIds.push(log!.id)
    })
})
