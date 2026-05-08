/**
 * MinerU Token 服务层测试
 *
 * **Feature: mineru-token-service**
 * **Validates: Requirements 3.1.1.1-3.1.1.7**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

// Mock DAO 层
vi.mock('~~/server/services/material/mineruToken.dao', () => ({
    createMineruTokenDao: vi.fn(),
    findMineruTokenByIdDao: vi.fn(),
    findMineruTokenByIdRawDao: vi.fn(),
    findMineruTokenByNameDao: vi.fn(),
    findManyMineruTokensDao: vi.fn(),
    findActiveTokenDao: vi.fn(),
    pickLeastRecentlyUsedActiveTokenDao: vi.fn(),
    updateMineruTokenDao: vi.fn(),
    softDeleteMineruTokenDao: vi.fn(),
}))

import {
    createMineruTokenService,
    getMineruTokenByIdService,
    getMineruTokensService,
    getActiveTokenService,
    getActiveTokenValueService,
    getTokenByIdService,
    pickTokenForNewTaskService,
    updateMineruTokenService,
    toggleMineruTokenStatusService,
    deleteMineruTokenService,
    hasActiveTokenService,
    MineruTokenStatus,
} from '~~/server/services/material/mineruToken.service'

import {
    createMineruTokenDao,
    findMineruTokenByIdDao,
    findMineruTokenByIdRawDao,
    findMineruTokenByNameDao,
    findManyMineruTokensDao,
    findActiveTokenDao,
    pickLeastRecentlyUsedActiveTokenDao,
    updateMineruTokenDao,
    softDeleteMineruTokenDao,
} from '~~/server/services/material/mineruToken.dao'

const baseMockToken = {
    id: 1,
    name: 'Test Token',
    token: 'abcd1234efgh5678',
    remark: '测试用 Token',
    status: MineruTokenStatus.ENABLED,
    expiresAt: null as Date | null,
    lastUsedAt: null as Date | null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
}

describe('MinerU Token 服务层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== createMineruTokenService ====================
    describe('createMineruTokenService', () => {
        it('应创建 Token 并返回脱敏结果', async () => {
            vi.mocked(findMineruTokenByNameDao).mockResolvedValue(null)
            vi.mocked(createMineruTokenDao).mockResolvedValue(baseMockToken as any)

            const result = await createMineruTokenService({
                name: 'Test Token',
                token: 'abcd1234efgh5678',
            })

            expect(result.tokenMasked).toBe('abcd****5678')
            expect((result as any).token).toBeUndefined()
        })

        it('名称已存在时应抛出错误', async () => {
            vi.mocked(findMineruTokenByNameDao).mockResolvedValue(baseMockToken as any)

            await expect(
                createMineruTokenService({ name: 'Test Token', token: 'new-token' }),
            ).rejects.toThrow('Token 名称已存在')
        })
    })

    // ==================== getMineruTokenByIdService ====================
    describe('getMineruTokenByIdService', () => {
        it('应返回脱敏的 Token', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)

            const result = await getMineruTokenByIdService(1)

            expect(result).not.toBeNull()
            expect(result!.tokenMasked).toBe('abcd****5678')
        })

        it('Token 不存在时应返回 null', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(null)
            expect(await getMineruTokenByIdService(999)).toBeNull()
        })
    })

    // ==================== getMineruTokensService ====================
    describe('getMineruTokensService', () => {
        it('应返回脱敏的 Token 列表', async () => {
            vi.mocked(findManyMineruTokensDao).mockResolvedValue({
                list: [baseMockToken as any],
                total: 1,
            })

            const result = await getMineruTokensService()

            expect(result.total).toBe(1)
            expect(result.list[0]!.tokenMasked).toBe('abcd****5678')
        })

        it('空列表应返回空数组', async () => {
            vi.mocked(findManyMineruTokensDao).mockResolvedValue({ list: [], total: 0 })

            const result = await getMineruTokensService()
            expect(result.list).toEqual([])
            expect(result.total).toBe(0)
        })
    })

    // ==================== getActiveTokenService ====================
    describe('getActiveTokenService', () => {
        it('应返回完整 Token', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(baseMockToken as any)

            const result = await getActiveTokenService()
            expect(result).toEqual(baseMockToken)
        })

        it('无启用 Token 时应返回 null', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(null)
            expect(await getActiveTokenService()).toBeNull()
        })
    })

    // ==================== getActiveTokenValueService ====================
    describe('getActiveTokenValueService', () => {
        it('应返回 Token 值', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(baseMockToken as any)

            const result = await getActiveTokenValueService()
            expect(result).toBe('abcd1234efgh5678')
        })

        it('无启用 Token 时应返回 null', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(null)
            expect(await getActiveTokenValueService()).toBeNull()
        })
    })

    // ==================== getTokenByIdService ====================
    describe('getTokenByIdService', () => {
        it('应返回完整 token 字符串（不过滤启用状态 / 过期）', async () => {
            const disabledToken = { ...baseMockToken, status: MineruTokenStatus.DISABLED }
            vi.mocked(findMineruTokenByIdRawDao).mockResolvedValue(disabledToken as any)

            const value = await getTokenByIdService(123)
            expect(value).toBe('abcd1234efgh5678')
            expect(findMineruTokenByIdRawDao).toHaveBeenCalledWith(123)
        })

        it('token 不存在或已物理删除时应返回 null', async () => {
            vi.mocked(findMineruTokenByIdRawDao).mockResolvedValue(null)
            expect(await getTokenByIdService(999)).toBeNull()
        })
    })

    // ==================== pickTokenForNewTaskService ====================
    describe('pickTokenForNewTaskService', () => {
        it('应返回 LRU 选中 token 的 id 与 token 值', async () => {
            vi.mocked(pickLeastRecentlyUsedActiveTokenDao).mockResolvedValue({
                ...baseMockToken,
                id: 7,
                token: 'sk-picked',
            } as any)

            const result = await pickTokenForNewTaskService()

            expect(result).toEqual({ id: 7, token: 'sk-picked' })
            expect(pickLeastRecentlyUsedActiveTokenDao).toHaveBeenCalledTimes(1)
        })

        it('没有可用 token 时应返回 null', async () => {
            vi.mocked(pickLeastRecentlyUsedActiveTokenDao).mockResolvedValue(null)
            expect(await pickTokenForNewTaskService()).toBeNull()
        })
    })

    // ==================== getTokenForExistingTaskService ====================
    describe('getTokenForExistingTaskService', () => {
        beforeEach(() => {
            vi.clearAllMocks()
        })

        it('task 绑定了有效 token 时应返回该 token', async () => {
            const { getTokenForExistingTaskService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(findMineruTokenByIdRawDao).mockResolvedValue({ ...baseMockToken, id: 42, token: 'sk-bound' } as any)

            const value = await getTokenForExistingTaskService({ id: 1, mineruTokenId: 42 })

            expect(findMineruTokenByIdRawDao).toHaveBeenCalledWith(42)
            expect(findActiveTokenDao).not.toHaveBeenCalled()
            expect(value).toBe('sk-bound')
        })

        it('task 未绑定 token（旧任务）应回退到 active token', async () => {
            const { getTokenForExistingTaskService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(findActiveTokenDao).mockResolvedValue({ ...baseMockToken, token: 'sk-fallback' } as any)

            const value = await getTokenForExistingTaskService({ id: 1, mineruTokenId: null })

            expect(findMineruTokenByIdRawDao).not.toHaveBeenCalled()
            expect(findActiveTokenDao).toHaveBeenCalledTimes(1)
            expect(value).toBe('sk-fallback')
        })

        it('task 绑定的 token 已被物理删除时应回退到 active token', async () => {
            const { getTokenForExistingTaskService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(findMineruTokenByIdRawDao).mockResolvedValue(null)
            vi.mocked(findActiveTokenDao).mockResolvedValue({ ...baseMockToken, token: 'sk-fallback' } as any)

            const value = await getTokenForExistingTaskService({ id: 1, mineruTokenId: 99 })

            expect(findMineruTokenByIdRawDao).toHaveBeenCalledWith(99)
            expect(findActiveTokenDao).toHaveBeenCalledTimes(1)
            expect(value).toBe('sk-fallback')
        })

        it('无任何可用 token 时应返回 null', async () => {
            const { getTokenForExistingTaskService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(findMineruTokenByIdRawDao).mockResolvedValue(null)
            vi.mocked(findActiveTokenDao).mockResolvedValue(null)

            const value = await getTokenForExistingTaskService({ id: 1, mineruTokenId: 99 })

            expect(value).toBeNull()
        })
    })

    // ==================== updateMineruTokenService ====================
    describe('updateMineruTokenService', () => {
        it('应更新 Token 并返回脱敏结果', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)
            vi.mocked(updateMineruTokenDao).mockResolvedValue({
                ...baseMockToken,
                remark: '更新备注',
            } as any)

            const result = await updateMineruTokenService(1, { remark: '更新备注' })
            expect(result.tokenMasked).toBe('abcd****5678')
        })

        it('Token 不存在时应抛出错误', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(null)

            await expect(updateMineruTokenService(999, { remark: 'x' })).rejects.toThrow('Token 不存在')
        })

        it('更新名称时如名称已存在应抛出错误', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)
            vi.mocked(findMineruTokenByNameDao).mockResolvedValue({ ...baseMockToken, id: 2 } as any)

            await expect(
                updateMineruTokenService(1, { name: 'Existing Name' }),
            ).rejects.toThrow('Token 名称已存在')
        })

        it('名称未变时不应检查重复', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)
            vi.mocked(updateMineruTokenDao).mockResolvedValue(baseMockToken as any)

            await updateMineruTokenService(1, { name: 'Test Token' })

            expect(findMineruTokenByNameDao).not.toHaveBeenCalled()
        })
    })

    // ==================== toggleMineruTokenStatusService ====================
    describe('toggleMineruTokenStatusService', () => {
        it('启用状态应切换为禁用', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)
            vi.mocked(updateMineruTokenDao).mockResolvedValue({
                ...baseMockToken,
                status: MineruTokenStatus.DISABLED,
            } as any)

            const result = await toggleMineruTokenStatusService(1)

            expect(updateMineruTokenDao).toHaveBeenCalledWith(1, { status: MineruTokenStatus.DISABLED })
        })

        it('禁用状态应切换为启用', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue({
                ...baseMockToken,
                status: MineruTokenStatus.DISABLED,
            } as any)
            vi.mocked(updateMineruTokenDao).mockResolvedValue({
                ...baseMockToken,
                status: MineruTokenStatus.ENABLED,
            } as any)

            await toggleMineruTokenStatusService(1)

            expect(updateMineruTokenDao).toHaveBeenCalledWith(1, { status: MineruTokenStatus.ENABLED })
        })

        it('Token 不存在时应抛出错误', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(null)
            await expect(toggleMineruTokenStatusService(999)).rejects.toThrow('Token 不存在')
        })
    })

    // ==================== deleteMineruTokenService ====================
    describe('deleteMineruTokenService', () => {
        it('应软删除 Token', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(baseMockToken as any)
            vi.mocked(softDeleteMineruTokenDao).mockResolvedValue(undefined)

            await deleteMineruTokenService(1)

            expect(softDeleteMineruTokenDao).toHaveBeenCalledWith(1)
        })

        it('Token 不存在时应抛出错误', async () => {
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(null)
            await expect(deleteMineruTokenService(999)).rejects.toThrow('Token 不存在')
        })
    })

    // ==================== hasActiveTokenService ====================
    describe('hasActiveTokenService', () => {
        it('有启用 Token 时应返回 true', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(baseMockToken as any)
            expect(await hasActiveTokenService()).toBe(true)
        })

        it('无启用 Token 时应返回 false', async () => {
            vi.mocked(findActiveTokenDao).mockResolvedValue(null)
            expect(await hasActiveTokenService()).toBe(false)
        })
    })

    // ==================== Token 脱敏测试 ====================
    describe('Token 脱敏', () => {
        it('短 Token 应显示 ****', async () => {
            const shortToken = { ...baseMockToken, token: '1234' }
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(shortToken as any)

            const result = await getMineruTokenByIdService(1)
            expect(result!.tokenMasked).toBe('****')
        })

        it('空 Token 应显示 ****', async () => {
            const emptyToken = { ...baseMockToken, token: '' }
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(emptyToken as any)

            const result = await getMineruTokenByIdService(1)
            expect(result!.tokenMasked).toBe('****')
        })

        it('正常长度 Token 应显示前4后4', async () => {
            const normalToken = { ...baseMockToken, token: 'abcdefghijklmnop' }
            vi.mocked(findMineruTokenByIdDao).mockResolvedValue(normalToken as any)

            const result = await getMineruTokenByIdService(1)
            expect(result!.tokenMasked).toBe('abcd****mnop')
        })
    })
})
