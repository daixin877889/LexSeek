/**
 * 缓存失效总线测试
 *
 * 与项目既有 Redis 测试惯例一致：mock server/lib/redis，不连真实 Redis
 * （测试环境 useRuntimeConfig().redis.url 不可靠、CI 也不提供 Redis 容器）。
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// logger 全局桩（与 tests/server/admin/nodes.create.api.test.ts 同风格）
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

// 可变 mock 持有器（vi.hoisted 让被提升的 vi.mock 工厂可引用它）
const redisMock = vi.hoisted(() => ({
    throwOnGetClient: false,
    publish: vi.fn(),
    subOn: vi.fn(),
    subSubscribe: vi.fn(),
}))

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => {
        if (redisMock.throwOnGetClient) throw new Error('Redis URL 未配置')
        return { publish: redisMock.publish }
    },
    getCacheBusSubscriber: () => ({ on: redisMock.subOn, subscribe: redisMock.subSubscribe }),
}))

const {
    CACHE_INVALIDATION_CHANNEL,
    CACHE_NAMES,
    registerInvalidationHandler,
    dispatchInvalidationMessage,
    publishInvalidation,
    startCacheInvalidationSubscriber,
    _resetBusForTests,
} = await import('~~/server/utils/cacheInvalidationBus')

describe('cacheInvalidationBus 分发逻辑', () => {
    beforeEach(() => _resetBusForTests())

    it('收到消息分发到对应 handler 并传入 keys', () => {
        const calls: (string[] | undefined)[] = []
        registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, keys => calls.push(keys))
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'nodeConfig', keys: ['n1', 'n2'] }))
        expect(calls).toEqual([['n1', 'n2']])
    })

    it('无 keys 的消息传给 handler 为 undefined（全清语义）', () => {
        const calls: (string[] | undefined)[] = []
        registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, keys => calls.push(keys))
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'nodeConfig' }))
        expect(calls).toEqual([undefined])
    })

    it('未注册 handler 的 cacheName 为 no-op，不抛错', () => {
        expect(() => dispatchInvalidationMessage(JSON.stringify({ cacheName: 'unknownCache' })))
            .not.toThrow()
    })

    it('畸形消息被忽略，不抛错', () => {
        expect(() => dispatchInvalidationMessage('not-json{')).not.toThrow()
        expect(() => dispatchInvalidationMessage('null')).not.toThrow()
        expect(() => dispatchInvalidationMessage('123')).not.toThrow()
    })

    it('handler 抛错被包住，不影响调用方', () => {
        registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, () => { throw new Error('boom') })
        expect(() => dispatchInvalidationMessage(JSON.stringify({ cacheName: 'nodeConfig' })))
            .not.toThrow()
    })
})

describe('cacheInvalidationBus 发布', () => {
    beforeEach(() => {
        _resetBusForTests()
        redisMock.throwOnGetClient = false
        redisMock.publish.mockReset().mockResolvedValue(1)
    })

    it('publishInvalidation 带 keys 时发布到正确频道与载荷', () => {
        publishInvalidation(CACHE_NAMES.NODE_CONFIG, ['n1'])
        expect(redisMock.publish).toHaveBeenCalledWith(
            CACHE_INVALIDATION_CHANNEL,
            JSON.stringify({ cacheName: 'nodeConfig', keys: ['n1'] }),
        )
    })

    it('publishInvalidation 不带 keys 时载荷不含 keys 字段', () => {
        publishInvalidation(CACHE_NAMES.NODE_CONFIG)
        expect(redisMock.publish).toHaveBeenCalledWith(
            CACHE_INVALIDATION_CHANNEL,
            JSON.stringify({ cacheName: 'nodeConfig' }),
        )
    })

    it('getRedisClient 同步抛错（Redis URL 未配置）时 publishInvalidation 不抛', () => {
        redisMock.throwOnGetClient = true
        expect(() => publishInvalidation(CACHE_NAMES.NODE_CONFIG, ['n1'])).not.toThrow()
    })

    it('publish 异步 reject 时 publishInvalidation 不抛', () => {
        redisMock.publish.mockReset().mockRejectedValue(new Error('redis down'))
        expect(() => publishInvalidation(CACHE_NAMES.NODE_CONFIG)).not.toThrow()
    })
})

describe('cacheInvalidationBus 订阅接线', () => {
    beforeEach(() => {
        _resetBusForTests()
        redisMock.subOn.mockReset()
        redisMock.subSubscribe.mockReset().mockResolvedValue(undefined)
    })

    it('startCacheInvalidationSubscriber 订阅频道并接线 message → dispatch', () => {
        startCacheInvalidationSubscriber()

        // 启动时显式订阅一次 cache:invalidate
        expect(redisMock.subSubscribe).toHaveBeenCalledWith(CACHE_INVALIDATION_CHANNEL)
        // 接线了 message 与 ready 事件
        const events = redisMock.subOn.mock.calls.map(c => c[0])
        expect(events).toContain('message')
        expect(events).toContain('ready')

        // message 回调收到本频道消息时触发 dispatch
        const calls: (string[] | undefined)[] = []
        registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, keys => calls.push(keys))
        const messageCb = redisMock.subOn.mock.calls.find(c => c[0] === 'message')![1] as
            (channel: string, message: string) => void
        messageCb(CACHE_INVALIDATION_CHANNEL, JSON.stringify({ cacheName: 'nodeConfig', keys: ['x'] }))
        expect(calls).toEqual([['x']])

        // 非本频道消息被忽略
        calls.length = 0
        messageCb('other:channel', JSON.stringify({ cacheName: 'nodeConfig' }))
        expect(calls).toEqual([])
    })
})
