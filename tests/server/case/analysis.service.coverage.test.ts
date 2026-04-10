/**
 * 案件分析服务层 - 补充覆盖率测试
 *
 * 覆盖 analysis.service.ts 中已有集成测试未覆盖的路径：
 * - saveAndActivateAnalysisService（事务内保存+激活）
 * - failAnalysisService
 * - getCaseAnalysisHistoryService
 * - deleteSessionAnalysesService
 * - countCaseAnalysesService
 * - hasAnalysisForNodeService
 * - getAnalysisBySessionAndNodeService
 * - regenerateAnalysisService
 * - appendAnalysisResultService
 *
 * **Feature: analysis-service-coverage**
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

describe('案件分析服务层 - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('saveAndActivateAnalysisService - 保存并激活', () => {
        it('在事务中保存并激活版本', async () => {
            ;(prisma.$transaction as any).mockImplementation(async (fn: Function) => fn(prisma))
            mockGetNextVersionDao.mockResolvedValue(2)
            mockCreateAnalysisDao.mockResolvedValue({
                id: 10,
                version: 2,
                status: 2,
            })
            mockActivateVersionDao.mockResolvedValue(undefined)

            const { saveAndActivateAnalysisService } = await import('~~/server/services/case/analysis.service')

            const result = await saveAndActivateAnalysisService({
                caseId: 1,
                sessionId: 's1',
                nodeId: 1,
                analysisType: 'test',
                analysisResult: '结果',
                tokenCount: 10,
                tokens: 5000,
            })

            expect(result.id).toBe(10)
            expect(mockActivateVersionDao).toHaveBeenCalledWith(10, 1, 1, expect.anything())
        })
    })

    describe('failAnalysisService - 标记分析失败', () => {
        it('分析记录不存在时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue(null)

            const { failAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(failAnalysisService(999)).rejects.toThrow('分析记录不存在')
        })

        it('成功标记为失败', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({ id: 1 })
            mockUpdateAnalysisDao.mockResolvedValue({ id: 1, status: 3 })

            const { failAnalysisService } = await import('~~/server/services/case/analysis.service')
            const result = await failAnalysisService(1)

            expect(result.status).toBe(3)
        })
    })

    describe('getCaseAnalysisHistoryService - 获取分析历史', () => {
        it('案件不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)

            const { getCaseAnalysisHistoryService } = await import('~~/server/services/case/analysis.service')

            await expect(getCaseAnalysisHistoryService(999)).rejects.toThrow('案件不存在')
        })

        it('按节点分组返回分析历史', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockFindManyAnalysesDao.mockResolvedValue({
                list: [
                    {
                        id: 1,
                        nodeId: 10,
                        node: { name: 'summary', title: '概要', type: 'analysis' },
                        version: 1,
                        sessionId: 's1',
                        status: 2,
                        createdAt: new Date(),
                    },
                    {
                        id: 2,
                        nodeId: 10,
                        node: { name: 'summary', title: '概要', type: 'analysis' },
                        version: 2,
                        sessionId: 's1',
                        status: 2,
                        createdAt: new Date(),
                    },
                    {
                        id: 3,
                        nodeId: 20,
                        node: { name: 'chronicle', title: '大事记', type: 'analysis' },
                        version: 1,
                        sessionId: 's1',
                        status: 2,
                        createdAt: new Date(),
                    },
                ],
            })

            const { getCaseAnalysisHistoryService } = await import('~~/server/services/case/analysis.service')
            const result = await getCaseAnalysisHistoryService(1)

            expect(result).toHaveLength(2)
            expect(result[0].nodeId).toBe(10)
            expect(result[0].versions).toHaveLength(2)
            expect(result[1].nodeId).toBe(20)
            expect(result[1].versions).toHaveLength(1)
        })

        it('无 node 信息的分析记录不创建新分组', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockFindManyAnalysesDao.mockResolvedValue({
                list: [
                    {
                        id: 1,
                        nodeId: 10,
                        node: null, // 无 node 信息
                        version: 1,
                        sessionId: 's1',
                        status: 2,
                        createdAt: new Date(),
                    },
                ],
            })

            const { getCaseAnalysisHistoryService } = await import('~~/server/services/case/analysis.service')
            const result = await getCaseAnalysisHistoryService(1)

            expect(result).toHaveLength(0)
        })
    })

    describe('deleteSessionAnalysesService - 删除会话分析结果', () => {
        it('调用 softDeleteAnalysesBySessionDao', async () => {
            mockSoftDeleteAnalysesBySessionDao.mockResolvedValue(undefined)

            const { deleteSessionAnalysesService } = await import('~~/server/services/case/analysis.service')
            await deleteSessionAnalysesService('s1')

            expect(mockSoftDeleteAnalysesBySessionDao).toHaveBeenCalledWith('s1')
        })
    })

    describe('countCaseAnalysesService - 统计分析数量', () => {
        it('返回统计数量', async () => {
            mockCountAnalysesByCaseIdDao.mockResolvedValue(5)

            const { countCaseAnalysesService } = await import('~~/server/services/case/analysis.service')
            const count = await countCaseAnalysesService(1)

            expect(count).toBe(5)
        })

        it('支持状态筛选', async () => {
            mockCountAnalysesByCaseIdDao.mockResolvedValue(3)

            const { countCaseAnalysesService } = await import('~~/server/services/case/analysis.service')
            await countCaseAnalysesService(1, 2)

            expect(mockCountAnalysesByCaseIdDao).toHaveBeenCalledWith(1, 2)
        })
    })

    describe('hasAnalysisForNodeService - 检查节点是否有分析', () => {
        it('有分析时返回 true', async () => {
            mockFindAnalysisBySessionAndNodeDao.mockResolvedValue({ id: 1 })

            const { hasAnalysisForNodeService } = await import('~~/server/services/case/analysis.service')
            const result = await hasAnalysisForNodeService('s1', 10)

            expect(result).toBe(true)
        })

        it('无分析时返回 false', async () => {
            mockFindAnalysisBySessionAndNodeDao.mockResolvedValue(null)

            const { hasAnalysisForNodeService } = await import('~~/server/services/case/analysis.service')
            const result = await hasAnalysisForNodeService('s1', 10)

            expect(result).toBe(false)
        })
    })

    describe('getAnalysisBySessionAndNodeService - 获取节点分析', () => {
        it('返回分析结果', async () => {
            mockFindAnalysisBySessionAndNodeDao.mockResolvedValue({ id: 1, analysisResult: '结果' })

            const { getAnalysisBySessionAndNodeService } = await import('~~/server/services/case/analysis.service')
            const result = await getAnalysisBySessionAndNodeService('s1', 10)

            expect(result?.analysisResult).toBe('结果')
        })
    })

    describe('regenerateAnalysisService - 重新生成分析', () => {
        it('案件不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue(null)

            const { regenerateAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(regenerateAnalysisService(999, 's1', 10, 'test')).rejects.toThrow('案件不存在')
        })

        it('会话不存在时抛出错误', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue(null)

            const { regenerateAnalysisService } = await import('~~/server/services/case/analysis.service')

            await expect(regenerateAnalysisService(1, 'bad', 10, 'test')).rejects.toThrow('会话不存在')
        })

        it('成功创建新版本', async () => {
            mockGetCaseByIdService.mockResolvedValue({ id: 1 })
            mockGetSessionByIdService.mockResolvedValue({ sessionId: 's1' })
            mockGetNextVersionDao.mockResolvedValue(3)
            mockCreateAnalysisDao.mockResolvedValue({
                id: 10,
                version: 3,
                status: 1,
            })

            const { regenerateAnalysisService } = await import('~~/server/services/case/analysis.service')
            const result = await regenerateAnalysisService(1, 's1', 10, 'test')

            expect(result.version).toBe(3)
            expect(result.status).toBe(1) // IN_PROGRESS
        })
    })

    describe('appendAnalysisResultService - 追加分析结果', () => {
        it('分析记录不存在时抛出错误', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue(null)

            const { appendAnalysisResultService } = await import('~~/server/services/case/analysis.service')

            await expect(appendAnalysisResultService(999, '追加')).rejects.toThrow('分析记录不存在')
        })

        it('成功追加内容', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                analysisResult: '已有内容',
            })
            mockUpdateAnalysisDao.mockResolvedValue({
                id: 1,
                analysisResult: '已有内容追加的内容',
            })

            const { appendAnalysisResultService } = await import('~~/server/services/case/analysis.service')
            const result = await appendAnalysisResultService(1, '追加的内容')

            expect(result.analysisResult).toBe('已有内容追加的内容')
            expect(mockUpdateAnalysisDao).toHaveBeenCalledWith(1, {
                analysisResult: '已有内容追加的内容',
            })
        })

        it('原有结果为 null 时正常追加', async () => {
            mockFindAnalysisByIdDao.mockResolvedValue({
                id: 1,
                analysisResult: null,
            })
            mockUpdateAnalysisDao.mockResolvedValue({
                id: 1,
                analysisResult: '新内容',
            })

            const { appendAnalysisResultService } = await import('~~/server/services/case/analysis.service')
            await appendAnalysisResultService(1, '新内容')

            expect(mockUpdateAnalysisDao).toHaveBeenCalledWith(1, {
                analysisResult: '新内容',
            })
        })
    })

    describe('getAnalysesService - 获取分析列表', () => {
        it('返回分页列表', async () => {
            mockFindManyAnalysesDao.mockResolvedValue({ list: [{ id: 1 }], total: 1 })

            const { getAnalysesService } = await import('~~/server/services/case/analysis.service')
            const result = await getAnalysesService({ caseId: 1 })

            expect(result.total).toBe(1)
        })
    })
})
