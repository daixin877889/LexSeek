/**
 * LPR 同步服务测试
 *
 * **Feature: lpr-auto-sync**
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock $fetch（ofetch）：在 Nitro/Nuxt 环境中 $fetch 是 globalThis 上的全局
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

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
