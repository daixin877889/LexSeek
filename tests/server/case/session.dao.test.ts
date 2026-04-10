/**
 * Session DAO 查询函数测试
 *
 * 使用 vi.fn() mock prisma 和 getActiveRunService，
 * 不依赖真实数据库。
 *
 * **Feature: session-dao**
 * **Validates: validateCaseOwnershipDAO, listSessionsWithActiveRunDAO**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    validateCaseOwnershipDAO,
    listSessionsWithActiveRunDAO,
} from '../../../server/services/case/session.dao'

// 创建 mock 函数
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockGetActiveRunService = vi.fn()

// 注入 Nuxt 自动导入的全局变量 mock
;(globalThis as any).prisma = {
    cases: {
        findFirst: mockFindFirst,
    },
    caseSessions: {
        findMany: mockFindMany,
    },
}
;(globalThis as any).getActiveRunService = mockGetActiveRunService
;(globalThis as any).logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}

describe('validateCaseOwnershipDAO', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('案件属于用户时返回案件记录', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null, title: '测试案件' }
        mockFindFirst.mockResolvedValue(mockCase)

        const result = await validateCaseOwnershipDAO(1, 100)

        expect(mockFindFirst).toHaveBeenCalledWith({
            where: { id: 1, userId: 100, deletedAt: null },
        })
        expect(result).toEqual(mockCase)
    })

    it('案件不属于用户时返回 null', async () => {
        mockFindFirst.mockResolvedValue(null)

        const result = await validateCaseOwnershipDAO(1, 999)

        expect(mockFindFirst).toHaveBeenCalledWith({
            where: { id: 1, userId: 999, deletedAt: null },
        })
        expect(result).toBeNull()
    })
})

describe('listSessionsWithActiveRunDAO', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('案件不属于用户时返回 null', async () => {
        mockFindFirst.mockResolvedValue(null)

        const result = await listSessionsWithActiveRunDAO({
            caseId: 1,
            userId: 999,
            type: 1,
        })

        expect(result).toBeNull()
        expect(mockFindMany).not.toHaveBeenCalled()
    })

    it('返回 session 列表并附带 hasActiveRun 标记', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValue(mockCase)

        const now = new Date()
        const mockSessions = [
            {
                sessionId: 'session-1',
                type: 1,
                metadata: { source: 'xiaosuo' },
                createdAt: now,
                updatedAt: now,
            },
            {
                sessionId: 'session-2',
                type: 1,
                metadata: { source: 'module' },
                createdAt: now,
                updatedAt: now,
            },
        ]
        mockFindMany.mockResolvedValue(mockSessions)

        // session-1 有活跃 run，session-2 没有
        mockGetActiveRunService
            .mockResolvedValueOnce({ runId: 'run-abc' })
            .mockResolvedValueOnce(null)

        const result = await listSessionsWithActiveRunDAO({
            caseId: 1,
            userId: 100,
            type: 1,
        })

        expect(result).not.toBeNull()
        expect(result).toHaveLength(2)
        expect(result![0]).toMatchObject({
            sessionId: 'session-1',
            type: 1,
            hasActiveRun: true,
        })
        expect(result![1]).toMatchObject({
            sessionId: 'session-2',
            type: 1,
            hasActiveRun: false,
        })
    })

    it('支持 metadataFilter 过滤（where 条件中包含 metadata filter）', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValue(mockCase)
        mockFindMany.mockResolvedValue([])

        const metadataFilter = { path: ['source'], equals: 'xiaosuo' }

        await listSessionsWithActiveRunDAO({
            caseId: 1,
            userId: 100,
            type: 1,
            metadataFilter,
        })

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    metadata: metadataFilter,
                }),
            }),
        )
    })

    it('支持 orderBy 参数', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValue(mockCase)
        mockFindMany.mockResolvedValue([])

        const orderBy = { createdAt: 'asc' as const }

        await listSessionsWithActiveRunDAO({
            caseId: 1,
            userId: 100,
            type: 1,
            orderBy,
        })

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy,
            }),
        )
    })

    it('不传 orderBy 时默认按 updatedAt desc 排序', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValue(mockCase)
        mockFindMany.mockResolvedValue([])

        await listSessionsWithActiveRunDAO({
            caseId: 1,
            userId: 100,
            type: 1,
        })

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: { updatedAt: 'desc' },
            }),
        )
    })
})
