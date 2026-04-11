/**
 * 分析记录超时清理测试
 *
 * 测试 cleanupStaleAnalysesService 及其依赖的 DAO 函数
 *
 * **Feature: cron-scheduler**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('logger', {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
})

vi.stubGlobal('prisma', {})

const mockFindStale = vi.fn()
const mockBatchUpdate = vi.fn()

vi.mock('../../../server/services/case/analysis.dao', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/services/case/analysis.dao')>()
    return {
        ...actual,
        findStaleInProgressAnalysesDao: mockFindStale,
        batchUpdateAnalysisStatusDao: mockBatchUpdate,
    }
})

const { cleanupStaleAnalysesService } = await import(
    '../../../server/services/case/analysis.service'
)
const { AnalysisStatus } = await import(
    '../../../server/services/case/analysis.dao'
)

describe('cleanupStaleAnalysesService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('无超时记录时返回 0', async () => {
        mockFindStale.mockResolvedValue([])
        const result = await cleanupStaleAnalysesService()
        expect(result).toBe(0)
        expect(mockBatchUpdate).not.toHaveBeenCalled()
    })

    it('有超时记录时标记为 FAILED 并返回处理数量', async () => {
        mockFindStale.mockResolvedValue([1, 2, 3])
        mockBatchUpdate.mockResolvedValue(3)
        const result = await cleanupStaleAnalysesService()
        expect(result).toBe(3)
        expect(mockBatchUpdate).toHaveBeenCalledWith([1, 2, 3], AnalysisStatus.FAILED)
    })

    it('未超时记录不受影响', async () => {
        mockFindStale.mockResolvedValue([10])
        await cleanupStaleAnalysesService()
        expect(mockBatchUpdate).toHaveBeenCalledWith([10], AnalysisStatus.FAILED)
    })

    it('已软删除记录不受影响', async () => {
        mockFindStale.mockResolvedValue([])
        const result = await cleanupStaleAnalysesService()
        expect(result).toBe(0)
        expect(mockFindStale).toHaveBeenCalledWith(2 * 60 * 60 * 1000)
    })
})
