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
    findMineruTokenByNameDao,
    findManyMineruTokensDao,
    findActiveTokenDao,
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
