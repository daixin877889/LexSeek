/**
 * checkpointer 单测
 *
 * 验证：
 * - getCheckpointer：单例缓存 / setup 调用 / 失败重置 / 缺 DATABASE_URL 抛错
 * - getStore：单例缓存 / 失败重置
 * - resetCheckpointer / getCheckpointerStatus / isCheckpointerInitialized
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { PostgresSaverMock, PostgresStoreMock } = vi.hoisted(() => {
    const setupSaver = vi.fn().mockResolvedValue(undefined)
    const setupStore = vi.fn().mockResolvedValue(undefined)
    return {
        PostgresSaverMock: {
            fromConnString: vi.fn(() => ({ setup: setupSaver, _kind: 'saver' })),
            _setupSaver: setupSaver,
        },
        PostgresStoreMock: {
            fromConnString: vi.fn(() => ({ setup: setupStore, _kind: 'store' })),
            _setupStore: setupStore,
        },
    }
})

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
    PostgresSaver: PostgresSaverMock,
}))
vi.mock('@langchain/langgraph-checkpoint-postgres/store', () => ({
    PostgresStore: PostgresStoreMock,
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import {
    getCheckpointer,
    getStore,
    resetCheckpointer,
    getCheckpointerStatus,
    isCheckpointerInitialized,
} from '~~/server/services/agent-platform/checkpointer'

beforeEach(() => {
    vi.clearAllMocks()
    resetCheckpointer()
})

describe('getCheckpointer', () => {
    it('首次调用返回 PostgresSaver 实例并完成 setup', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const ckp = await getCheckpointer()
        expect(ckp).toBeDefined()
        expect(PostgresSaverMock.fromConnString).toHaveBeenCalledWith(
            'postgresql://test',
            { schema: 'langgraph' },
        )
        expect((ckp as any).setup).toHaveBeenCalledOnce()
        expect(isCheckpointerInitialized()).toBe(true)
        expect(getCheckpointerStatus()).toEqual({
            initialized: true,
            initializing: false,
            hasInstance: true,
        })
    })

    it('再次调用返回同一实例（单例缓存）', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const a = await getCheckpointer()
        const b = await getCheckpointer()
        expect(a).toBe(b)
        expect(PostgresSaverMock.fromConnString).toHaveBeenCalledOnce()
    })

    it('并发调用：第二个等待初始化完成后复用第一个实例', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        // 让 setup 慢一点，模拟第二个调用进入"等待"分支
        ;(PostgresSaverMock as any)._setupSaver.mockImplementationOnce(
            () => new Promise<void>(resolve => setTimeout(resolve, 80)),
        )
        const [a, b] = await Promise.all([getCheckpointer(), getCheckpointer()])
        expect(a).toBe(b)
        expect(PostgresSaverMock.fromConnString).toHaveBeenCalledOnce()
    })

    it('DATABASE_URL 缺失时抛错', async () => {
        delete (process.env as any).DATABASE_URL
        await expect(getCheckpointer()).rejects.toThrow(/DATABASE_URL/)
        expect(isCheckpointerInitialized()).toBe(false)
    })

    it('setup 失败时重置实例并向上抛错', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        ;(PostgresSaverMock as any)._setupSaver.mockRejectedValueOnce(new Error('connect fail'))
        await expect(getCheckpointer()).rejects.toThrow(/connect fail/)
        expect(isCheckpointerInitialized()).toBe(false)
        expect(getCheckpointerStatus().hasInstance).toBe(false)
    })
})

describe('resetCheckpointer / status helpers', () => {
    it('reset 后 isCheckpointerInitialized 返回 false', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        await getCheckpointer()
        expect(isCheckpointerInitialized()).toBe(true)
        resetCheckpointer()
        expect(isCheckpointerInitialized()).toBe(false)
    })

    it('未初始化时 status 显示三个字段为 false', () => {
        expect(getCheckpointerStatus()).toEqual({
            initialized: false,
            initializing: false,
            hasInstance: false,
        })
    })
})

// store 模块状态在所有测试间共享（单例）；用 vi.resetModules + 动态 import 重新加载
describe('getStore', () => {
    async function freshModule() {
        // 重置 mock 调用计数；但 module 单例需要 vi.resetModules
        vi.resetModules()
        // 重新 mock（resetModules 后需要重新声明 mock）
        const setupSaver = vi.fn().mockResolvedValue(undefined)
        const setupStore = vi.fn().mockResolvedValue(undefined)
        const fromConnSaver = vi.fn(() => ({ setup: setupSaver, _kind: 'saver' }))
        const fromConnStore = vi.fn(() => ({ setup: setupStore, _kind: 'store' }))
        vi.doMock('@langchain/langgraph-checkpoint-postgres', () => ({
            PostgresSaver: { fromConnString: fromConnSaver },
        }))
        vi.doMock('@langchain/langgraph-checkpoint-postgres/store', () => ({
            PostgresStore: { fromConnString: fromConnStore },
        }))
        vi.doMock('#shared/utils/logger', () => ({
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        }))
        const mod = await import('~~/server/services/agent-platform/checkpointer')
        return { mod, setupSaver, setupStore, fromConnStore, fromConnSaver }
    }

    it('首次调用返回 PostgresStore 实例并完成 setup', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const { mod, setupStore, fromConnStore } = await freshModule()
        const store = await mod.getStore()
        expect(store).toBeDefined()
        expect(fromConnStore).toHaveBeenCalledWith('postgresql://test', { schema: 'langgraph' })
        expect(setupStore).toHaveBeenCalledOnce()
    })

    it('再次调用返回同一实例', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const { mod, fromConnStore } = await freshModule()
        const a = await mod.getStore()
        const b = await mod.getStore()
        expect(a).toBe(b)
        expect(fromConnStore).toHaveBeenCalledOnce()
    })

    it('并发调用：第二个等待初始化完成后复用第一个实例', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const { mod, fromConnStore, setupStore } = await freshModule()
        setupStore.mockImplementationOnce(
            () => new Promise<void>(resolve => setTimeout(resolve, 80)),
        )
        const [a, b] = await Promise.all([mod.getStore(), mod.getStore()])
        expect(a).toBe(b)
        expect(fromConnStore).toHaveBeenCalledOnce()
    })

    it('setup 失败时重置实例，再调用可恢复', async () => {
        process.env.DATABASE_URL = 'postgresql://test'
        const { mod, setupStore } = await freshModule()
        setupStore.mockRejectedValueOnce(new Error('store init fail'))
        await expect(mod.getStore()).rejects.toThrow(/store init fail/)
        setupStore.mockResolvedValueOnce(undefined)
        const store = await mod.getStore()
        expect(store).toBeDefined()
    })

    it('DATABASE_URL 缺失时抛错', async () => {
        delete (process.env as any).DATABASE_URL
        const { mod } = await freshModule()
        await expect(mod.getStore()).rejects.toThrow(/DATABASE_URL/)
    })
})
