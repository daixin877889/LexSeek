/**
 * MinerU Token DAO 层测试
 *
 * 测试 mineruToken.dao.ts 中所有 DAO 方法
 *
 * **Feature: mineru-token-dao**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    disconnectTestDb,
    isTestDbAvailable,
} from '../membership/test-db-helper'
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
} from '../../../server/services/material/mineruToken.dao'
import { MineruTokenStatus } from '../../../server/services/material/mineruToken.service'

// 设置全局变量
const mockLogger = {
    info: (...args: any[]) => {},
    warn: (...args: any[]) => {},
    error: (...args: any[]) => {},
    debug: (...args: any[]) => {},
}
    ; (globalThis as any).logger = mockLogger

let dbAvailable = false
const prisma = getTestPrisma()

// 追踪创建的 token IDs
const createdTokenIds: number[] = []

describe('MinerU Token DAO 测试', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理测试数据
            for (const id of createdTokenIds) {
                try {
                    await prisma.mineruTokens.delete({ where: { id } })
                } catch {
                    // ignore
                }
            }
            createdTokenIds.length = 0
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    describe('createMineruTokenDao', () => {
        it('应成功创建 MinerU Token', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `测试Token_${Date.now()}`,
                token: 'sk-test-token-12345',
                remark: '测试备注',
                status: MineruTokenStatus.ENABLED,
            })
            createdTokenIds.push(token.id)

            expect(token.id).toBeGreaterThan(0)
            expect(token.name).toContain('测试Token_')
            expect(token.token).toBe('sk-test-token-12345')
            expect(token.status).toBe(MineruTokenStatus.ENABLED)
        })

        it('应默认启用状态', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `测试Token_默认状态_${Date.now()}`,
                token: 'sk-test-token-default',
            })
            createdTokenIds.push(token.id)

            expect(token.status).toBe(MineruTokenStatus.ENABLED)
        })
    })

    describe('findMineruTokenByIdDao', () => {
        it('应返回存在的 Token', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `findById_${Date.now()}`,
                token: 'sk-find-by-id',
            })
            createdTokenIds.push(token.id)

            const found = await findMineruTokenByIdDao(token.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(token.id)
            expect(found!.name).toBe(token.name)
        })

        it('不存在 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findMineruTokenByIdDao(999999999)
            expect(found).toBeNull()
        })
    })

    describe('findMineruTokenByNameDao', () => {
        it('应返回存在的 Token', async () => {
            if (!dbAvailable) return

            const name = `findByName_${Date.now()}`
            const token = await createMineruTokenDao({
                name,
                token: 'sk-find-by-name',
            })
            createdTokenIds.push(token.id)

            const found = await findMineruTokenByNameDao(name)

            expect(found).not.toBeNull()
            expect(found!.name).toBe(name)
        })

        it('不存在名称应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findMineruTokenByNameDao('non-existent-token-name-xyz')
            expect(found).toBeNull()
        })
    })

    describe('findManyMineruTokensDao', () => {
        it('应返回分页 Token 列表', async () => {
            if (!dbAvailable) return

            const token1 = await createMineruTokenDao({
                name: `分页测试1_${Date.now()}`,
                token: 'sk-page-1',
            })
            const token2 = await createMineruTokenDao({
                name: `分页测试2_${Date.now()}`,
                token: 'sk-page-2',
            })
            createdTokenIds.push(token1.id, token2.id)

            const result = await findManyMineruTokensDao({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(2)
        })

        it('分页参数应生效', async () => {
            if (!dbAvailable) return

            const result = await findManyMineruTokensDao({ page: 1, pageSize: 2 })
            expect(result.list.length).toBeLessThanOrEqual(2)
        })

        it('按状态筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const enabled = await createMineruTokenDao({
                name: `enabled_${Date.now()}`,
                token: 'sk-enabled',
                status: MineruTokenStatus.ENABLED,
            })
            const disabled = await createMineruTokenDao({
                name: `disabled_${Date.now()}`,
                token: 'sk-disabled',
                status: MineruTokenStatus.DISABLED,
            })
            createdTokenIds.push(enabled.id, disabled.id)

            const result = await findManyMineruTokensDao({ status: MineruTokenStatus.ENABLED })

            const found = result.list.find(t => t.id === enabled.id)
            const disabledFound = result.list.find(t => t.id === disabled.id)
            expect(found).not.toBeUndefined()
            expect(disabledFound).toBeUndefined()
        })
    })

    describe('findActiveTokenDao', () => {
        it('应返回启用的 Token', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `active_${Date.now()}`,
                token: 'sk-active',
                status: MineruTokenStatus.ENABLED,
            })
            createdTokenIds.push(token.id)

            const found = await findActiveTokenDao()

            expect(found).not.toBeNull()
            expect(found!.id).toBe(token.id)
        })

        it('已过期的 Token 不应被视为可用', async () => {
            if (!dbAvailable) return

            // 先把所有现存启用 token 临时禁用，避免被前面用例污染
            await prisma.mineruTokens.updateMany({
                where: { deletedAt: null, status: MineruTokenStatus.ENABLED },
                data: { status: MineruTokenStatus.DISABLED },
            })

            const expiredToken = await createMineruTokenDao({
                name: `expired_${Date.now()}`,
                token: 'sk-expired',
                status: MineruTokenStatus.ENABLED,
                expiresAt: new Date(Date.now() - 60 * 1000), // 1 分钟前已过期
            })
            createdTokenIds.push(expiredToken.id)

            const found = await findActiveTokenDao()

            expect(found).toBeNull()
        })

        it('未过期的 Token 应被视为可用', async () => {
            if (!dbAvailable) return

            await prisma.mineruTokens.updateMany({
                where: { deletedAt: null, status: MineruTokenStatus.ENABLED },
                data: { status: MineruTokenStatus.DISABLED },
            })

            const validToken = await createMineruTokenDao({
                name: `valid_expires_${Date.now()}`,
                token: 'sk-valid-expires',
                status: MineruTokenStatus.ENABLED,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h 后才过期
            })
            createdTokenIds.push(validToken.id)

            const found = await findActiveTokenDao()

            expect(found).not.toBeNull()
            expect(found!.id).toBe(validToken.id)
        })
    })

    describe('findMineruTokenByIdRawDao', () => {
        it('应返回任意状态的未删除 Token（包含禁用 / 过期）', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `raw_disabled_${Date.now()}`,
                token: 'sk-raw-disabled',
                status: MineruTokenStatus.DISABLED,
                expiresAt: new Date(Date.now() - 60 * 1000),
            })
            createdTokenIds.push(token.id)

            const found = await findMineruTokenByIdRawDao(token.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(token.id)
            expect(found!.token).toBe('sk-raw-disabled')
        })

        it('已软删除的 Token 应返回 null', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `raw_deleted_${Date.now()}`,
                token: 'sk-raw-deleted',
            })
            await softDeleteMineruTokenDao(token.id)
            createdTokenIds.push(token.id)

            const found = await findMineruTokenByIdRawDao(token.id)

            expect(found).toBeNull()
        })
    })

    describe('pickLeastRecentlyUsedActiveTokenDao', () => {
        // 隔离测试：先把数据库中所有启用 token 临时禁用，本组测试结束再恢复
        const disabledIdsForLruTests: number[] = []

        const disablePreExistingActiveTokens = async () => {
            const list = await prisma.mineruTokens.findMany({
                where: { deletedAt: null, status: MineruTokenStatus.ENABLED },
                select: { id: true },
            })
            disabledIdsForLruTests.push(...list.map(t => t.id))
            if (disabledIdsForLruTests.length) {
                await prisma.mineruTokens.updateMany({
                    where: { id: { in: disabledIdsForLruTests } },
                    data: { status: MineruTokenStatus.DISABLED },
                })
            }
        }

        const restorePreExistingActiveTokens = async () => {
            if (disabledIdsForLruTests.length) {
                await prisma.mineruTokens.updateMany({
                    where: { id: { in: disabledIdsForLruTests } },
                    data: { status: MineruTokenStatus.ENABLED },
                })
                disabledIdsForLruTests.length = 0
            }
        }

        afterEach(async () => {
            if (dbAvailable) {
                await restorePreExistingActiveTokens()
            }
        })

        it('多个启用 token 时应优先返回 lastUsedAt 最早的（NULL 视为最早）', async () => {
            if (!dbAvailable) return
            await disablePreExistingActiveTokens()

            const tokenNeverUsed = await createMineruTokenDao({
                name: `lru_never_used_${Date.now()}`,
                token: 'sk-lru-never',
            })
            const tokenUsedAgo = await createMineruTokenDao({
                name: `lru_used_ago_${Date.now()}`,
                token: 'sk-lru-ago',
            })
            const tokenUsedRecently = await createMineruTokenDao({
                name: `lru_used_recent_${Date.now()}`,
                token: 'sk-lru-recent',
            })
            createdTokenIds.push(tokenNeverUsed.id, tokenUsedAgo.id, tokenUsedRecently.id)

            await prisma.mineruTokens.update({
                where: { id: tokenUsedAgo.id },
                data: { lastUsedAt: new Date(Date.now() - 60 * 60 * 1000) }, // 1h 前
            })
            await prisma.mineruTokens.update({
                where: { id: tokenUsedRecently.id },
                data: { lastUsedAt: new Date() }, // 现在
            })

            const picked = await pickLeastRecentlyUsedActiveTokenDao()

            expect(picked).not.toBeNull()
            expect(picked!.id).toBe(tokenNeverUsed.id)
            expect(picked!.lastUsedAt).not.toBeNull()
            expect(picked!.lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 5_000)
        })

        it('应排除禁用 / 已过期 / 已软删除的 token', async () => {
            if (!dbAvailable) return
            await disablePreExistingActiveTokens()

            const disabled = await createMineruTokenDao({
                name: `lru_disabled_${Date.now()}`,
                token: 'sk-lru-disabled',
                status: MineruTokenStatus.DISABLED,
            })
            const expired = await createMineruTokenDao({
                name: `lru_expired_${Date.now()}`,
                token: 'sk-lru-expired',
                status: MineruTokenStatus.ENABLED,
                expiresAt: new Date(Date.now() - 60 * 1000),
            })
            const deleted = await createMineruTokenDao({
                name: `lru_deleted_${Date.now()}`,
                token: 'sk-lru-deleted',
                status: MineruTokenStatus.ENABLED,
            })
            await softDeleteMineruTokenDao(deleted.id)
            const valid = await createMineruTokenDao({
                name: `lru_valid_${Date.now()}`,
                token: 'sk-lru-valid',
                status: MineruTokenStatus.ENABLED,
            })
            createdTokenIds.push(disabled.id, expired.id, deleted.id, valid.id)

            const picked = await pickLeastRecentlyUsedActiveTokenDao()

            expect(picked).not.toBeNull()
            expect(picked!.id).toBe(valid.id)
        })

        it('连续调用应在多个可用 token 之间轮换（LRU 负载均衡）', async () => {
            if (!dbAvailable) return
            await disablePreExistingActiveTokens()

            const t1 = await createMineruTokenDao({
                name: `lru_rr_a_${Date.now()}`,
                token: 'sk-lru-rr-a',
            })
            const t2 = await createMineruTokenDao({
                name: `lru_rr_b_${Date.now()}`,
                token: 'sk-lru-rr-b',
            })
            createdTokenIds.push(t1.id, t2.id)

            // createdAt 上 t1 早于 t2，且都没用过；首次按 createdAt asc 应选 t1
            const first = await pickLeastRecentlyUsedActiveTokenDao()
            // 第二次：t1 刚被用过，t2 仍未用过 → 应选 t2
            const second = await pickLeastRecentlyUsedActiveTokenDao()
            // 第三次：t2 用过；t1.lastUsedAt 早于 t2 → 应选 t1
            const third = await pickLeastRecentlyUsedActiveTokenDao()

            expect(first!.id).toBe(t1.id)
            expect(second!.id).toBe(t2.id)
            expect(third!.id).toBe(t1.id)
        })

        it('没有可用 token 时应返回 null', async () => {
            if (!dbAvailable) return
            await disablePreExistingActiveTokens()

            const picked = await pickLeastRecentlyUsedActiveTokenDao()
            expect(picked).toBeNull()
        })
    })

    describe('updateMineruTokenDao', () => {
        it('应成功更新 Token 名称', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `update_test_${Date.now()}`,
                token: 'sk-update-test',
            })
            createdTokenIds.push(token.id)

            const updated = await updateMineruTokenDao(token.id, {
                name: '更新后的名称',
            })

            expect(updated.name).toBe('更新后的名称')
        })

        it('应成功更新 Token 状态', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `update_status_${Date.now()}`,
                token: 'sk-update-status',
                status: MineruTokenStatus.ENABLED,
            })
            createdTokenIds.push(token.id)

            const updated = await updateMineruTokenDao(token.id, {
                status: MineruTokenStatus.DISABLED,
            })

            expect(updated.status).toBe(MineruTokenStatus.DISABLED)
        })
    })

    describe('softDeleteMineruTokenDao', () => {
        it('应成功软删除 Token', async () => {
            if (!dbAvailable) return

            const token = await createMineruTokenDao({
                name: `delete_test_${Date.now()}`,
                token: 'sk-delete-test',
            })

            await softDeleteMineruTokenDao(token.id)

            // 验证软删除（deletedAt 被设置）
            const found = await prisma.mineruTokens.findUnique({
                where: { id: token.id },
            })
            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('不存在 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(softDeleteMineruTokenDao(999999999)).rejects.toThrow()
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
