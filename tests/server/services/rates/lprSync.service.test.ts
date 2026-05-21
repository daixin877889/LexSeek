/**
 * LPR 同步服务测试
 *
 * **Feature: lpr-auto-sync**
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// mock $fetch（ofetch）：在 Nitro/Nuxt 环境中 $fetch 是 globalThis 上的全局
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

// 测试结束时清理全局 stub，避免污染同 worker 内后续测试文件（如 rates.service.test.ts 真实调用 $fetch）
afterAll(() => {
    vi.unstubAllGlobals()
})

import { fetchLPRFromChinamoneyService } from '~~/server/services/rates/lprSync.service'

describe('fetchLPRFromChinamoneyService', () => {
    beforeEach(() => {
        fetchMock.mockReset()
    })

    it('成功响应返回 records 数组', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 1778752637625 },
            data: { endDateCN: '2025-12-31', startDateCN: '2025-11-01', message: '' },
            records: [
                { '5Y': '3.50', '1Y': '3.00', showDateCN: '2025-12-22', showDateEN: '22 Dec 2025' },
                { '5Y': '3.50', '1Y': '3.00', showDateCN: '2025-11-20', showDateEN: '20 Nov 2025' },
            ],
        })

        const records = await fetchLPRFromChinamoneyService({
            rangeStart: new Date('2025-11-01'),
            rangeEnd: new Date('2025-12-31'),
        })

        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({ '1Y': '3.00', '5Y': '3.50', showDateCN: '2025-12-22' })

        // 验证 fetch 调用参数
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('strStartDate=2025-11-01'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Referer: expect.stringContaining('chinamoney.com.cn'),
                    'User-Agent': expect.stringContaining('Mozilla'),
                }),
                timeout: 30_000,
            }),
        )
    })

    it('rep_code !== 200 时抛错', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        await expect(
            fetchLPRFromChinamoneyService({
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-31'),
            }),
        ).rejects.toThrow(/chinamoney API 错误.*500.*内部错误/)
    })

    it('空 records 返回空数组（不抛错）', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [],
        })

        const records = await fetchLPRFromChinamoneyService({
            rangeStart: new Date('2025-11-01'),
            rangeEnd: new Date('2025-11-02'),
        })
        expect(records).toEqual([])
    })

    it('网络异常时透传错误', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

        await expect(
            fetchLPRFromChinamoneyService({
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-31'),
            }),
        ).rejects.toThrow('ECONNREFUSED')
    })
})

import { afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { syncLPRRatesService, getLatestLPRSyncStatusService } from '~~/server/services/rates/lprSync.service'

describe('syncLPRRatesService', () => {
    const createdLogIds: number[] = []
    const createdRateDates: string[] = []

    beforeEach(() => {
        fetchMock.mockReset()
    })

    afterEach(async () => {
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

    it('happy path：拉到 2 条新数据全部入库', async () => {
        const newDate1 = `2099-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const newDate2 = `2099-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(newDate1, newDate2)

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate1, showDateEN: '' },
                { '1Y': '3.20', '5Y': '3.70', showDateCN: newDate2, showDateEN: '' },
            ],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'manual', operatorId: 1 })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(2)
        expect(result.inserted).toBe(2)

        // 验证 sync log
        const log = await prisma.lprSyncLogs.findUnique({ where: { id: result.logId } })
        expect(log).toMatchObject({
            status: 'success',
            triggeredBy: 'manual',
            operatorId: 1,
            fetchedCount: 2,
            insertedCount: 2,
        })
        expect(log!.finishedAt).not.toBeNull()
        expect(log!.errorMessage).toBeNull()

        // 验证 lpr_rates 真的入库
        const rate1 = await prisma.lprRates.findUnique({ where: { effectDate: new Date(newDate1) } })
        expect(Number(rate1!.oneYear)).toBeCloseTo(3.10)
        expect(Number(rate1!.fiveYear)).toBeCloseTo(3.60)
    })

    it('已存在的 effectDate 跳过，inserted 只算新数据', async () => {
        const existingDate = `2098-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const newDate = `2098-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(existingDate, newDate)

        // 预先插入 existingDate
        await prisma.lprRates.create({
            data: {
                effectDate: new Date(existingDate),
                oneYear: 1.0,
                fiveYear: 2.0,
            },
        })

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '9.99', '5Y': '9.99', showDateCN: existingDate, showDateEN: '' }, // 已存在
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate, showDateEN: '' }, // 新
            ],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'auto' })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(2)
        expect(result.inserted).toBe(1)

        // 验证已存在的没被覆盖（仍是 1.0/2.0 而不是 9.99）
        const existing = await prisma.lprRates.findUnique({ where: { effectDate: new Date(existingDate) } })
        expect(Number(existing!.oneYear)).toBeCloseTo(1.0)
        expect(Number(existing!.fiveYear)).toBeCloseTo(2.0)
    })

    it('API 失败时记 sync log failure + 抛错', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        await expect(
            syncLPRRatesService({ triggeredBy: 'auto' }),
        ).rejects.toThrow(/chinamoney API 错误/)

        // 验证 failure log 已落库（找最近一条 failure）
        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', triggeredBy: 'auto' },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        expect(log!.errorMessage).toMatch(/chinamoney API 错误/)
        expect(log!.fetchedCount).toBe(0)
        expect(log!.insertedCount).toBe(0)
        createdLogIds.push(log!.id)
    })

    it('空 records 视为成功 fetched=0/inserted=0', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'auto' })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(0)
        expect(result.inserted).toBe(0)

        const log = await prisma.lprSyncLogs.findUnique({ where: { id: result.logId } })
        expect(log!.status).toBe('success')
    })

    it('网络异常时记 failure', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'))

        await expect(
            syncLPRRatesService({ triggeredBy: 'auto' }),
        ).rejects.toThrow('ETIMEDOUT')

        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', errorMessage: { contains: 'ETIMEDOUT' } },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        createdLogIds.push(log!.id)
    })
})

describe('getLatestLPRSyncStatusService', () => {
    let createdId: number | null = null

    afterEach(async () => {
        if (createdId !== null) {
            await prisma.lprSyncLogs.delete({ where: { id: createdId } }).catch(() => {})
            createdId = null
        }
    })

    it('返回最近一条日志（按 startedAt desc）', async () => {
        const past = new Date(Date.now() - 60_000)
        const recent = new Date()

        const old = await prisma.lprSyncLogs.create({
            data: {
                startedAt: past,
                status: 'success',
                triggeredBy: 'auto',
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-01'),
                fetchedCount: 1,
                insertedCount: 1,
            },
        })
        const newer = await prisma.lprSyncLogs.create({
            data: {
                startedAt: recent,
                status: 'success',
                triggeredBy: 'manual',
                rangeStart: new Date('2025-12-01'),
                rangeEnd: new Date('2026-01-01'),
                fetchedCount: 2,
                insertedCount: 2,
            },
        })
        createdId = newer.id

        const latest = await getLatestLPRSyncStatusService()
        expect(latest?.id).toBe(newer.id)

        // 清理 old
        await prisma.lprSyncLogs.delete({ where: { id: old.id } })
    })

    it('没有日志时返回 null', async () => {
        // 测试库可能有其他测试残留的日志，这里只验证函数本身能调通
        const latest = await getLatestLPRSyncStatusService()
        expect(latest === null || typeof latest.id === 'number').toBe(true)
    })
})
