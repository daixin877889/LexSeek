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
    findMineruTokenByNameDao: vi.fn(),
    findManyMineruTokensDao: vi.fn(),
    findActiveTokenDao: vi.fn(),
    updateMineruTokenDao: vi.fn(),
    softDeleteMineruTokenDao: vi.fn(),
}))

import {
    createMineruTokenService,
    getMineruTokenByIdService,
    getMineruTokensService,
    getActiveTokenService,
    getActiveTokenValueService,
    updateMineruTokenService,
    toggleMineruTokenStatusService,
    deleteMineruTokenService,
    hasActiveTokenService,
    MineruTokenStatus,
} from '~~/server/services/material/mineruToken.service'

import {
    createMineruTokenDao,
    findMineruTokenByIdDao,
    findMineruTokenByNameDao,
    findManyMineruTokensDao,
    findActiveTokenDao,
    updateMineruTokenDao,
    softDeleteMineruTokenDao,
} from '~~/server/services/material/mineruToken.dao'

const baseMockToken = {
    id: 1,
    name: 'Test Token',
    token: 'abcd1234efgh5678',
    remark: '测试用 Token',
    status: MineruTokenStatus.ENABLED,
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
