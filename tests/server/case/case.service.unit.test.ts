/**
 * 案件服务层单元测试
 *
 * 使用不同文件名避免 vitest.config.ts 中的排除规则
 * Mock 所有 Nuxt 自动导入的依赖
 *
 * **Feature: case-service-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CaseStatus, SessionStatus, CaseMaterialType } from '#shared/types/case'

// Mock Nuxt 自动导入的全局变量
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
vi.stubGlobal('getEnabledCaseTypesService', vi.fn().mockResolvedValue([]))

// Mock DAO 层
const mockCreateCaseDao = vi.fn()
const mockCreateSessionDao = vi.fn()
const mockFindCaseByIdDao = vi.fn()
const mockFindCaseBySessionIdDao = vi.fn()
const mockFindSessionByIdDao = vi.fn()
const mockFindManyCasesDao = vi.fn()
const mockUpdateCaseDao = vi.fn()
const mockUpdateSessionStatusDao = vi.fn()
const mockSoftDeleteCaseDao = vi.fn()
const mockFindLatestSessionByCaseIdDao = vi.fn()
const mockCheckCaseOwnershipDao = vi.fn()

vi.mock('~~/server/services/case/case.dao', () => ({
    createCaseDao: (...args: any[]) => mockCreateCaseDao(...args),
    createSessionDao: (...args: any[]) => mockCreateSessionDao(...args),
    findCaseByIdDao: (...args: any[]) => mockFindCaseByIdDao(...args),
    findCaseBySessionIdDao: (...args: any[]) => mockFindCaseBySessionIdDao(...args),
    findSessionByIdDao: (...args: any[]) => mockFindSessionByIdDao(...args),
    findManyCasesDao: (...args: any[]) => mockFindManyCasesDao(...args),
    updateCaseDao: (...args: any[]) => mockUpdateCaseDao(...args),
    updateSessionStatusDao: (...args: any[]) => mockUpdateSessionStatusDao(...args),
    softDeleteCaseDao: (...args: any[]) => mockSoftDeleteCaseDao(...args),
    findLatestSessionByCaseIdDao: (...args: any[]) => mockFindLatestSessionByCaseIdDao(...args),
    checkCaseOwnershipDao: (...args: any[]) => mockCheckCaseOwnershipDao(...args),
}))

// Mock caseType 服务
const mockGetCaseTypeByIdService = vi.fn()
vi.mock('~~/server/services/case/caseType.service', () => ({
    getCaseTypeByIdService: (...args: any[]) => mockGetCaseTypeByIdService(...args),
}))

// Mock caseMaterial 服务
const mockBatchAddCaseMaterialsService = vi.fn()
vi.mock('~~/server/services/case/caseMaterial.service', () => ({
    batchAddCaseMaterialsService: (...args: any[]) => mockBatchAddCaseMaterialsService(...args),
}))

// Mock uuid
vi.mock('uuid', () => ({
    v7: () => 'mock-uuid-v7',
}))

describe('案件服务层单元测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('createCaseService - 创建案件', () => {
        it('应该在案件类型不存在时抛出错误', async () => {
            mockGetCaseTypeByIdService.mockResolvedValue(null)

            const { createCaseService } = await import('~~/server/services/case/case.service')

            await expect(
                createCaseService({
                    caseTypeId: 1,
                    userId: 1,
                } as any)
            ).rejects.toThrow('案件类型不存在')
        })

        it('应该在案件类型已禁用时抛出错误', async () => {
            mockGetCaseTypeByIdService.mockResolvedValue({ id: 1, name: '测试类型', status: 0 })

            const { createCaseService } = await import('~~/server/services/case/case.service')

            await expect(
                createCaseService({
                    caseTypeId: 1,
                    userId: 1,
                } as any)
            ).rejects.toThrow('案件类型已禁用')
        })

        it('应该成功创建案件（含 content 和 materials）', async () => {
            const mockCase = { id: 1, title: '测试案件' }
            const mockSession = { sessionId: 'mock-uuid-v7', caseId: 1 }

            mockGetCaseTypeByIdService.mockResolvedValue({ id: 1, name: '民事案件', status: 1 })
            // 模拟 prisma.$transaction 和 caseMaterials.findMany（被 fire-and-forget 调用）
            ;(prisma as any).caseMaterials = { findMany: vi.fn().mockResolvedValue([]) }
            ;(prisma.$transaction as any).mockImplementation(async (fn: Function) => {
                return fn(prisma)
            })
            mockCreateCaseDao.mockResolvedValue(mockCase)
            mockCreateSessionDao.mockResolvedValue(mockSession)
            mockBatchAddCaseMaterialsService.mockResolvedValue(undefined)

            const { createCaseService } = await import('~~/server/services/case/case.service')

            const result = await createCaseService({
                caseTypeId: 1,
                userId: 1,
                content: '案件描述内容',
                materials: [{ type: CaseMaterialType.DOCUMENT, name: '文件1' }],
            } as any)

            expect(result.caseId).toBe(1)
            expect(result.sessionId).toBe('mock-uuid-v7')
            expect(mockBatchAddCaseMaterialsService).toHaveBeenCalled()
        })

        it('未提供标题时应使用默认标题', async () => {
            const mockCase = { id: 2, title: '待分析的民事案件' }
            const mockSession = { sessionId: 'mock-uuid-v7', caseId: 2 }

            mockGetCaseTypeByIdService.mockResolvedValue({ id: 1, name: '民事案件', status: 1 })
            ;(prisma.$transaction as any).mockImplementation(async (fn: Function) => fn(prisma))
            mockCreateCaseDao.mockResolvedValue(mockCase)
            mockCreateSessionDao.mockResolvedValue(mockSession)

            const { createCaseService } = await import('~~/server/services/case/case.service')

            const result = await createCaseService({
                caseTypeId: 1,
                userId: 1,
            } as any)

            // 验证 createCaseDao 被调用时 title 包含案件类型名称
            expect(mockCreateCaseDao).toHaveBeenCalledWith(
                expect.objectContaining({ title: '待分析的民事案件' }),
                expect.anything(),
            )
            expect(result.caseId).toBe(2)
        })

        it('content 为空字符串时不应创建 CASE_CONTENT 材料', async () => {
            const mockCase = { id: 3, title: '测试' }
            const mockSession = { sessionId: 'mock-uuid-v7', caseId: 3 }

            mockGetCaseTypeByIdService.mockResolvedValue({ id: 1, name: '测试', status: 1 })
            ;(prisma.$transaction as any).mockImplementation(async (fn: Function) => fn(prisma))
            mockCreateCaseDao.mockResolvedValue(mockCase)
            mockCreateSessionDao.mockResolvedValue(mockSession)

            const { createCaseService } = await import('~~/server/services/case/case.service')

            await createCaseService({
                caseTypeId: 1,
                userId: 1,
                content: '   ', // 纯空格
            } as any)

            // 纯空格 content 不应添加材料
            expect(mockBatchAddCaseMaterialsService).not.toHaveBeenCalled()
        })
    })

    describe('getCaseByIdService - 获取案件详情', () => {
        it('应该返回案件详情', async () => {
            const mockCase = { id: 1, title: '测试案件' }
            mockFindCaseByIdDao.mockResolvedValue(mockCase)

            const { getCaseByIdService } = await import('~~/server/services/case/case.service')
            const result = await getCaseByIdService(1)

            expect(result).toEqual(mockCase)
            expect(mockFindCaseByIdDao).toHaveBeenCalledWith(1, true)
        })

        it('案件不存在时应返回 null', async () => {
            mockFindCaseByIdDao.mockResolvedValue(null)

            const { getCaseByIdService } = await import('~~/server/services/case/case.service')
            const result = await getCaseByIdService(999)

            expect(result).toBeNull()
        })
    })

    describe('getCaseBySessionIdService - 通过会话 ID 获取案件', () => {
        it('应该返回案件详情', async () => {
            const mockCase = { id: 1, title: '测试' }
            mockFindCaseBySessionIdDao.mockResolvedValue(mockCase)

            const { getCaseBySessionIdService } = await import('~~/server/services/case/case.service')
            const result = await getCaseBySessionIdService('session-1')

            expect(result).toEqual(mockCase)
        })
    })

    describe('getSessionByIdService - 获取会话详情', () => {
        it('应该返回会话详情', async () => {
            const mockSession = { sessionId: 's1', caseId: 1 }
            mockFindSessionByIdDao.mockResolvedValue(mockSession)

            const { getSessionByIdService } = await import('~~/server/services/case/case.service')
            const result = await getSessionByIdService('s1')

            expect(result).toEqual(mockSession)
        })
    })

    describe('getUserCasesService - 获取用户案件列表', () => {
        it('应该返回案件列表和总数', async () => {
            const mockResult = { list: [{ id: 1 }], total: 1 }
            mockFindManyCasesDao.mockResolvedValue(mockResult)

            const { getUserCasesService } = await import('~~/server/services/case/case.service')
            const result = await getUserCasesService(1, { page: 1, pageSize: 10 })

            expect(result).toEqual(mockResult)
            expect(mockFindManyCasesDao).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 1, page: 1, pageSize: 10 }),
            )
        })
    })

    describe('updateCaseService - 更新案件', () => {
        it('案件不存在时应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue(null)

            const { updateCaseService } = await import('~~/server/services/case/case.service')

            await expect(updateCaseService(999, { title: '新标题' })).rejects.toThrow('案件不存在')
        })

        it('更新案件类型时验证新类型不存在应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue({ id: 1, caseTypeId: 1 })
            mockGetCaseTypeByIdService.mockResolvedValue(null)

            const { updateCaseService } = await import('~~/server/services/case/case.service')

            await expect(updateCaseService(1, { caseTypeId: 2 })).rejects.toThrow('案件类型不存在')
        })

        it('更新案件类型时验证新类型已禁用应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue({ id: 1, caseTypeId: 1 })
            mockGetCaseTypeByIdService.mockResolvedValue({ id: 2, status: 0 })

            const { updateCaseService } = await import('~~/server/services/case/case.service')

            await expect(updateCaseService(1, { caseTypeId: 2 })).rejects.toThrow('案件类型已禁用')
        })

        it('成功更新案件', async () => {
            const updated = { id: 1, title: '新标题' }
            mockFindCaseByIdDao.mockResolvedValue({ id: 1, caseTypeId: 1 })
            mockUpdateCaseDao.mockResolvedValue(updated)

            const { updateCaseService } = await import('~~/server/services/case/case.service')
            const result = await updateCaseService(1, { title: '新标题' })

            expect(result).toEqual(updated)
        })
    })

    describe('updateCaseStatusService - 更新案件状态', () => {
        it('案件不存在时应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue(null)

            const { updateCaseStatusService } = await import('~~/server/services/case/case.service')

            await expect(updateCaseStatusService(999, CaseStatus.COMPLETED)).rejects.toThrow('案件不存在')
        })

        it('成功更新案件状态', async () => {
            const updated = { id: 1, status: CaseStatus.COMPLETED }
            mockFindCaseByIdDao.mockResolvedValue({ id: 1 })
            mockUpdateCaseDao.mockResolvedValue(updated)

            const { updateCaseStatusService } = await import('~~/server/services/case/case.service')
            const result = await updateCaseStatusService(1, CaseStatus.COMPLETED)

            expect(result.status).toBe(CaseStatus.COMPLETED)
        })
    })

    describe('updateSessionStatusService - 更新会话状态', () => {
        it('会话不存在时应抛出错误', async () => {
            mockFindSessionByIdDao.mockResolvedValue(null)

            const { updateSessionStatusService } = await import('~~/server/services/case/case.service')

            await expect(updateSessionStatusService('bad-id', SessionStatus.COMPLETED)).rejects.toThrow('会话不存在')
        })

        it('成功更新会话状态', async () => {
            const updated = { sessionId: 's1', status: SessionStatus.COMPLETED }
            mockFindSessionByIdDao.mockResolvedValue({ sessionId: 's1' })
            mockUpdateSessionStatusDao.mockResolvedValue(updated)

            const { updateSessionStatusService } = await import('~~/server/services/case/case.service')
            const result = await updateSessionStatusService('s1', SessionStatus.COMPLETED)

            expect(result.status).toBe(SessionStatus.COMPLETED)
        })
    })

    describe('deleteCaseService - 删除案件', () => {
        it('案件不存在时应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue(null)

            const { deleteCaseService } = await import('~~/server/services/case/case.service')

            await expect(deleteCaseService(999)).rejects.toThrow('案件不存在')
        })

        it('成功软删除案件', async () => {
            mockFindCaseByIdDao.mockResolvedValue({ id: 1 })
            mockSoftDeleteCaseDao.mockResolvedValue(undefined)

            const { deleteCaseService } = await import('~~/server/services/case/case.service')
            await deleteCaseService(1)

            expect(mockSoftDeleteCaseDao).toHaveBeenCalledWith(1)
        })
    })

    describe('getLatestSessionService - 获取最新会话', () => {
        it('应该返回最新会话', async () => {
            const session = { sessionId: 's1', caseId: 1 }
            mockFindLatestSessionByCaseIdDao.mockResolvedValue(session)

            const { getLatestSessionService } = await import('~~/server/services/case/case.service')
            const result = await getLatestSessionService(1)

            expect(result).toEqual(session)
        })
    })

    describe('createNewSessionService - 创建新会话', () => {
        it('案件不存在时应抛出错误', async () => {
            mockFindCaseByIdDao.mockResolvedValue(null)

            const { createNewSessionService } = await import('~~/server/services/case/case.service')

            await expect(createNewSessionService(999)).rejects.toThrow('案件不存在')
        })

        it('成功创建新会话', async () => {
            const session = { sessionId: 'mock-uuid-v7', caseId: 1 }
            mockFindCaseByIdDao.mockResolvedValue({ id: 1 })
            mockCreateSessionDao.mockResolvedValue(session)

            const { createNewSessionService } = await import('~~/server/services/case/case.service')
            const result = await createNewSessionService(1)

            expect(result.sessionId).toBe('mock-uuid-v7')
        })
    })

    describe('checkCaseOwnershipService - 检查案件所有权', () => {
        it('用户拥有案件时返回 true', async () => {
            mockCheckCaseOwnershipDao.mockResolvedValue(true)

            const { checkCaseOwnershipService } = await import('~~/server/services/case/case.service')
            const result = await checkCaseOwnershipService(1, 1)

            expect(result).toBe(true)
        })

        it('用户不拥有案件时返回 false', async () => {
            mockCheckCaseOwnershipDao.mockResolvedValue(false)

            const { checkCaseOwnershipService } = await import('~~/server/services/case/case.service')
            const result = await checkCaseOwnershipService(1, 2)

            expect(result).toBe(false)
        })
    })

    describe('validateCaseAccessService - 验证案件访问权限', () => {
        it('无权访问时应抛出错误', async () => {
            mockCheckCaseOwnershipDao.mockResolvedValue(false)

            const { validateCaseAccessService } = await import('~~/server/services/case/case.service')

            await expect(validateCaseAccessService(1, 2)).rejects.toThrow('无权访问该案件')
        })

        it('有权限时不抛出错误', async () => {
            mockCheckCaseOwnershipDao.mockResolvedValue(true)

            const { validateCaseAccessService } = await import('~~/server/services/case/case.service')

            await expect(validateCaseAccessService(1, 1)).resolves.toBeUndefined()
        })
    })

    describe('completeCaseAnalysisService - 完成案件分析', () => {
        it('应该在事务中同时更新案件和会话状态', async () => {
            ;(prisma.$transaction as any).mockImplementation(async (fn: Function) => fn(prisma))
            mockUpdateCaseDao.mockResolvedValue({ id: 1 })
            mockUpdateSessionStatusDao.mockResolvedValue({ sessionId: 's1' })

            const { completeCaseAnalysisService } = await import('~~/server/services/case/case.service')
            await completeCaseAnalysisService(1, 's1')

            expect(mockUpdateCaseDao).toHaveBeenCalledWith(
                1,
                { status: CaseStatus.COMPLETED },
                expect.anything(),
            )
            expect(mockUpdateSessionStatusDao).toHaveBeenCalledWith(
                's1',
                SessionStatus.COMPLETED,
                expect.anything(),
            )
        })
    })

    describe('markSessionInterruptedService - 标记会话中断', () => {
        it('应该更新会话状态为中断', async () => {
            const updated = { sessionId: 's1', status: SessionStatus.INTERRUPTED }
            mockUpdateSessionStatusDao.mockResolvedValue(updated)

            const { markSessionInterruptedService } = await import('~~/server/services/case/case.service')
            const result = await markSessionInterruptedService('s1')

            expect(result.status).toBe(SessionStatus.INTERRUPTED)
        })
    })

    describe('markSessionFailedService - 标记会话失败', () => {
        it('应该更新会话状态为失败', async () => {
            const updated = { sessionId: 's1', status: SessionStatus.FAILED }
            mockUpdateSessionStatusDao.mockResolvedValue(updated)

            const { markSessionFailedService } = await import('~~/server/services/case/case.service')
            const result = await markSessionFailedService('s1')

            expect(result.status).toBe(SessionStatus.FAILED)
        })
    })

    describe('resumeSessionService - 恢复会话', () => {
        it('会话不存在时应抛出错误', async () => {
            mockFindSessionByIdDao.mockResolvedValue(null)

            const { resumeSessionService } = await import('~~/server/services/case/case.service')

            await expect(resumeSessionService('bad')).rejects.toThrow('会话不存在')
        })

        it('非中断/失败状态的会话不可恢复', async () => {
            mockFindSessionByIdDao.mockResolvedValue({
                sessionId: 's1',
                status: SessionStatus.COMPLETED,
            })

            const { resumeSessionService } = await import('~~/server/services/case/case.service')

            await expect(resumeSessionService('s1')).rejects.toThrow('只有中断或失败状态的会话可以恢复')
        })

        it('中断状态的会话可以恢复', async () => {
            mockFindSessionByIdDao.mockResolvedValue({
                sessionId: 's1',
                status: SessionStatus.INTERRUPTED,
            })
            mockUpdateSessionStatusDao.mockResolvedValue({
                sessionId: 's1',
                status: SessionStatus.IN_PROGRESS,
            })

            const { resumeSessionService } = await import('~~/server/services/case/case.service')
            const result = await resumeSessionService('s1')

            expect(result.status).toBe(SessionStatus.IN_PROGRESS)
        })

        it('失败状态的会话可以恢复', async () => {
            mockFindSessionByIdDao.mockResolvedValue({
                sessionId: 's1',
                status: SessionStatus.FAILED,
            })
            mockUpdateSessionStatusDao.mockResolvedValue({
                sessionId: 's1',
                status: SessionStatus.IN_PROGRESS,
            })

            const { resumeSessionService } = await import('~~/server/services/case/case.service')
            const result = await resumeSessionService('s1')

            expect(result.status).toBe(SessionStatus.IN_PROGRESS)
        })
    })
})
