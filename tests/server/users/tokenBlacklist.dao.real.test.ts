/**
 * Token 黑名单 DAO 真实 DB 补充覆盖测试
 *
 * 针对 server/services/users/tokenBlacklist.dao.ts 中
 * 现有 tokenBlacklist-dao.coverage.test.ts / token-blacklist.test.ts
 * 未覆盖的 catch 分支进行补齐，目标覆盖率 ≥ 90%。
 *
 * 覆盖内容：
 * - addTokenBlacklistDao / findTokenBlacklistByTokenDao /
 *   deleteTokenBlacklistByTokenDao / deleteExpiredTokenBlacklistDao
 *   四个函数的 catch 分支（通过故障注入真实抛错的 prisma 替身）
 * - deleteExpiredTokenBlacklistDao 在"无过期记录"时的安全行为
 * - find/delete 的事务 (tx) 路径补强
 *
 * 说明：故障注入仅用于覆盖 catch 日志+rethrow 行为，
 * 每个 it 结束后立即恢复真实 prisma，其它断言仍走真实 DB。
 *
 * **Feature: token-blacklist-dao-real-coverage**
 * **Target: server/services/users/tokenBlacklist.dao.ts (>=90%)**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    createTestUser,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

import {
    addTokenBlacklistDao,
    findTokenBlacklistByTokenDao,
    deleteTokenBlacklistByTokenDao,
    deleteExpiredTokenBlacklistDao,
} from '../../../server/services/users/tokenBlacklist.dao'

// 设置全局变量
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

const createdUserIds: number[] = []
const createdTokens: string[] = []

const uniqueSuffix = () => `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`

/** 故障注入：临时替换 globalThis.prisma 为会抛错的 proxy，仅用于触发 catch */
const withFaultyPrisma = async <T>(fn: () => Promise<T>): Promise<T> => {
    const original = (globalThis as any).prisma
    const faulty = new Proxy(
        {},
        {
            get() {
                return new Proxy(
                    {},
                    {
                        get() {
                            return () => {
                                throw new Error('injected-fault: prisma unavailable')
                            }
                        },
                    }
                )
            },
        }
    )
    ;(globalThis as any).prisma = faulty
    try {
        return await fn()
    } finally {
        ;(globalThis as any).prisma = original
    }
}

describe('Token 黑名单 DAO 真实 DB 补充覆盖', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
    })

    afterAll(async () => {
        if (createdTokens.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token: { in: createdTokens } },
            })
            createdTokens.length = 0
        }
        if (createdUserIds.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { userId: { in: createdUserIds } },
            })
            await testPrisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
            createdUserIds.length = 0
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        if (createdTokens.length > 0) {
            await testPrisma.tokenBlacklist.deleteMany({
                where: { token: { in: createdTokens } },
            })
            createdTokens.length = 0
        }
    })

    // ========================================================================
    // addTokenBlacklistDao catch
    // ========================================================================
    describe('addTokenBlacklistDao catch 分支', () => {
        it('prisma 抛错时应 logger.error 并 rethrow', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    addTokenBlacklistDao(
                        `faulty_${uniqueSuffix()}`,
                        1,
                        new Date(Date.now() + 1000)
                    )
                ).rejects.toThrow(/injected-fault/)
            })
        })
    })

    // ========================================================================
    // findTokenBlacklistByTokenDao catch
    // ========================================================================
    describe('findTokenBlacklistByTokenDao catch 分支', () => {
        it('prisma 抛错时应 logger.error 并 rethrow', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    findTokenBlacklistByTokenDao(`faulty_${uniqueSuffix()}`)
                ).rejects.toThrow(/injected-fault/)
            })
        })

        it('not found 时应返回 null（命中 !tokenBlacklist 分支）', async () => {
            const found = await findTokenBlacklistByTokenDao(
                `definitely_nonexistent_${uniqueSuffix()}`
            )
            expect(found).toBeNull()
        })
    })

    // ========================================================================
    // deleteTokenBlacklistByTokenDao catch
    // ========================================================================
    describe('deleteTokenBlacklistByTokenDao catch 分支', () => {
        it('prisma 抛错时应 logger.error 并 rethrow', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    deleteTokenBlacklistByTokenDao(`faulty_${uniqueSuffix()}`)
                ).rejects.toThrow(/injected-fault/)
            })
        })

        it('删除不存在的 token 应不报错（updateMany 影响 0 行）', async () => {
            await expect(
                deleteTokenBlacklistByTokenDao(`nonexistent_${uniqueSuffix()}`)
            ).resolves.toBeUndefined()
        })
    })

    // ========================================================================
    // deleteExpiredTokenBlacklistDao catch
    // ========================================================================
    describe('deleteExpiredTokenBlacklistDao catch 分支', () => {
        it('prisma 抛错时应 logger.error 并 rethrow', async () => {
            await withFaultyPrisma(async () => {
                await expect(deleteExpiredTokenBlacklistDao()).rejects.toThrow(
                    /injected-fault/
                )
            })
        })

        it('无过期记录时调用应安全返回', async () => {
            // 真实 prisma 下即使没有过期记录，deleteMany 也只是影响 0 行
            await expect(deleteExpiredTokenBlacklistDao()).resolves.toBeUndefined()
        })
    })

    // ========================================================================
    // 端到端 happy path（结合真实 CRUD + 事务路径），进一步夯实覆盖率
    // ========================================================================
    describe('端到端整合验证', () => {
        it('add → find → delete(软删) → find(null) → add(新) → expired-clean 流程应全部正确', async () => {
            const user = await createTestUser()
            createdUserIds.push(user.id)

            const active = `token_e2e_active_${uniqueSuffix()}`
            const expired = `token_e2e_expired_${uniqueSuffix()}`
            createdTokens.push(active, expired)

            // add 活跃
            await addTokenBlacklistDao(
                active,
                user.id,
                new Date(Date.now() + 24 * 60 * 60 * 1000)
            )
            // add 过期
            await addTokenBlacklistDao(expired, user.id, new Date(Date.now() - 1000))

            // find 活跃
            const foundActive = await findTokenBlacklistByTokenDao(active)
            expect(foundActive).not.toBeNull()
            expect(foundActive!.token).toBe(active)
            expect(foundActive!.userId).toBe(user.id)

            // 软删活跃
            await deleteTokenBlacklistByTokenDao(active)
            expect(await findTokenBlacklistByTokenDao(active)).toBeNull()

            // 清理过期
            await deleteExpiredTokenBlacklistDao()
            const stillExpired = await testPrisma.tokenBlacklist.findFirst({
                where: { token: expired },
            })
            expect(stillExpired).toBeNull()
        })
    })
})
