/**
 * 案件分析服务层 - 补充覆盖率测试（扩展）
 *
 * 覆盖 analysis.service.ts 中已有测试未覆盖的路径：
 * - deleteAnalysisService: 删除激活版本后自动转移、删除非激活版本
 * - switchActiveVersionService: 非完成状态不可激活、成功激活
 * - saveAnalysisResultService: 验证案件/会话存在
 * - startAnalysisService: 已存在分析记录时返回现有
 * - completeAnalysisService: 成功完成
 * - getActiveAnalysisVersionService
 * - getCasesService
 *
 * **Feature: analysis-service-coverage-extra**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Nuxt 自动导入
vi.stubGlobal('prisma', {
    $transaction: vi.fn(),
    caseAnalyses: { findFirst: vi.fn() },
})
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock DAO
const mockCreateAnalysisDao = vi.fn()
const mockFindAnalysisByIdDao = vi.fn()
const mockFindManyAnalysesDao = vi.fn()
const mockFindAnalysesBySessionIdDao = vi.fn()
const mockFindAnalysisVersionsDao = vi.fn()
const mockFindLatestAnalysisVersionDao = vi.fn()
const mockFindAnalysisBySessionAndNodeDao = vi.fn()
const mockGetNextVersionDao = vi.fn()
const mockUpdateAnalysisDao = vi.fn()
const mockSoftDeleteAnalysisDao = vi.fn()
const mockSoftDeleteAnalysesBySessionDao = vi.fn()
const mockCountAnalysesByCaseIdDao = vi.fn()
const mockDeactivateVersionsDao = vi.fn()
const mockActivateVersionDao = vi.fn()
const mockFindActiveAnalysisVersionDao = vi.fn()

vi.mock('~~/server/services/case/analysis.dao', () => ({
    createAnalysisDao: (...args: any[]) => mockCreateAnalysisDao(...args),
    findAnalysisByIdDao: (...args: any[]) => mockFindAnalysisByIdDao(...args),
    findManyAnalysesDao: (...args: any[]) => mockFindManyAnalysesDao(...args),
    findAnalysesBySessionIdDao: (...args: any[]) => mockFindAnalysesBySessionIdDao(...args),
    findAnalysisVersionsDao: (...args: any[]) => mockFindAnalysisVersionsDao(...args),
    findLatestAnalysisVersionDao: (...args: any[]) => mockFindLatestAnalysisVersionDao(...args),
    findAnalysisBySessionAndNodeDao: (...args: any[]) => mockFindAnalysisBySessionAndNodeDao(...args),
    getNextVersionDao: (...args: any[]) => mockGetNextVersionDao(...args),
    updateAnalysisDao: (...args: any[]) => mockUpdateAnalysisDao(...args),
    softDeleteAnalysisDao: (...args: any[]) => mockSoftDeleteAnalysisDao(...args),
    softDeleteAnalysesBySessionDao: (...args: any[]) => mockSoftDeleteAnalysesBySessionDao(...args),
    countAnalysesByCaseIdDao: (...args: any[]) => mockCountAnalysesByCaseIdDao(...args),
    deactivateVersionsDao: (...args: any[]) => mockDeactivateVersionsDao(...args),
    activateVersionDao: (...args: any[]) => mockActivateVersionDao(...args),
    findActiveAnalysisVersionDao: (...args: any[]) => mockFindActiveAnalysisVersionDao(...args),
    AnalysisStatus: { IN_PROGRESS: 1, COMPLETED: 2, FAILED: 3 },
}))

// Mock case.service
const mockGetCaseByIdService = vi.fn()
const mockGetSessionByIdService = vi.fn()
vi.mock('~~/server/services/case/case.service', () => ({
    getCaseByIdService: (...args: any[]) => mockGetCaseByIdService(...args),
    getSessionByIdService: (...args: any[]) => mockGetSessionByIdService(...args),
}))

describe('案件分析服务层 - 扩展覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== deleteAnalysisService ====================

    describe('deleteAnalysisService - 删除激活版本后自动转移', () => {
        it('删除激活版本时自动转移到次新 COMPLETED 版本', async () => {
            // 找到的是一个 isActive=true 的记录
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                caseId: 1,
                nodeId: 10,
                isActive: true,
                status: 2,
            })
            mockUpdateAnalysisDao.mockResolvedValue({})
            mockSoftDeleteAnalysisDao.mockResolvedValue(undefined)
            // 次新版本
            ;(prisma.caseAnalyses.findFirst as any).mockResolvedValue({
                id: 2,
                caseId: 1,
                nodeId: 10,
                version: 1,
                status: 2,
            })

            const { deleteAnalysisService } = await import('~~/server/services/case/analysis.service')
            await deleteAnalysisService(1)

            // 应取消旧激活 + 软删除 + 激活次新版本
            expect(mockUpdateAnalysisDao).toHaveBeenCalledWith(1, { isActive: false })
            expect(mockSoftDeleteAnalysisDao).toHaveBeenCalledWith(1)
            // 激活次新版本
            expect(mockUpdateAnalysisDao).toHaveBeenCalledWith(2, { isActive: true })
        })

        it('删除激活版本但无次新版本时不激活任何记录', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                caseId: 1,
                nodeId: 10,
                isActive: true,
                status: 2,
            })
            mockUpdateAnalysisDao.mockResolvedValue({})
            mockSoftDeleteAnalysisDao.mockResolvedValue(undefined)
            ;(prisma.caseAnalyses.findFirst as any).mockResolvedValue(null) // 无次新版本

            const { deleteAnalysisService } = await import('~~/server/services/case/analysis.service')
            await deleteAnalysisService(1)

            expect(mockUpdateAnalysisDao).toHaveBeenCalledTimes(1) // 只取消激活，不激活新版本
        })

        it('删除非激活版本时不执行版本转移', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                caseId: 1,
                nodeId: 10,
                isActive: false,
                status: 2,
            })
            mockSoftDeleteAnalysisDao.mockResolvedValue(undefined)

            const { deleteAnalysisService } = await import('~~/server/services/case/analysis.service')
            await deleteAnalysisService(1)

            expect(mockSoftDeleteAnalysisDao).toHaveBeenCalledWith(1)
            expect(mockUpdateAnalysisDao).not.toHaveBeenCalled()
            expect(prisma.caseAnalyses.findFirst).not.toHaveBeenCalled()
        })
    })

    // ==================== switchActiveVersionService ====================

    describe('switchActiveVersionService', () => {
        it('分析记录不存在时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue(null)

            const { switchActiveVersionService } = await import('~~/server/services/case/analysis.service')

            await expect(switchActiveVersionService(999)).rejects.toThrow('分析记录不存在')
        })

        it('非完成状态时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                status: 1, // IN_PROGRESS
                caseId: 1,
                nodeId: 10,
            })

            const { switchActiveVersionService } = await import('~~/server/services/case/analysis.service')

            await expect(switchActiveVersionService(1)).rejects.toThrow('只能激活已完成的分析记录')
        })

        it('成功激活已完成的版本', async () => {
            const existing = { id: 1, status: 2, caseId: 1, nodeId: 10, isActive: false }
            mockFindAnalysisByIdDao
                .mockResolvedValueOnce(existing) // 第一次查找
                .mockResolvedValueOnce({ ...existing, isActive: true }) // 激活后再次查找
            mockActivateVersionDao.mockResolvedValue(undefined)

            const { switchActiveVersionService } = await import('~~/server/services/case/analysis.service')
            const result = await switchActiveVersionService(1)

            expect(result.isActive).toBe(true)
            expect(mockActivateVersionDao).toHaveBeenCalledWith(1, 1, 10)
        })
    })

    // ==================== saveAnalysisResultService ====================

    describe('saveAnalysisResultService', () => {
        it('案件不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)

            const { saveAnalysisResultService } = await import('~~/server/services/case/analysis.service')

            await expect(
                saveAnalysisResultService({
                    caseId: 999,
                    sessionId: 's1',
                    nodeId: 1,
                    analysisType: 'test',
                    analysisResult: '结果',
                }),
            ).rejects.toThrow('案件不存在')
        })

        it('会话不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue(null)

            const { saveAnalysisResultService } = await import('~~/server/services/case/analysis.service')

            await expect(
                saveAnalysisResultService({
                    caseId: 1,
                    sessionId: 'bad',
                    nodeId: 1,
                    analysisType: 'test',
                    analysisResult: '结果',
                }),
            ).rejects.toThrow('会话不存在')
        })

        it('成功保存分析结果', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue({ sessionId: 's1' })
            mockGetNextVersionDao.mockResolvedValue(1)
            mockCreateAnalysisDao.mockResolvedValue({
                id: 10,
                caseId: 1,
                sessionId: 's1',
                nodeId: 1,
                version: 1,
                status: 2,
            })

            const { saveAnalysisResultService } = await import('~~/server/services/case/analysis.service')
            const result = await saveAnalysisResultService({
                caseId: 1,
                sessionId: 's1',
                nodeId: 1,
                analysisType: 'test',
                analysisResult: '分析结果',
            })

            expect(result.id).toBe(10)
        })
    })

    // ==================== startAnalysisService ====================

    describe('startAnalysisService', () => {
        it('已存在分析记录时返回现有记录', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue({ sessionId: 's1' })
            mockFindAnalysisBySessionAndNodeDao.mockResolvedValue({
                id: 5,
                status: 1,
            })

            const { startAnalysisService } = await import('~~/server/services/case/analysis.service')
            const result = await startAnalysisService({
                caseId: 1,
                sessionId: 's1',
                nodeId: 10,
                analysisType: 'test',
            })

            expect(result.id).toBe(5)
            // 不应创建新记录
            expect(mockCreateAnalysisDao).not.toHaveBeenCalled()
        })

        it('案件不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)

            const { startAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(
                startAnalysisService({
                    caseId: 999,
                    sessionId: 's1',
                    nodeId: 10,
                    analysisType: 'test',
                }),
            ).rejects.toThrow('案件不存在')
        })

        it('会话不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue(null)

            const { startAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(
                startAnalysisService({
                    caseId: 1,
                    sessionId: 'bad',
                    nodeId: 10,
                    analysisType: 'test',
                }),
            ).rejects.toThrow('会话不存在')
        })
    })

    // ==================== completeAnalysisService ====================

    describe('completeAnalysisService', () => {
        it('分析记录不存在时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue(null)

            const { completeAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(completeAnalysisService(999, '结果')).rejects.toThrow('分析记录不存在')
        })

        it('成功完成分析', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({ id: 1, status: 1 })
            mockUpdateAnalysisDao.mockResolvedValue({
                id: 1,
                analysisResult: '结果',
                status: 2,
            })

            const { completeAnalysisService } = await import('~~/server/services/case/analysis.service')
            const result = await completeAnalysisService(1, '结果', '原始结果')

            expect(result.status).toBe(2)
            expect(mockUpdateAnalysisDao).toHaveBeenCalledWith(1, {
                analysisResult: '结果',
                originalResult: '原始结果',
                status: 2,
            })
        })
    })

    // ==================== getActiveAnalysisVersionService ====================

    describe('getActiveAnalysisVersionService', () => {
        it('返回激活版本', async () => {
            mockFindActiveAnalysisVersionDao.mockResolvedValue({
                id: 1,
                isActive: true,
            })

            const { getActiveAnalysisVersionService } = await import('~~/server/services/case/analysis.service')
            const result = await getActiveAnalysisVersionService(1, 10)

            expect(result?.isActive).toBe(true)
        })

        it('无激活版本时返回 null', async () => {
            mockFindActiveAnalysisVersionDao.mockResolvedValue(null)

            const { getActiveAnalysisVersionService } = await import('~~/server/services/case/analysis.service')
            const result = await getActiveAnalysisVersionService(1, 10)

            expect(result).toBeNull()
        })
    })

    // ==================== updateAnalysisResultService ====================

    describe('updateAnalysisResultService', () => {
        it('分析记录不存在时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue(null)

            const { updateAnalysisResultService } = await import('~~/server/services/case/analysis.service')

            await expect(updateAnalysisResultService(999, '新结果')).rejects.toThrow('分析记录不存在')
        })

        it('成功更新分析结果', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({ id: 1 })
            mockUpdateAnalysisDao.mockResolvedValue({
                id: 1,
                analysisResult: '新结果',
            })

            const { updateAnalysisResultService } = await import('~~/server/services/case/analysis.service')
            const result = await updateAnalysisResultService(1, '新结果', '原始结果')

            expect(result.analysisResult).toBe('新结果')
        })
    })

    // ==================== getSessionAnalysesService / getAnalysisVersionsService ====================

    describe('getSessionAnalysesService', () => {
        it('返回会话的所有分析结果', async () => {
            mockFindAnalysesBySessionIdDao.mockResolvedValue([
                { id: 1, sessionId: 's1' },
                { id: 2, sessionId: 's1' },
            ])

            const { getSessionAnalysesService } = await import('~~/server/services/case/analysis.service')
            const result = await getSessionAnalysesService('s1')

            expect(result).toHaveLength(2)
        })
    })

    describe('getAnalysisVersionsService', () => {
        it('返回节点的所有版本', async () => {
            mockFindAnalysisVersionsDao.mockResolvedValue([
                { id: 1, version: 2 },
                { id: 2, version: 1 },
            ])

            const { getAnalysisVersionsService } = await import('~~/server/services/case/analysis.service')
            const result = await getAnalysisVersionsService(1, 10)

            expect(result).toHaveLength(2)
        })
    })

    describe('getLatestAnalysisVersionService', () => {
        it('返回最新版本', async () => {
            mockFindLatestAnalysisVersionDao.mockResolvedValue({ id: 1, version: 3 })

            const { getLatestAnalysisVersionService } = await import('~~/server/services/case/analysis.service')
            const result = await getLatestAnalysisVersionService(1, 10)

            expect(result?.version).toBe(3)
        })
    })
})
