# 跨进程缓存失效总线 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立基于 Redis pub/sub 的跨进程缓存失效总线，解决多实例部署下进程级内存缓存「失效只清一台」的一致性问题，并修复「后台改节点模型后运行中分析仍用旧模型」的 bug。

**Architecture:** 4 个缓存（nodeConfig / filesystemBackend / RBAC 用户权限 / RBAC 公开 API 权限）仍留各实例进程内存；新增一个总线模块，失效时「清本地 + 经 Redis 频道 `cache:invalidate` 广播」，各实例订阅后各自清。每个缓存另带兜底 TTL，广播丢失也能自愈。Redis 不可用时退化为纯 TTL，非硬依赖。

**Tech Stack:** Nuxt 4 / Nitro、TypeScript、ioredis 5.10.1、Vitest（worker 级 DB 隔离 + 真实 Redis）。

**设计文档:** `docs/superpowers/specs/2026-05-19-cache-invalidation-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `server/lib/redis.ts` | 改 | 新增 `getCacheBusSubscriber()` 专用订阅连接单例，纳入 `closeRedisConnections()` |
| `server/utils/cacheInvalidationBus.ts` | 新增 | 总线核心：发布、注册 handler、订阅分发、消息解析 |
| `server/plugins/cache-invalidation.ts` | 新增 | Nitro 插件：进程启动时启动订阅 |
| `server/services/agent-platform/nodeConfig/loader.ts` | 改 | 接入总线 + 10min 兜底 TTL |
| `server/services/agent-platform/skills/filesystemBackendCache.ts` | 改 | 接入总线 + 10min 兜底 TTL |
| `server/services/rbac/cache.service.ts` | 改 | 接入总线（TTL 保持 60s） |
| `server/api/v1/admin/nodes/[id].put.ts` | 改 | 补 `invalidateNodeConfigCache` —— 修复原始 bug |
| `server/api/v1/admin/nodes/[id].delete.ts` | 改 | 补 `invalidateNodeConfigCache` |

测试文件：`tests/server/utils/redis.test.ts`（扩展）、`tests/server/utils/cacheInvalidationBus.test.ts`（新增）、`tests/server/agent-platform/nodeConfig/loader.test.ts`（扩展）、`tests/server/agent-platform/skills/filesystemBackendCache.test.ts`（扩展）、`tests/server/rbac/cacheService.bus.test.ts`（新增）、`tests/server/api/admin/nodesCacheInvalidation.test.ts`（新增）。

任务依赖：Task 1 → Task 2 → Task 3 / 4 / 5 / 6（并行）→ Task 7 → Task 8。

---

## Task 1: 在 redis.ts 新增总线专用订阅连接

**Files:**
- Modify: `server/lib/redis.ts`
- Test: `tests/server/utils/redis.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/utils/redis.test.ts` 的 `describe('Redis 连接管理', ...)` 块内，`createRedisSubscription` 那个 `it` 之后追加：

```ts
    it('getCacheBusSubscriber 应返回独立的订阅连接单例', async () => {
        const { getRedisClient, getRedisSubscriber, getCacheBusSubscriber }
            = await import('../../../server/lib/redis')
        const client = getRedisClient()
        const subscriber = getRedisSubscriber()
        const cacheBus = getCacheBusSubscriber()
        expect(cacheBus).toBeDefined()
        expect(cacheBus).not.toBe(client)
        expect(cacheBus).not.toBe(subscriber)
        expect(getCacheBusSubscriber()).toBe(cacheBus)
    })

    it('closeRedisConnections 应同时关闭 cacheBusSubscriber', async () => {
        const { getCacheBusSubscriber, closeRedisConnections }
            = await import('../../../server/lib/redis')
        const before = getCacheBusSubscriber()
        await closeRedisConnections()
        const after = getCacheBusSubscriber()
        expect(after).not.toBe(before) // 关闭后再获取应为新实例
    })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/utils/redis.test.ts --reporter=verbose`
Expected: FAIL —— `getCacheBusSubscriber is not a function`。

- [ ] **Step 3: 实现**

在 `server/lib/redis.ts` 中，`getRedisSubscriber` 函数之后、`createRedisSubscription` 之前插入：

```ts
let cacheBusSubscriber: Redis | null = null

/** 获取缓存失效总线专用订阅连接（独立于 agentWorker 占用的 redisSubscriber，避免频道串台） */
export function getCacheBusSubscriber(): Redis {
  if (!cacheBusSubscriber) {
    cacheBusSubscriber = new Redis(getRedisUrl(), { maxRetriesPerRequest: 3, lazyConnect: true })
    cacheBusSubscriber.on('error', (err) => logger.error('Redis cache-bus subscriber error:', err))
  }
  return cacheBusSubscriber
}
```

并把 `closeRedisConnections` 整个替换为：

```ts
/** 关闭所有 Redis 连接 */
export async function closeRedisConnections(): Promise<void> {
  await Promise.all([
    redisClient?.quit(),
    redisSubscriber?.quit(),
    cacheBusSubscriber?.quit(),
  ])
  redisClient = null
  redisSubscriber = null
  cacheBusSubscriber = null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/utils/redis.test.ts --reporter=verbose`
Expected: PASS（全部用例，含原有用例）。

- [ ] **Step 5: 提交**

```bash
git add server/lib/redis.ts tests/server/utils/redis.test.ts
git commit -m "feat(cache): redis.ts 新增总线专用订阅连接 getCacheBusSubscriber"
```

---

## Task 2: 缓存失效总线核心模块

**Files:**
- Create: `server/utils/cacheInvalidationBus.ts`
- Test: `tests/server/utils/cacheInvalidationBus.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/utils/cacheInvalidationBus.test.ts`：

```ts
/**
 * 缓存失效总线测试
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
    CACHE_INVALIDATION_CHANNEL,
    CACHE_NAMES,
    registerInvalidationHandler,
    dispatchInvalidationMessage,
    publishInvalidation,
    startCacheInvalidationSubscriber,
    _resetBusForTests,
} from '~~/server/utils/cacheInvalidationBus'
import {
    getRedisClient,
    getCacheBusSubscriber,
    closeRedisConnections,
} from '~~/server/lib/redis'

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

    it('畸形 JSON 被忽略，不抛错', () => {
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

describe('cacheInvalidationBus pub/sub 链路（真实 Redis）', () => {
    afterAll(async () => {
        _resetBusForTests()
        await closeRedisConnections()
    })

    it('publish 的消息经 Redis 被订阅端 dispatch 到 handler', async () => {
        _resetBusForTests()
        // 用测试唯一 cacheName 隔离并行 worker 共用单频道导致的串台
        const testCacheName = `__test_${randomUUID()}`
        const received: (string[] | undefined)[] = []
        registerInvalidationHandler(testCacheName as never, keys => received.push(keys))

        startCacheInvalidationSubscriber()
        // 显式等待订阅完成后再发布（SUBSCRIBE 幂等）
        await getCacheBusSubscriber().subscribe(CACHE_INVALIDATION_CHANNEL)

        await getRedisClient().publish(
            CACHE_INVALIDATION_CHANNEL,
            JSON.stringify({ cacheName: testCacheName, keys: ['k1'] }),
        )

        await vi.waitFor(() => expect(received).toEqual([['k1']]), { timeout: 3000 })
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/utils/cacheInvalidationBus.test.ts --reporter=verbose`
Expected: FAIL —— 模块 `server/utils/cacheInvalidationBus.ts` 不存在。

- [ ] **Step 3: 实现**

创建 `server/utils/cacheInvalidationBus.ts`：

```ts
/**
 * 跨进程缓存失效总线
 *
 * 通过 Redis pub/sub 频道 cache:invalidate 广播缓存失效通知，解决多实例部署下
 * 进程级内存缓存「失效只清一台」的一致性问题。缓存数据本身不进 Redis，本总线
 * 只承载失效通知；各缓存另带兜底 TTL，广播丢失也能自愈。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */
import { getRedisClient, getCacheBusSubscriber } from '~~/server/lib/redis'

/** pub/sub 频道名 */
export const CACHE_INVALIDATION_CHANNEL = 'cache:invalidate'

/** 已接入总线的缓存标识 */
export const CACHE_NAMES = {
  NODE_CONFIG: 'nodeConfig',
  FILESYSTEM_BACKEND: 'filesystemBackend',
  RBAC_USER_PERMISSION: 'rbacUserPermission',
  RBAC_PUBLIC_API: 'rbacPublicApi',
} as const

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES]

/** 失效消息体 */
export interface CacheInvalidationMessage {
  cacheName: string
  /** 有 = 清这些 key；无/空 = 全清 */
  keys?: string[]
}

/** 本地失效回调：keys 为 undefined/空 → 全清，为数组 → 逐个删除 */
export type InvalidationHandler = (keys?: string[]) => void

const handlers = new Map<string, InvalidationHandler>()

/** 注册某缓存的本地失效回调。各 cache 模块在被 import 时调用一次。 */
export function registerInvalidationHandler(cacheName: CacheName, handler: InvalidationHandler): void {
  handlers.set(cacheName, handler)
}

/**
 * 发布失效通知。fire-and-forget——调用方不应 await。
 * Redis 不可用时仅记日志，绝不阻塞或拖垮写库 API。
 */
export function publishInvalidation(cacheName: CacheName, keys?: string[]): void {
  const message: CacheInvalidationMessage =
    keys && keys.length > 0 ? { cacheName, keys } : { cacheName }
  getRedisClient()
    .publish(CACHE_INVALIDATION_CHANNEL, JSON.stringify(message))
    .catch((err) => logger.warn('cacheInvalidationBus: 发布失效消息失败', err))
}

/** 解析并分发收到的失效消息。导出供测试。 */
export function dispatchInvalidationMessage(raw: string): void {
  let message: CacheInvalidationMessage
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      logger.warn('cacheInvalidationBus: 收到畸形失效消息，已忽略', { raw })
      return
    }
    message = parsed
  } catch {
    logger.warn('cacheInvalidationBus: 收到畸形失效消息，已忽略', { raw })
    return
  }
  const handler = handlers.get(message.cacheName)
  if (!handler) return // 本实例未注册该缓存，无害
  try {
    handler(message.keys)
  } catch (err) {
    logger.error('cacheInvalidationBus: 失效 handler 执行异常', {
      cacheName: message.cacheName,
      err,
    })
  }
}

let started = false

/**
 * 启动订阅。由 Nitro 插件在进程启动时调用一次。
 * - 启动时显式 subscribe 一次：点火 lazyConnect 连接并完成首次订阅
 * - on('ready') 负责其后每次（重）连接的（重）订阅，覆盖「冷启动初次订阅失败」场景
 *   （ioredis 的 autoResubscribe 只重订曾成功订阅过的频道，覆盖不到冷启动失败）
 */
export function startCacheInvalidationSubscriber(): void {
  if (started) return
  started = true
  const sub = getCacheBusSubscriber()

  sub.on('message', (channel: string, message: string) => {
    if (channel === CACHE_INVALIDATION_CHANNEL) dispatchInvalidationMessage(message)
  })

  sub.on('ready', () => {
    sub.subscribe(CACHE_INVALIDATION_CHANNEL)
      .catch((err) => logger.warn('cacheInvalidationBus: ready 重订阅失败', err))
  })

  sub.subscribe(CACHE_INVALIDATION_CHANNEL)
    .catch((err) => logger.warn('cacheInvalidationBus: 初次订阅失败，将由 on(ready) 重试', err))
}

/** 仅测试用：清空 handler 注册表。 */
export function _resetBusForTests(): void {
  handlers.clear()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/utils/cacheInvalidationBus.test.ts --reporter=verbose`
Expected: PASS（6 个用例全过；pub/sub 链路用例需测试环境 Redis 可用）。

- [ ] **Step 5: 提交**

```bash
git add server/utils/cacheInvalidationBus.ts tests/server/utils/cacheInvalidationBus.test.ts
git commit -m "feat(cache): 新增跨进程缓存失效总线"
```

---

## Task 3: 缓存失效总线 Nitro 插件

**Files:**
- Create: `server/plugins/cache-invalidation.ts`

> 说明：Nitro 插件难以独立单测，其行为已由 Task 2 的「pub/sub 链路」集成测试覆盖（该测试直接调用 `startCacheInvalidationSubscriber`）。本任务只新增一个薄封装文件。

- [ ] **Step 1: 实现插件**

创建 `server/plugins/cache-invalidation.ts`：

```ts
/**
 * 缓存失效总线 Nitro 插件
 *
 * 进程启动时订阅 cache:invalidate 频道。订阅连接（getCacheBusSubscriber）的关闭
 * 由 cron-scheduler 的 closeRedisConnections() 统一负责，本插件不管 Redis 生命周期
 * （与 agent-worker.ts 一致）。
 */
import { startCacheInvalidationSubscriber } from '~~/server/utils/cacheInvalidationBus'

export default defineNitroPlugin(() => {
  const { redis } = useRuntimeConfig()
  if (!redis.url) {
    logger.warn('Redis URL 未配置，缓存失效总线不启动（降级为纯 TTL）')
    return
  }
  startCacheInvalidationSubscriber()
  logger.info('缓存失效总线已启动')
})
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无与本文件相关的类型错误。

- [ ] **Step 3: 提交**

```bash
git add server/plugins/cache-invalidation.ts
git commit -m "feat(cache): 新增缓存失效总线 Nitro 插件"
```

---

## Task 4: nodeConfig 缓存接入总线 + 兜底 TTL

**Files:**
- Modify: `server/services/agent-platform/nodeConfig/loader.ts`
- Test: `tests/server/agent-platform/nodeConfig/loader.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/agent-platform/nodeConfig/loader.test.ts` 第一个 `describe('NodeConfig loader 缓存', ...)` 块内，最后一个 `it` 之后追加（同时在文件顶部 import 补 `vi`、补总线导入）：

文件顶部 import 段改为：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '~~/server/utils/db'
import {
    getNodeConfigCached,
    invalidateNodeConfigCache,
    _resetCacheForTests,
} from '~~/server/services/agent-platform/nodeConfig/loader'
import { getNodeConfigService } from '~~/server/services/node/node.service'
import { dispatchInvalidationMessage } from '~~/server/utils/cacheInvalidationBus'
```

追加用例：

```ts
    it('缓存项超过 10min TTL 后重新回源', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const t0 = new Date('2026-05-19T00:00:00Z')
            vi.setSystemTime(t0)
            const first = await getNodeConfigCached('caseMain')
            if (!first) return
            // 推进到 TTL（10min）之后
            vi.setSystemTime(new Date(t0.getTime() + 11 * 60 * 1000))
            const second = await getNodeConfigCached('caseMain')
            expect(second).not.toBe(first) // TTL 过期，重新回源，对象引用不同
        } finally {
            vi.useRealTimers()
        }
    })

    it('收到 nodeConfig 失效广播时清本地缓存（dispatch 单条）', async () => {
        const first = await getNodeConfigCached('caseMain')
        if (!first) return
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'nodeConfig', keys: ['caseMain'] }))
        const second = await getNodeConfigCached('caseMain')
        expect(second).not.toBe(first) // 被广播失效，重新回源
    })

    it('收到 nodeConfig 全清广播时清空本地缓存', async () => {
        const first = await getNodeConfigCached('caseMain')
        if (!first) return
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'nodeConfig' }))
        const second = await getNodeConfigCached('caseMain')
        expect(second).not.toBe(first)
    })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agent-platform/nodeConfig/loader.test.ts --reporter=verbose`
Expected: FAIL —— TTL 用例失败（当前缓存无 TTL，`second` 仍 `toBe(first)`）；dispatch 用例失败（loader 未注册 handler）。

- [ ] **Step 3: 实现**

把 `server/services/agent-platform/nodeConfig/loader.ts` 整个替换为：

```ts
/**
 * NodeConfig Loader 内存缓存
 *
 * 每次 createAgent 都打 DB 取节点配置成本高，故内存缓存。
 * 配置变更时：本地清 + 经缓存失效总线广播给其它实例。
 * 另带 10min 兜底 TTL，广播万一丢失也能自愈。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */

import { getNodeConfigService } from '~~/server/services/node/node.service'
import type { NodeConfig } from '~~/server/services/node/node.service'
import {
    CACHE_NAMES,
    publishInvalidation,
    registerInvalidationHandler,
} from '~~/server/utils/cacheInvalidationBus'

/** 兜底 TTL：10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
    value: NodeConfig | null
    expiredAt: number
}

const cache = new Map<string, CacheEntry>()

/** 本地清除（不广播）。供失效总线 handler 与本模块复用。 */
function clearLocal(keys?: string[]): void {
    if (!keys || keys.length === 0) {
        cache.clear()
    } else {
        for (const k of keys) cache.delete(k)
    }
}

// 注册到缓存失效总线：收到广播时只清本地（不再二次广播）
registerInvalidationHandler(CACHE_NAMES.NODE_CONFIG, clearLocal)

/**
 * 加载节点配置（带缓存）。
 * 节点不存在时缓存 null，下次仍快速返回。
 * 命中后若超过 TTL，视为未命中并回源。
 */
export async function getNodeConfigCached(nodeName: string): Promise<NodeConfig | null> {
    const entry = cache.get(nodeName)
    if (entry && Date.now() <= entry.expiredAt) {
        return entry.value
    }
    const cfg = await getNodeConfigService(nodeName)
    cache.set(nodeName, { value: cfg, expiredAt: Date.now() + CACHE_TTL_MS })
    return cfg
}

/**
 * 失效缓存。不传参数 = 清全量；传 nodeName = 清单条。
 * 本地立即清 + 经总线广播给其它实例。
 * 由 admin nodes 相关 API、prompts 相关 API、skill resync 调用。
 */
export function invalidateNodeConfigCache(nodeName?: string): void {
    const keys = nodeName ? [nodeName] : undefined
    clearLocal(keys)
    publishInvalidation(CACHE_NAMES.NODE_CONFIG, keys)
}

/** 仅供测试用：重置缓存到初始空状态。生产代码不要调。 */
export function _resetCacheForTests(): void {
    cache.clear()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agent-platform/nodeConfig/loader.test.ts --reporter=verbose`
Expected: PASS（原有用例 + 3 个新用例全过）。

- [ ] **Step 5: 提交**

```bash
git add server/services/agent-platform/nodeConfig/loader.ts tests/server/agent-platform/nodeConfig/loader.test.ts
git commit -m "feat(cache): nodeConfig 缓存接入失效总线并加兜底 TTL"
```

---

## Task 5: filesystemBackend 缓存接入总线 + 兜底 TTL

**Files:**
- Modify: `server/services/agent-platform/skills/filesystemBackendCache.ts`
- Test: `tests/server/agent-platform/skills/filesystemBackendCache.test.ts`

- [ ] **Step 1: 写失败测试**

把 `tests/server/agent-platform/skills/filesystemBackendCache.test.ts` 顶部 import 改为：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    getFilesystemBackend,
    invalidateBackendCache,
} from '~~/server/services/agent-platform/skills/filesystemBackendCache'
import { dispatchInvalidationMessage } from '~~/server/utils/cacheInvalidationBus'
```

在 `describe('FilesystemBackendCache', ...)` 块内最后一个 `it` 之后追加：

```ts
    it('缓存项超过 10min TTL 后重建实例', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const t0 = new Date('2026-05-19T00:00:00Z')
            vi.setSystemTime(t0)
            const a = getFilesystemBackend(['x'], new Set(['skill_a']))
            vi.setSystemTime(new Date(t0.getTime() + 11 * 60 * 1000))
            const b = getFilesystemBackend(['x'], new Set(['skill_a']))
            expect(a).not.toBe(b) // TTL 过期，重建
        } finally {
            vi.useRealTimers()
        }
    })

    it('收到 filesystemBackend 失效广播时清空缓存', () => {
        const a = getFilesystemBackend(['x'], new Set(['skill_a']))
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'filesystemBackend' }))
        const b = getFilesystemBackend(['x'], new Set(['skill_a']))
        expect(a).not.toBe(b)
    })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/agent-platform/skills/filesystemBackendCache.test.ts --reporter=verbose`
Expected: FAIL —— TTL 用例与 dispatch 用例失败。

- [ ] **Step 3: 实现**

把 `server/services/agent-platform/skills/filesystemBackendCache.ts` 整个替换为：

```ts
/**
 * FilesystemBackend 缓存。
 *
 * deepagents 的 createSkillsMiddleware 接受 backend + sources。
 * 同一组 (sources, allowedSkillNames) 共用一个 backend 实例避免每次 createAgent 重建。
 * skill resync / status 切换时：本地清 + 经缓存失效总线广播。另带 10min 兜底 TTL。
 *
 * @see docs/superpowers/specs/2026-05-19-cache-invalidation-design.md
 */

import { FilesystemBackend } from 'deepagents'
import { AllowlistedFilesystemBackend } from './allowlistedFilesystemBackend'
import {
    CACHE_NAMES,
    publishInvalidation,
    registerInvalidationHandler,
} from '~~/server/utils/cacheInvalidationBus'

/** 兜底 TTL：10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
    value: FilesystemBackend
    expiredAt: number
}

const cache = new Map<string, CacheEntry>()

/** 本地清除（不广播）。filesystemBackend 一向全清。 */
function clearLocal(): void {
    cache.clear()
}

// 注册到缓存失效总线：收到广播时只清本地
registerInvalidationHandler(CACHE_NAMES.FILESYSTEM_BACKEND, clearLocal)

/**
 * 按 (sources, allowedSkillNames) 缓存 backend 实例。
 * sources 与 allowed 集合都自动排序确保顺序无关。
 * 命中后若超过 TTL，视为未命中并重建。
 *
 * @param sources skill 父目录列表
 * @param allowedSkillNames 节点允许的 skill 子目录名集合（即 status=ENABLED 且与节点关联）
 */
export function getFilesystemBackend(
    sources: string[],
    allowedSkillNames: Set<string>,
): FilesystemBackend {
    const sortedSources = [...sources].sort()
    const sortedAllowed = [...allowedSkillNames].sort()
    const key = `${sortedSources.join(',')}::${sortedAllowed.join('|')}`
    const entry = cache.get(key)
    if (entry && Date.now() <= entry.expiredAt) {
        return entry.value
    }
    const backend = new AllowlistedFilesystemBackend({
        rootDir: process.cwd(),
        skillParentDirs: new Set(sortedSources),
        allowedSkillNames: new Set(sortedAllowed),
    })
    cache.set(key, { value: backend, expiredAt: Date.now() + CACHE_TTL_MS })
    return backend
}

/**
 * 失效全部 backend 缓存。本地立即清 + 经总线广播给其它实例。
 * 调用时机：skill resync 后、status 切换后。
 */
export function invalidateBackendCache(): void {
    clearLocal()
    publishInvalidation(CACHE_NAMES.FILESYSTEM_BACKEND)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/agent-platform/skills/filesystemBackendCache.test.ts --reporter=verbose`
Expected: PASS（原有 6 用例 + 2 新用例全过）。

- [ ] **Step 5: 提交**

```bash
git add server/services/agent-platform/skills/filesystemBackendCache.ts tests/server/agent-platform/skills/filesystemBackendCache.test.ts
git commit -m "feat(cache): filesystemBackend 缓存接入失效总线并加兜底 TTL"
```

---

## Task 6: RBAC 权限缓存接入总线

**Files:**
- Modify: `server/services/rbac/cache.service.ts`
- Test: `tests/server/rbac/cacheService.bus.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/rbac/cacheService.bus.test.ts`：

```ts
/**
 * RBAC 权限缓存接入失效总线测试
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    getUserPermissionCache,
    setUserPermissionCache,
    clearUserPermissionCache,
    clearUserPermissionCacheBatch,
    getPublicApiPermissionCache,
    setPublicApiPermissionCache,
    clearPublicApiPermissionCache,
} from '~~/server/services/rbac/cache.service'
import { dispatchInvalidationMessage } from '~~/server/utils/cacheInvalidationBus'

const sampleUserCache = { apiPermissions: [], routePermissions: [], isSuperAdmin: false }

describe('RBAC 用户权限缓存接入失效总线', () => {
    beforeEach(() => {
        clearUserPermissionCacheBatch([1, 2, 3])
    })

    it('收到 rbacUserPermission 单条广播时清对应用户', () => {
        setUserPermissionCache(1, sampleUserCache)
        setUserPermissionCache(2, sampleUserCache)
        dispatchInvalidationMessage(JSON.stringify({
            cacheName: 'rbacUserPermission', keys: ['1'],
        }))
        expect(getUserPermissionCache(1)).toBeNull()
        expect(getUserPermissionCache(2)).not.toBeNull()
    })

    it('收到 rbacUserPermission 全清广播时清空所有用户', () => {
        setUserPermissionCache(1, sampleUserCache)
        setUserPermissionCache(2, sampleUserCache)
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'rbacUserPermission' }))
        expect(getUserPermissionCache(1)).toBeNull()
        expect(getUserPermissionCache(2)).toBeNull()
    })

    it('clearUserPermissionCache 仍正确清本地', () => {
        setUserPermissionCache(3, sampleUserCache)
        clearUserPermissionCache(3)
        expect(getUserPermissionCache(3)).toBeNull()
    })
})

describe('RBAC 公开 API 权限缓存接入失效总线', () => {
    beforeEach(() => {
        clearPublicApiPermissionCache()
    })

    it('收到 rbacPublicApi 广播时清空公开权限缓存', () => {
        setPublicApiPermissionCache([{ path: '/api/v1/x', method: 'GET' }])
        dispatchInvalidationMessage(JSON.stringify({ cacheName: 'rbacPublicApi' }))
        expect(getPublicApiPermissionCache()).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/rbac/cacheService.bus.test.ts --reporter=verbose`
Expected: FAIL —— `dispatchInvalidationMessage` 找不到 `rbacUserPermission` / `rbacPublicApi` 的 handler（cache.service 尚未注册）。

- [ ] **Step 3: 实现**

在 `server/services/rbac/cache.service.ts` 顶部（注释块之后）加入 import：

```ts
import {
    CACHE_NAMES,
    publishInvalidation,
    registerInvalidationHandler,
} from '~~/server/utils/cacheInvalidationBus'
```

把「用户权限缓存」一节的 `clearUserPermissionCache` / `clearAllUserPermissionCache` / `clearUserPermissionCacheBatch` 三个函数整体替换为：

```ts
/** 本地清除用户权限缓存（不广播）。keys 为 userId 字符串数组；空 → 全清。 */
function clearUserPermissionLocal(keys?: string[]): void {
    if (!keys || keys.length === 0) {
        userPermissionCache.clear()
    } else {
        for (const k of keys) userPermissionCache.delete(Number(k))
    }
}

// 注册到缓存失效总线：收到广播时只清本地
registerInvalidationHandler(CACHE_NAMES.RBAC_USER_PERMISSION, clearUserPermissionLocal)

/**
 * 清除指定用户的权限缓存。本地清 + 经总线广播给其它实例。
 */
export const clearUserPermissionCache = (userId: number): void => {
    clearUserPermissionLocal([String(userId)])
    publishInvalidation(CACHE_NAMES.RBAC_USER_PERMISSION, [String(userId)])
}

/**
 * 清除所有用户权限缓存。本地清 + 经总线广播给其它实例。
 */
export const clearAllUserPermissionCache = (): void => {
    clearUserPermissionLocal()
    publishInvalidation(CACHE_NAMES.RBAC_USER_PERMISSION)
}

/**
 * 批量清除用户权限缓存。本地清 + 经总线广播给其它实例。
 */
export const clearUserPermissionCacheBatch = (userIds: number[]): void => {
    if (userIds.length === 0) return
    const keys = userIds.map(String)
    clearUserPermissionLocal(keys)
    publishInvalidation(CACHE_NAMES.RBAC_USER_PERMISSION, keys)
}
```

把「公共 API 权限缓存」一节的 `clearPublicApiPermissionCache` 函数整体替换为：

```ts
/** 本地清除公共 API 权限缓存（不广播）。 */
function clearPublicApiPermissionLocal(): void {
    publicApiPermissionCache = null
}

// 注册到缓存失效总线：收到广播时只清本地
registerInvalidationHandler(CACHE_NAMES.RBAC_PUBLIC_API, clearPublicApiPermissionLocal)

/**
 * 清除公共 API 权限缓存。本地清 + 经总线广播给其它实例。
 */
export const clearPublicApiPermissionCache = (): void => {
    clearPublicApiPermissionLocal()
    publishInvalidation(CACHE_NAMES.RBAC_PUBLIC_API)
}
```

> 注意：`registerInvalidationHandler` 调用必须位于其引用的 `userPermissionCache` / `publicApiPermissionCache` 变量声明**之后**——这两个变量在文件「缓存配置」一节已声明，故上述函数（含 register 调用）放在原 clear 函数的位置即可，顺序天然满足。`getCacheStats` 与 `clearAllCache` 不改（`clearAllCache` 内部调用的两个函数已是新版，自动带广播）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/rbac/cacheService.bus.test.ts --reporter=verbose`
Expected: PASS（4 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add server/services/rbac/cache.service.ts tests/server/rbac/cacheService.bus.test.ts
git commit -m "feat(cache): RBAC 权限缓存接入失效总线"
```

---

## Task 7: 修复原始 bug —— 节点 PUT/DELETE 补缓存失效

**Files:**
- Modify: `server/api/v1/admin/nodes/[id].put.ts`
- Modify: `server/api/v1/admin/nodes/[id].delete.ts`
- Test: `tests/server/api/admin/nodesCacheInvalidation.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/api/admin/nodesCacheInvalidation.test.ts`：

```ts
/**
 * 节点 PUT/DELETE 缓存失效回归测试
 *
 * 回归原始 bug：后台改节点模型后，nodeConfig 缓存未被失效，运行中分析仍用旧模型。
 *
 * **Feature: cache-invalidation**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 spy 验证 handler 是否调用了缓存失效函数（handler 的职责就是「调用 invalidate」）
const invalidateSpy = vi.fn()
vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    invalidateNodeConfigCache: (...args: unknown[]) => invalidateSpy(...args),
}))

describe('节点 PUT 接口缓存失效', () => {
    beforeEach(() => invalidateSpy.mockClear())

    it('PUT /admin/nodes/:id 更新成功后调用 invalidateNodeConfigCache(node.name)', async () => {
        const { updateNodeService } = await import('~~/server/services/node/node.service')
        const updateSpy = vi.spyOn(
            await import('~~/server/services/node/node.service'), 'updateNodeService',
        ).mockResolvedValue({ id: 1, name: 'test_node_x' } as never)

        const handler = (await import('~~/server/api/v1/admin/nodes/[id].put')).default
        const event = {
            context: { params: { id: '1' } },
            node: { req: {}, res: {} },
        } as never
        // readBody/getRouterParam 由 h3 自动导入；构造最小合法请求体
        vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ priority: 5 }))
        vi.stubGlobal('getRouterParam', vi.fn().mockReturnValue('1'))

        await handler(event)

        expect(updateSpy).toHaveBeenCalled()
        expect(invalidateSpy).toHaveBeenCalledWith('test_node_x')
        updateSpy.mockRestore()
        void updateNodeService
    })
})
```

> 实现说明：上面这个 spy 风格的 handler 测试若因 h3 自动导入（`defineEventHandler` / `resSuccess` 等）在单测环境不可用而无法运行，改用下面这条**等价的真实集成回归测试**替代（二选一，最终留一条能跑通的）：seed 一个真实节点 → `getNodeConfigCached(name)` 预热缓存 → 走 `updateNodeService` + `invalidateNodeConfigCache(name)`（即 handler 的两步）→ 断言 `getNodeConfigCached` 返回新对象引用。执行计划阶段先试 spy 版，失败则切真实集成版，二者都验证「更新后缓存被失效」这一回归点。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/admin/nodesCacheInvalidation.test.ts --reporter=verbose`
Expected: FAIL —— `invalidateSpy` 未被调用（put.ts 尚未补失效调用）。

- [ ] **Step 3: 实现 —— put.ts**

修改 `server/api/v1/admin/nodes/[id].put.ts`：

顶部 import 段补一行：

```ts
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
```

把 `try` 块内的成功分支：

```ts
        const node = await updateNodeService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新节点成功', node)
```

改为：

```ts
        const node = await updateNodeService(paramsResult.data.id, bodyResult.data)
        // 节点配置已变更，失效 nodeConfig 缓存（本地清 + 广播给其它实例）
        invalidateNodeConfigCache(node.name)
        return resSuccess(event, '更新节点成功', node)
```

- [ ] **Step 4: 实现 —— delete.ts**

把 `server/api/v1/admin/nodes/[id].delete.ts` 整个替换为：

```ts
/**
 * 删除节点
 *
 * DELETE /api/v1/admin/nodes/:id
 * Requirements: 15.4
 */

import { z } from 'zod'
import { deleteNodeService } from '~~/server/services/node/node.service'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { prisma } from '~~/server/utils/db'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }

    try {
        // 删除前取出 name —— invalidateNodeConfigCache 接节点名而非 id
        const node = await prisma.nodes.findUnique({
            where: { id: result.data.id },
            select: { name: true },
        })

        await deleteNodeService(result.data.id)

        // 节点已删除，失效 nodeConfig 缓存（本地清 + 广播给其它实例）
        if (node) invalidateNodeConfigCache(node.name)

        return resSuccess(event, '删除节点成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除节点失败：', error)
        return resError(event, 500, '删除节点失败')
    }
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/api/admin/nodesCacheInvalidation.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/api/v1/admin/nodes/[id].put.ts server/api/v1/admin/nodes/[id].delete.ts tests/server/api/admin/nodesCacheInvalidation.test.ts
git commit -m "fix(api): 节点 PUT/DELETE 补 nodeConfig 缓存失效"
```

---

## Task 8: 全量校验

**Files:** 无（仅校验）

- [ ] **Step 1: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误（关注本计划涉及的 8 个文件）。

- [ ] **Step 2: 跑本计划涉及的全部测试**

Run:
```bash
npx vitest run tests/server/utils/redis.test.ts tests/server/utils/cacheInvalidationBus.test.ts tests/server/agent-platform/nodeConfig/loader.test.ts tests/server/agent-platform/skills/filesystemBackendCache.test.ts tests/server/rbac/cacheService.bus.test.ts tests/server/api/admin/nodesCacheInvalidation.test.ts --reporter=verbose
```
Expected: 全部 PASS。

- [ ] **Step 3: 全量测试套件**

Run: `bun run test`
Expected: 全部 PASS（如个别文件因 worker DB 负载假失败，按 `.claude/rules/testing.md` 单独重跑可疑文件确认真伪）。

- [ ] **Step 4: 用 simplify 技能优化本次改动的代码**

按项目规范 `每次完成编码后都使用 simplify 技能优化代码`，对本计划新增/修改的 8 个文件跑一遍 simplify，发现问题就修并补测。

- [ ] **Step 5: 最终提交（如 simplify 有改动）**

```bash
git add -A
git commit -m "refactor(cache): simplify 优化缓存失效总线实现"
```

---

## 自检记录

- **Spec 覆盖**：spec §5 组件表 8 个文件 → Task 1（redis.ts）、Task 2（bus）、Task 3（plugin）、Task 4（loader）、Task 5（filesystemBackendCache）、Task 6（cache.service）、Task 7（put/delete）逐一对应。spec §6 消息格式 `{cacheName, keys?}`、§7 错误处理（fire-and-forget publish / on('ready') 重订阅 / 畸形消息 / handler 抛错）、§8 测试策略（含 pub/sub 链路用唯一 cacheName 隔离、TTL、原始 bug 回归）均落到 Task 2/4/7 的具体步骤与用例。
- **占位符**：无 TBD/TODO；Task 7 的「spy 版 vs 真实集成版」是明确的二选一执行指引并各自给了验证点，非占位符。
- **类型一致性**：`CacheName` / `CacheInvalidationMessage` / `InvalidationHandler` 在 Task 2 定义，Task 4/5/6 一致引用；`registerInvalidationHandler` / `publishInvalidation` / `dispatchInvalidationMessage` / `_resetBusForTests` 签名跨任务一致；`CACHE_NAMES` 四个键 `NODE_CONFIG` / `FILESYSTEM_BACKEND` / `RBAC_USER_PERMISSION` / `RBAC_PUBLIC_API` 全程一致。
