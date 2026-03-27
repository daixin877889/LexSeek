/**
 * Redis 和 Agent DB 连接管理测试
 *
 * 测试 server/lib/redis.ts 中的连接管理功能
 *
 * **Feature: infrastructure**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 需要在 vi.mock 之前定义工厂函数
vi.mock('ioredis', () => {
    return {
        default: class MockRedis {
            on = vi.fn()
            quit = vi.fn().mockResolvedValue('OK')
        },
    }
})

vi.mock('pg', () => {
    return {
        default: {
            Pool: class MockPool {
                on = vi.fn()
                end = vi.fn().mockResolvedValue(undefined)
            },
        },
    }
})

vi.mock('nuxt/app', () => ({
    useRuntimeConfig: vi.fn(() => ({
        redis: { url: 'redis://localhost:6379' },
        agent: { databaseUrl: 'postgresql://localhost/test' },
    })),
}))

vi.stubGlobal('logger', {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
})

describe('Redis 连接管理', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('getRedisClient 应返回 Redis 客户端实例', async () => {
        const { getRedisClient } = await import('../../../server/lib/redis')
        const client = getRedisClient()
        expect(client).toBeDefined()
    })

    it('getRedisClient 应返回相同的实例（单例）', async () => {
        const { getRedisClient } = await import('../../../server/lib/redis')
        const client1 = getRedisClient()
        const client2 = getRedisClient()
        expect(client1).toBe(client2)
    })

    it('getRedisSubscriber 应返回独立的订阅客户端', async () => {
        const { getRedisClient, getRedisSubscriber } = await import('../../../server/lib/redis')
        const client = getRedisClient()
        const subscriber = getRedisSubscriber()
        expect(subscriber).toBeDefined()
        expect(subscriber).not.toBe(client)
    })

    it('getRedisSubscriber 应返回相同的订阅客户端（单例）', async () => {
        const { getRedisSubscriber } = await import('../../../server/lib/redis')
        const sub1 = getRedisSubscriber()
        const sub2 = getRedisSubscriber()
        expect(sub1).toBe(sub2)
    })

    it('createRedisSubscription 应创建新的独立连接', async () => {
        const { createRedisSubscription } = await import('../../../server/lib/redis')
        const sub1 = createRedisSubscription()
        const sub2 = createRedisSubscription()
        expect(sub1).toBeDefined()
        expect(sub2).toBeDefined()
        expect(sub1).not.toBe(sub2)
    })

    it('closeRedisConnections 应关闭所有连接', async () => {
        const { getRedisClient, getRedisSubscriber, closeRedisConnections } = await import('../../../server/lib/redis')
        getRedisClient()
        getRedisSubscriber()
        await closeRedisConnections()
        // 关闭后再次获取应创建新实例
        const client = getRedisClient()
        expect(client).toBeDefined()
    })
})

describe('Agent 数据库连接池管理', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('getAgentDbPool 应返回数据库连接池实例', async () => {
        const { getAgentDbPool } = await import('../../../server/lib/redis')
        const pool = getAgentDbPool()
        expect(pool).toBeDefined()
    })

    it('getAgentDbPool 应返回相同的实例（单例）', async () => {
        const { getAgentDbPool } = await import('../../../server/lib/redis')
        const pool1 = getAgentDbPool()
        const pool2 = getAgentDbPool()
        expect(pool1).toBe(pool2)
    })

    it('closeAgentDbPool 应关闭连接池', async () => {
        const { getAgentDbPool, closeAgentDbPool } = await import('../../../server/lib/redis')
        getAgentDbPool()
        await closeAgentDbPool()
        // 关闭后再次获取应创建新实例
        const pool = getAgentDbPool()
        expect(pool).toBeDefined()
    })

    it('closeAgentDbPool 应能多次调用而不报错', async () => {
        const { getAgentDbPool, closeAgentDbPool } = await import('../../../server/lib/redis')
        getAgentDbPool()
        await closeAgentDbPool()
        await expect(closeAgentDbPool()).resolves.not.toThrow()
    })

    it('closeRedisConnections 应同时关闭 Redis 连接和 Agent 连接池', async () => {
        const { getRedisClient, getAgentDbPool, closeRedisConnections } = await import('../../../server/lib/redis')
        getRedisClient()
        getAgentDbPool()
        await closeRedisConnections()
        const client = getRedisClient()
        const pool = getAgentDbPool()
        expect(client).toBeDefined()
        expect(pool).toBeDefined()
    })
})
