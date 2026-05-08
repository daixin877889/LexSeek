/**
 * Session DAO 查询函数测试
 *
 * 使用 vi.fn() mock prisma 和 getActiveRunService，
 * 不依赖真实数据库。
 *
 * **Feature: session-dao**
 * **Validates: validateCaseOwnershipDAO, listSessionsWithActiveRunDAO,
 *              createSessionDAO, softDeleteSessionDAO, renameSessionDAO**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    validateCaseOwnershipDAO,
    listSessionsWithActiveRunDAO,
    createSessionDAO,
    softDeleteSessionDAO,
    renameSessionDAO,
} from '../../../server/services/case/session.dao'

// 创建 mock 函数
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockQueryRaw = vi.fn()
const mockGetActiveRunService = vi.fn()
const mockCancelRunService = vi.fn()
const mockFindSessionIdsWithActiveRun = vi.fn()

// Redis mock
const mockRedis = {
    set: vi.fn(),
}
vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => mockRedis,
}))

// UUID mock
vi.mock('uuid', () => ({
    v4: () => 'mock-uuid-1234',
}))

// agentRun.service mock —— session.dao 通过 ES import 调用 getActiveRunService / cancelRunService
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    getActiveRunService: (...args: any[]) => mockGetActiveRunService(...args),
    cancelRunService: (...args: any[]) => mockCancelRunService(...args),
}))

// agentRun.dao mock —— listSessionsWithActiveRunDAO 用批量版查活跃 run
vi.mock('~~/server/services/agent/agentRun.dao', () => ({
    findSessionIdsWithActiveRunDAO: (...args: any[]) => mockFindSessionIdsWithActiveRun(...args),
}))

// 注入 Nuxt 自动导入的全局变量 mock
;(globalThis as any).prisma = {
    cases: {
        findFirst: mockFindFirst,
    },
    caseSessions: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
        create: mockCreate,
        update: mockUpdate,
    },
    $queryRaw: mockQueryRaw,
}
;(globalThis as any).getActiveRunService = mockGetActiveRunService
;(globalThis as any).cancelRunService = mockCancelRunService
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
        mockFindSessionIdsWithActiveRun.mockResolvedValue(new Set(['session-1']))

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

describe('createSessionDAO', () => {
    const validParams = {
        caseId: 1,
        userId: 100,
        type: 1,
        metadata: { source: 'test' },
    }

    beforeEach(() => {
        vi.clearAllMocks()
        // 重置 prisma mock，caseSessions.findFirst 在 createSessionDAO 中查询最近 session
        ;(globalThis as any).prisma = {
            cases: { findFirst: mockFindFirst },
            caseSessions: {
                findFirst: mockFindFirst,
                findMany: mockFindMany,
                create: mockCreate,
                update: mockUpdate,
            },
            $queryRaw: mockQueryRaw,
        }
    })

    it('无 dedupeKey 时直接创建 session（isNew=true）', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValueOnce(mockCase) // validateCaseOwnership
        mockCreate.mockResolvedValue({ sessionId: 'mock-uuid-1234' })

        const result = await createSessionDAO(validParams)

        expect(result).toEqual({ sessionId: 'mock-uuid-1234', isNew: true })
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    sessionId: 'mock-uuid-1234',
                    caseId: 1,
                    type: 1,
                }),
            }),
        )
    })

    it('有 dedupeKey + 锁获取成功时创建 session（isNew=true）', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValueOnce(mockCase)
        mockRedis.set.mockResolvedValue('OK') // 获取到锁
        mockCreate.mockResolvedValue({ sessionId: 'mock-uuid-1234' })

        const result = await createSessionDAO({ ...validParams, dedupeKey: 'key-abc' })

        expect(mockRedis.set).toHaveBeenCalledWith(
            'session_dedupe:key-abc',
            'locked',
            'PX',
            3000,
            'NX',
        )
        expect(result).toEqual({ sessionId: 'mock-uuid-1234', isNew: true })
    })

    it('有 dedupeKey + 锁已存在时返回最近 session（isNew=false）', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        const existingSession = { sessionId: 'existing-session' }
        mockFindFirst
            .mockResolvedValueOnce(mockCase) // validateCaseOwnership
            .mockResolvedValueOnce(existingSession) // 查最近 session
        mockRedis.set.mockResolvedValue(null) // 未获取到锁

        const result = await createSessionDAO({ ...validParams, dedupeKey: 'key-abc' })

        expect(result).toEqual({ sessionId: 'existing-session', isNew: false })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it('Redis 不可用时降级直接创建 session', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValueOnce(mockCase)
        mockRedis.set.mockRejectedValue(new Error('Redis connection refused'))
        mockCreate.mockResolvedValue({ sessionId: 'mock-uuid-1234' })

        const result = await createSessionDAO({ ...validParams, dedupeKey: 'key-abc' })

        // Redis 异常应降级直接创建 session，而不是抛出异常
        expect(result).toEqual({ sessionId: 'mock-uuid-1234', isNew: true })
        // 确认不是因为防重逻辑而提前返回（create 确实被调用了）
        expect(mockCreate).toHaveBeenCalled()
    })

    it('案件不属于用户时返回 null', async () => {
        mockFindFirst.mockResolvedValueOnce(null) // validateCaseOwnership 返回 null

        const result = await createSessionDAO(validParams)

        expect(result).toBeNull()
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it('自定义 dedupeTtlMs 传入 Redis set 命令', async () => {
        const mockCase = { id: 1, userId: 100, deletedAt: null }
        mockFindFirst.mockResolvedValueOnce(mockCase)
        mockRedis.set.mockResolvedValue('OK')
        mockCreate.mockResolvedValue({ sessionId: 'mock-uuid-1234' })

        await createSessionDAO({ ...validParams, dedupeKey: 'key-abc', dedupeTtlMs: 5000 })

        expect(mockRedis.set).toHaveBeenCalledWith(
            'session_dedupe:key-abc',
            'locked',
            'PX',
            5000,
            'NX',
        )
    })
})

describe('softDeleteSessionDAO', () => {
    const validParams = {
        sessionId: 'session-abc',
        userId: 100,
        allowedTypes: [1, 2],
    }

    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma = {
            cases: { findFirst: mockFindFirst },
            caseSessions: {
                findFirst: mockFindFirst,
                findMany: mockFindMany,
                create: mockCreate,
                update: mockUpdate,
            },
            $queryRaw: mockQueryRaw,
        }
    })

    it('正常软删除 session（success=true）', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 1,
            case: { userId: 100 },
        }
        mockFindFirst.mockResolvedValueOnce(mockSession)
        mockGetActiveRunService.mockResolvedValue(null)
        mockUpdate.mockResolvedValue(mockSession)

        const result = await softDeleteSessionDAO(validParams)

        expect(result).toEqual({ success: true })
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: 'session-abc' },
                data: expect.objectContaining({ deletedAt: expect.any(Date) }),
            }),
        )
    })

    it('有 activeRun 时先取消 run 再软删除', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 1,
            case: { userId: 100 },
        }
        const mockRun = { id: 'run-xyz' }
        mockFindFirst.mockResolvedValueOnce(mockSession)
        mockGetActiveRunService.mockResolvedValue(mockRun)
        mockCancelRunService.mockResolvedValue({ success: true })
        mockUpdate.mockResolvedValue(mockSession)

        const result = await softDeleteSessionDAO(validParams)

        expect(mockCancelRunService).toHaveBeenCalledWith('run-xyz')
        expect(result).toEqual({ success: true })
    })

    it('session 类型不在 allowedTypes 中时返回错误', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 99, // 不在 allowedTypes 中
            case: { userId: 100 },
        }
        mockFindFirst.mockResolvedValueOnce(mockSession)

        const result = await softDeleteSessionDAO(validParams)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('session 不存在时返回错误', async () => {
        mockFindFirst.mockResolvedValueOnce(null)

        const result = await softDeleteSessionDAO(validParams)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('用户无权限时返回错误', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 1,
            case: { userId: 999 }, // 不同的用户
        }
        mockFindFirst.mockResolvedValueOnce(mockSession)

        const result = await softDeleteSessionDAO({ ...validParams, userId: 100 })

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
    })
})

describe('renameSessionDAO', () => {
    const validParams = {
        sessionId: 'session-abc',
        userId: 100,
        newTitle: '新会话名称',
    }

    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma = {
            cases: { findFirst: mockFindFirst },
            caseSessions: {
                findFirst: mockFindFirst,
                findMany: mockFindMany,
                create: mockCreate,
                update: mockUpdate,
            },
            $queryRaw: mockQueryRaw,
        }
    })

    it('正常重命名 session（验证 $queryRaw 调用）', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 1,
            case: { userId: 100 },
        }
        mockFindFirst.mockResolvedValueOnce(mockSession)
        mockQueryRaw.mockResolvedValue([{ session_id: 'session-abc' }])

        const result = await renameSessionDAO(validParams)

        expect(result).toEqual({ success: true })
        expect(mockQueryRaw).toHaveBeenCalled()
    })

    it('session 不存在时返回错误', async () => {
        mockFindFirst.mockResolvedValueOnce(null)

        const result = await renameSessionDAO(validParams)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(mockQueryRaw).not.toHaveBeenCalled()
    })

    it('用户无权限时返回错误', async () => {
        const mockSession = {
            sessionId: 'session-abc',
            type: 1,
            case: { userId: 999 }, // 不同的用户
        }
        mockFindFirst.mockResolvedValueOnce(mockSession)

        const result = await renameSessionDAO(validParams)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(mockQueryRaw).not.toHaveBeenCalled()
    })
})
