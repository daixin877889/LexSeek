# 法律法规检索页 默认列表 + 动态热门检索 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/dashboard/legal` 搜全文 tab 进入即按发布日期倒序加载默认列表，并把硬编码的「热门检索」改为基于 Redis 7 天滑动窗口的动态聚合，DB 保留全量搜索日志供后续数据分析。

**Architecture:**
- 后端新增 `server/services/legal/trending.service.ts`（关键词归一化 + 双写 Redis & Prisma + 7 天 ZUNIONSTORE 聚合 + 60s 缓存），新增 `GET /api/v1/legal/trending-keywords`；改造 `legal/list.get.ts` 与 `legal/search-articles.post.ts` 调用 `recordSearchService` 落写入。
- 前端新增 `useTrendingKeywords` composable（缺位 fallback 补齐），改造 `app/pages/dashboard/legal/index.vue` 删除 `hasSearchResults` 守卫和硬编码 `TRENDING_KEYWORDS`，在 keyword 为空时隐藏「找到 X 部」标题行。
- 数据层 `prisma/models/legal.prisma` 新增 `legal_search_logs` 模型，写入路径走 Redis NX 30s 防刷，写入失败不影响业务接口。

**Tech Stack:** Nuxt 4 + Vue 3 + Pinia + ioredis + Prisma（PostgreSQL）+ Vitest + fast-check

---

## 文件清单

### 新建
| 路径 | 责任 |
|---|---|
| `server/services/legal/trending.service.ts` | 关键词归一化、recordSearchService、getTrendingKeywordsService |
| `server/api/v1/legal/trending-keywords.get.ts` | `GET /api/v1/legal/trending-keywords` 接口 |
| `app/composables/useTrendingKeywords.ts` | 前端拉热搜 + 兜底补齐 5 个词 |
| `tests/server/legal/trending.service.test.ts` | trending.service 单元测试（mock Redis + Prisma） |
| `tests/server/legal/trending-keywords.handler.test.ts` | trending-keywords 接口 handler 测试 |
| `tests/server/legal/legalSearchListRecord.test.ts` | list.get 接口的搜索日志写入测试 |
| `tests/server/legal/legalSearchArticlesRecord.test.ts` | search-articles 接口的搜索日志写入测试 |

### 修改
| 路径 | 改动 |
|---|---|
| `prisma/models/legal.prisma` | 末尾追加 `model legal_search_logs` |
| `prisma/seeds/seedData.sql` | 末尾追加 3 条 `api_permissions` INSERT（dev 库 admin 后台扫描后同步） |
| `server/api/v1/legal/list.get.ts` | 在 resSuccess 之前插入 recordSearchService 调用 |
| `server/api/v1/legal/search-articles.post.ts` | 在 resSuccess 之前插入 recordSearchService 调用 |
| `app/pages/dashboard/legal/index.vue` | 删 TRENDING_KEYWORDS / hasSearchResults，挂 useTrendingKeywords，列表始终渲染，标题行按 keyword 是否为空条件渲染 |

---

## Task 1：Prisma schema 新增 legal_search_logs 模型 + migrate

**Files:**
- Modify: `prisma/models/legal.prisma`（文件末尾追加）

- [ ] **Step 1: 阅读现有 legal.prisma 末尾结构，确认追加位置**

Run: `cat -n prisma/models/legal.prisma | tail -30`

- [ ] **Step 2: 在 `prisma/models/legal.prisma` 末尾追加新模型**

```prisma
/// 法律法规检索日志（用于热搜聚合 + 后续数据分析）
model legal_search_logs {
  id          String   @id @default(cuid())
  scope       String   // 'legal' | 'article'
  keyword     String
  userId      String?
  resultCount Int?
  resultIds   Json?
  createdAt   DateTime @default(now())

  @@index([scope, createdAt])
  @@index([keyword, scope])
  @@index([userId, createdAt])
  @@map("legal_search_logs")
}
```

- [ ] **Step 3: 运行 migrate dev 生成迁移并应用到本地 dev 库**

Run: `bun run prisma:migrate --name add_legal_search_logs`
Expected: 命令成功，自动 generate；`prisma/migrations/<ts>_add_legal_search_logs/migration.sql` 被创建，包含 `CREATE TABLE "legal_search_logs"` 与 3 个索引。

- [ ] **Step 4: 验证生成的 client 含新模型**

Run: `grep -n "legal_search_logs" generated/prisma/client/*.ts | head -5`
Expected: 多处命中 `legal_search_logs` 类型定义。

- [ ] **Step 5: Commit**

```bash
git add prisma/models/legal.prisma prisma/migrations/*_add_legal_search_logs/ generated/prisma/
git commit -m "feat(legal): 新增 legal_search_logs 表用于检索日志聚合与数据分析"
```

---

## Task 2：trending.service.ts 之 normalizeKeywordService（纯函数 + 单测）

**Files:**
- Create: `server/services/legal/trending.service.ts`（仅 normalize 函数）
- Test: `tests/server/legal/trending.service.test.ts`（normalize 部分）

- [ ] **Step 1: 写失败的单元测试**

文件：`tests/server/legal/trending.service.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { normalizeKeywordService } from '~~/server/services/legal/trending.service'

describe('normalizeKeywordService', () => {
    it('去除首尾空白并合并连续空格', () => {
        expect(normalizeKeywordService('  民法典   合同   ')).toBe('民法典 合同')
    })

    it('长度 < 2 返回 null', () => {
        expect(normalizeKeywordService('a')).toBeNull()
        expect(normalizeKeywordService(' ')).toBeNull()
        expect(normalizeKeywordService('')).toBeNull()
    })

    it('长度 > 50 返回 null', () => {
        expect(normalizeKeywordService('民'.repeat(51))).toBeNull()
    })

    it('纯标点 / 纯空白返回 null', () => {
        expect(normalizeKeywordService('!!!???')).toBeNull()
        expect(normalizeKeywordService(',，。 ')).toBeNull()
    })

    it('混合中文 + 字母数字正常返回', () => {
        expect(normalizeKeywordService('民法典 2026')).toBe('民法典 2026')
        expect(normalizeKeywordService('Labor Law')).toBe('Labor Law')
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/trending.service.test.ts --reporter=verbose`
Expected: 导入失败（文件不存在）或全部 case fail。

- [ ] **Step 3: 实现 normalizeKeywordService**

文件：`server/services/legal/trending.service.ts`（新建）

```ts
/**
 * 法律法规检索热门词服务
 *
 * 关键词归一化、Redis NX 防刷、ZUNIONSTORE 7 天滑动窗口聚合、60s 查询缓存。
 */

const MIN_LEN = 2
const MAX_LEN = 50

/**
 * 关键词归一化：trim + 合并连续空白；长度 ∈ [2, 50] 且非纯标点才返回，否则 null
 */
export function normalizeKeywordService(raw: string): string | null {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim().replace(/\s+/g, ' ')
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null
    // 纯标点 / 纯符号过滤：要求至少含一个中文字符或字母数字
    if (!/[\p{L}\p{N}]/u.test(trimmed)) return null
    return trimmed
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/legal/trending.service.test.ts --reporter=verbose`
Expected: 全部 5 个 case 通过。

- [ ] **Step 5: Commit**

```bash
git add server/services/legal/trending.service.ts tests/server/legal/trending.service.test.ts
git commit -m "feat(legal): 新增 normalizeKeywordService 关键词归一化"
```

---

## Task 3：recordSearchService（Redis NX 防刷 + 并行写 Redis 桶 + Prisma 日志）

**Files:**
- Modify: `server/services/legal/trending.service.ts`（追加 recordSearchService）
- Modify: `tests/server/legal/trending.service.test.ts`（追加 record 测试）

- [ ] **Step 1: 在测试文件顶部加入 mock**

替换 `tests/server/legal/trending.service.test.ts` 文件顶部为：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// logger 是 server 自动导入，测试侧需要 stub 否则 service 里 logger.warn 会报 ReferenceError
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const redisSet = vi.fn()
const redisZincrby = vi.fn()
const redisExpire = vi.fn()
const redisGet = vi.fn()
const redisZunionstore = vi.fn()
const redisZrevrange = vi.fn()
const redisDel = vi.fn()

vi.mock('~~/server/lib/redis', () => ({
    getRedisClient: () => ({
        set: redisSet,
        zincrby: redisZincrby,
        expire: redisExpire,
        get: redisGet,
        zunionstore: redisZunionstore,
        zrevrange: redisZrevrange,
        del: redisDel,
    }),
}))

const prismaCreate = vi.fn()
vi.mock('~~/server/utils/db', () => ({
    prisma: {
        legal_search_logs: {
            create: (...args: any[]) => prismaCreate(...args),
        },
    },
}))

import {
    normalizeKeywordService,
    recordSearchService,
} from '~~/server/services/legal/trending.service'

beforeEach(() => {
    redisSet.mockReset()
    redisZincrby.mockReset()
    redisExpire.mockReset()
    redisGet.mockReset()
    redisZunionstore.mockReset()
    redisZrevrange.mockReset()
    redisDel.mockReset()
    prismaCreate.mockReset()
})
```

> 注：Task 2 已经创建了 `tests/server/legal/trending.service.test.ts`，本步用上述内容**整段替换**原文件顶部的 import + describe 之前的部分；保留 Task 2 的 `describe('normalizeKeywordService', ...)` block。

- [ ] **Step 2: 追加 recordSearchService 测试**

在 `describe('normalizeKeywordService', ...)` 之后追加：

```ts
describe('recordSearchService', () => {
    it('归一化失败时直接返回，不调任何后端', async () => {
        await recordSearchService({ scope: 'legal', rawKeyword: 'a', userId: 'u1' })
        expect(redisSet).not.toHaveBeenCalled()
        expect(prismaCreate).not.toHaveBeenCalled()
    })

    it('NX 命中防刷时不计数也不写日志', async () => {
        redisSet.mockResolvedValueOnce(null) // NX 失败
        await recordSearchService({ scope: 'legal', rawKeyword: '民法典', userId: 'u1' })
        expect(redisSet).toHaveBeenCalledWith(
            'dedupe:trending:u1:legal:民法典',
            '1',
            'EX',
            30,
            'NX',
        )
        expect(redisZincrby).not.toHaveBeenCalled()
        expect(prismaCreate).not.toHaveBeenCalled()
    })

    it('NX 未命中时并行写 Redis 桶 + Prisma 日志', async () => {
        redisSet.mockResolvedValueOnce('OK')
        redisZincrby.mockResolvedValueOnce(1)
        redisExpire.mockResolvedValueOnce(1)
        prismaCreate.mockResolvedValueOnce({ id: 'log-1' })

        await recordSearchService({
            scope: 'article',
            rawKeyword: '  违约金 调整  ',
            userId: 'u2',
            resultCount: 12,
            resultIds: { ids: ['a1', 'a2'], scores: [0.9, 0.85] },
        })

        expect(redisZincrby).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:bucket:article:\d{8}$/),
            1,
            '违约金 调整',
        )
        expect(redisExpire).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:bucket:article:\d{8}$/),
            60 * 60 * 24 * 8,
        )
        expect(prismaCreate).toHaveBeenCalledWith({
            data: {
                scope: 'article',
                keyword: '违约金 调整',
                userId: 'u2',
                resultCount: 12,
                resultIds: { ids: ['a1', 'a2'], scores: [0.9, 0.85] },
            },
        })
    })

    it('Redis / Prisma 抛错时不抛给调用方', async () => {
        redisSet.mockRejectedValueOnce(new Error('redis down'))
        await expect(
            recordSearchService({ scope: 'legal', rawKeyword: '民法典', userId: 'u1' }),
        ).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 3: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/trending.service.test.ts --reporter=verbose`
Expected: 4 个 record case 报"recordSearchService is not a function"或类似。

- [ ] **Step 4: 实现 recordSearchService**

在 `server/services/legal/trending.service.ts` 末尾追加：

```ts
import dayjs from 'dayjs'
import { getRedisClient } from '~~/server/lib/redis'
import { prisma } from '~~/server/utils/db'

export type TrendingScope = 'legal' | 'article'

const DEDUPE_TTL = 30
const BUCKET_TTL = 60 * 60 * 24 * 8 // 8 天

function bucketKey(scope: TrendingScope, date = new Date()): string {
    return `trending:bucket:${scope}:${dayjs(date).format('YYYYMMDD')}`
}

function dedupeKey(scope: TrendingScope, userId: string, keyword: string): string {
    return `dedupe:trending:${userId}:${scope}:${keyword}`
}

export interface RecordSearchParams {
    scope: TrendingScope
    rawKeyword: string
    userId: string | null
    resultCount?: number
    resultIds?: { ids: string[]; scores?: number[] }
}

/**
 * 记录一次有效搜索：
 * 1. 归一化 keyword（失败直接 return）
 * 2. Redis NX 30s 防刷（命中则跳过）
 * 3. 并行写 Redis 时间桶（ZINCRBY + EXPIRE）与 Prisma 日志
 *
 * 任何错误吞掉、warn 出来；不影响调用方主流程。
 */
export async function recordSearchService(params: RecordSearchParams): Promise<void> {
    const keyword = normalizeKeywordService(params.rawKeyword)
    if (!keyword) return
    if (!params.userId) return

    try {
        const redis = getRedisClient()
        const acquired = await redis.set(
            dedupeKey(params.scope, params.userId, keyword),
            '1',
            'EX',
            DEDUPE_TTL,
            'NX',
        )
        if (acquired === null) return

        const bKey = bucketKey(params.scope)
        await Promise.all([
            (async () => {
                await redis.zincrby(bKey, 1, keyword)
                await redis.expire(bKey, BUCKET_TTL)
            })(),
            prisma.legal_search_logs.create({
                data: {
                    scope: params.scope,
                    keyword,
                    userId: params.userId,
                    resultCount: params.resultCount ?? null,
                    resultIds: params.resultIds ?? null,
                },
            }),
        ])
    } catch (err) {
        logger.warn('[legal-trending] recordSearchService 失败', err)
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/server/legal/trending.service.test.ts --reporter=verbose`
Expected: 9 个 case（5 normalize + 4 record）全部通过。

- [ ] **Step 6: Commit**

```bash
git add server/services/legal/trending.service.ts tests/server/legal/trending.service.test.ts
git commit -m "feat(legal): 实现 recordSearchService（NX 防刷 + 双写 Redis/DB）"
```

---

## Task 4：getTrendingKeywordsService（60s 缓存 + 7 天 ZUNIONSTORE）

**Files:**
- Modify: `server/services/legal/trending.service.ts`（追加 getTrendingKeywordsService）
- Modify: `tests/server/legal/trending.service.test.ts`（追加 get 测试）

- [ ] **Step 1: 追加测试**

在 `tests/server/legal/trending.service.test.ts` 末尾追加：

```ts
describe('getTrendingKeywordsService', () => {
    it('缓存命中时直接返回，不打 Redis 聚合', async () => {
        redisGet.mockResolvedValueOnce(JSON.stringify([
            { keyword: '民法典', count: 5 },
            { keyword: '劳动合同法', count: 3 },
        ]))
        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)
        expect(out).toEqual([
            { keyword: '民法典', count: 5 },
            { keyword: '劳动合同法', count: 3 },
        ])
        expect(redisZunionstore).not.toHaveBeenCalled()
    })

    it('缓存未命中时 ZUNIONSTORE 合并 7 个桶并 ZREVRANGE 取 top N', async () => {
        redisGet.mockResolvedValueOnce(null)
        redisZunionstore.mockResolvedValueOnce(2)
        redisZrevrange.mockResolvedValueOnce(['民法典', '7', '公司法', '4'])
        redisDel.mockResolvedValueOnce(1)
        redisSet.mockResolvedValueOnce('OK')

        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)

        expect(redisZunionstore).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:tmp:legal:/),
            7,
            ...Array.from({ length: 7 }, () => expect.stringMatching(/^trending:bucket:legal:\d{8}$/)),
            'AGGREGATE',
            'SUM',
        )
        expect(redisZrevrange).toHaveBeenCalledWith(
            expect.stringMatching(/^trending:tmp:legal:/),
            0,
            4,
            'WITHSCORES',
        )
        expect(redisDel).toHaveBeenCalled()
        expect(redisSet).toHaveBeenCalledWith(
            'trending:cache:legal',
            JSON.stringify([
                { keyword: '民法典', count: 7 },
                { keyword: '公司法', count: 4 },
            ]),
            'EX',
            60,
        )
        expect(out).toEqual([
            { keyword: '民法典', count: 7 },
            { keyword: '公司法', count: 4 },
        ])
    })

    it('Redis 抛错时返回空数组', async () => {
        redisGet.mockRejectedValueOnce(new Error('redis down'))
        const { getTrendingKeywordsService } = await import('~~/server/services/legal/trending.service')
        const out = await getTrendingKeywordsService('legal', 5)
        expect(out).toEqual([])
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/trending.service.test.ts -t 'getTrendingKeywordsService' --reporter=verbose`
Expected: 3 个 case fail，函数不存在。

- [ ] **Step 3: 实现 getTrendingKeywordsService**

在 `server/services/legal/trending.service.ts` 末尾追加：

```ts
const CACHE_TTL = 60
const WINDOW_DAYS = 7

export interface TrendingItem {
    keyword: string
    count: number
}

/**
 * 取近 7 天 top N 热搜，60s 缓存；失败返回空数组让前端兜底
 */
export async function getTrendingKeywordsService(
    scope: TrendingScope,
    limit = 5,
): Promise<TrendingItem[]> {
    try {
        const redis = getRedisClient()
        const cacheK = `trending:cache:${scope}`
        const cached = await redis.get(cacheK)
        if (cached) {
            return JSON.parse(cached) as TrendingItem[]
        }

        // 7 天滑动窗口桶 key（今天 + 过去 6 天）
        const today = dayjs()
        const buckets: string[] = []
        for (let i = 0; i < WINDOW_DAYS; i++) {
            buckets.push(bucketKey(scope, today.subtract(i, 'day').toDate()))
        }

        const tmpK = `trending:tmp:${scope}:${Date.now()}`
        await redis.zunionstore(tmpK, buckets.length, ...buckets, 'AGGREGATE', 'SUM')
        const raw = await redis.zrevrange(tmpK, 0, limit - 1, 'WITHSCORES')
        await redis.del(tmpK)

        // raw 形如 [keyword, score, keyword, score, ...]
        const items: TrendingItem[] = []
        for (let i = 0; i < raw.length; i += 2) {
            const kw = raw[i]
            const sc = raw[i + 1]
            if (typeof kw === 'string' && typeof sc === 'string') {
                items.push({ keyword: kw, count: Number(sc) })
            }
        }

        await redis.set(cacheK, JSON.stringify(items), 'EX', CACHE_TTL)
        return items
    } catch (err) {
        logger.warn('[legal-trending] getTrendingKeywordsService 失败', err)
        return []
    }
}
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `npx vitest run tests/server/legal/trending.service.test.ts --reporter=verbose`
Expected: 12 个 case 全部通过。

- [ ] **Step 5: Commit**

```bash
git add server/services/legal/trending.service.ts tests/server/legal/trending.service.test.ts
git commit -m "feat(legal): 实现 getTrendingKeywordsService（7 天滑窗 + 60s 缓存）"
```

---

## Task 5：新建 GET /api/v1/legal/trending-keywords 接口

**Files:**
- Create: `server/api/v1/legal/trending-keywords.get.ts`
- Test: `tests/server/legal/trending-keywords.handler.test.ts`

- [ ] **Step 1: 写失败的 handler 测试**

文件：`tests/server/legal/trending-keywords.handler.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 项目通行的 handler 测试 stub 模式：用 globalThis 覆盖自动导入的 H3/响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}

const getTrending = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    getTrendingKeywordsService: (scope: any, limit: any) => getTrending(scope, limit),
}))

const { default: trendingHandler } = await import('~~/server/api/v1/legal/trending-keywords.get')

interface MockEvent {
    context: { auth?: { user: { id: string } } }
    __query?: Record<string, any>
}

function buildEvent(query: Record<string, string>, user: { id: string } | null = { id: 'u1' }): MockEvent {
    return {
        context: user ? { auth: { user } } : {},
        __query: query,
    }
}

beforeEach(() => {
    getTrending.mockReset()
})

describe('GET /api/v1/legal/trending-keywords', () => {
    it('未登录返回 401', async () => {
        const res: any = await trendingHandler(buildEvent({ scope: 'legal' }, null))
        expect(res.code).toBe(401)
    })

    it('scope 缺失返回 400', async () => {
        const res: any = await trendingHandler(buildEvent({}))
        expect(res.code).toBe(400)
    })

    it('scope=legal 时调 service 并返回 items', async () => {
        getTrending.mockResolvedValueOnce([{ keyword: '民法典', count: 7 }])
        const res: any = await trendingHandler(buildEvent({ scope: 'legal' }))
        expect(getTrending).toHaveBeenCalledWith('legal', 5)
        expect(res.data).toEqual({ items: [{ keyword: '民法典', count: 7 }] })
    })

    it('limit 参数被透传到 service', async () => {
        getTrending.mockResolvedValueOnce([])
        await trendingHandler(buildEvent({ scope: 'article', limit: '10' }))
        expect(getTrending).toHaveBeenCalledWith('article', 10)
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/trending-keywords.handler.test.ts --reporter=verbose`
Expected: 模块导入失败（文件不存在）。

- [ ] **Step 3: 实现 handler**

文件：`server/api/v1/legal/trending-keywords.get.ts`

```ts
/**
 * 法律法规热搜词接口
 * GET /api/v1/legal/trending-keywords?scope=legal|article&limit=5
 *
 * 基于 Redis 7 天滑动窗口聚合，返回 top N 热搜词。
 */

import { z } from 'zod'
import { getTrendingKeywordsService } from '~~/server/services/legal/trending.service'

const querySchema = z.object({
    scope: z.enum(['legal', 'article']),
    limit: z.coerce.number().int().min(1).max(20).default(5),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]!.message)
    }

    const { scope, limit } = parsed.data
    const items = await getTrendingKeywordsService(scope, limit)
    return resSuccess(event, '获取成功', { items })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/legal/trending-keywords.handler.test.ts --reporter=verbose`
Expected: 4 个 case 全部通过。

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/legal/trending-keywords.get.ts tests/server/legal/trending-keywords.handler.test.ts
git commit -m "feat(legal): 新增 GET /api/v1/legal/trending-keywords 接口"
```

---

## Task 6：改造 GET /api/v1/legal/list 写搜索日志

**Files:**
- Modify: `server/api/v1/legal/list.get.ts`
- Create: `tests/server/legal/legalSearchListRecord.test.ts`

- [ ] **Step 1: 写失败的集成测试**

文件：`tests/server/legal/legalSearchListRecord.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const recordSearch = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    recordSearchService: (params: any) => recordSearch(params),
}))

const prismaCount = vi.fn()
const prismaFindMany = vi.fn()
vi.mock('~~/server/utils/db', () => ({
    prisma: {
        legalMain: {
            count: (...a: any[]) => prismaCount(...a),
            findMany: (...a: any[]) => prismaFindMany(...a),
        },
    },
}))

const { default: listHandler } = await import('~~/server/api/v1/legal/list.get')

function buildEvent(query: Record<string, string>, user = { id: 'u1' }) {
    return { context: { auth: { user } }, __query: query } as any
}

beforeEach(() => {
    recordSearch.mockReset()
    prismaCount.mockReset().mockResolvedValue(2)
    prismaFindMany.mockReset().mockResolvedValue([
        { id: 'L1', name: '民法典', code: 'A', type: 'law', category: null, issuingAuthority: null, documentNumber: null, publishDate: null, effectiveDate: null, invalidDate: null, lastEditedAt: null, lastEmbeddingAt: null, createdAt: null },
        { id: 'L2', name: '物权法', code: 'B', type: 'law', category: null, issuingAuthority: null, documentNumber: null, publishDate: null, effectiveDate: null, invalidDate: null, lastEditedAt: null, lastEmbeddingAt: null, createdAt: null },
    ])
})

describe('GET /api/v1/legal/list 搜索日志写入', () => {
    it('keyword 为空时不调 recordSearchService', async () => {
        await listHandler(buildEvent({}))
        expect(recordSearch).not.toHaveBeenCalled()
    })

    it('keyword 非空时调 recordSearchService，携带 resultCount 和前 20 条 id', async () => {
        await listHandler(buildEvent({ keyword: '民法典' }))
        expect(recordSearch).toHaveBeenCalledWith({
            scope: 'legal',
            rawKeyword: '民法典',
            userId: 'u1',
            resultCount: 2,
            resultIds: { ids: ['L1', 'L2'] },
        })
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/legalSearchListRecord.test.ts --reporter=verbose`
Expected: 第二个 case fail（`recordSearch` 未被调用）。

- [ ] **Step 3: 改造 handler**

打开 `server/api/v1/legal/list.get.ts`，在文件头部添加 import：

```ts
import { recordSearchService } from '~~/server/services/legal/trending.service'
```

定位到 `return resSuccess(event, '获取列表成功', response)` 这一行，**在它之前**插入：

```ts
if (keyword && keyword.trim()) {
    await recordSearchService({
        scope: 'legal',
        rawKeyword: keyword,
        userId: user.id,
        resultCount: total,
        resultIds: { ids: items.slice(0, 20).map(i => i.id) },
    })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/legal/legalSearchListRecord.test.ts --reporter=verbose`
Expected: 2 个 case 通过。

- [ ] **Step 5: 跑已有的 legalSearchList 测试确保未回归**

Run: `npx vitest run tests/server/legal/legalSearchList.test.ts --reporter=verbose`
Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/legal/list.get.ts tests/server/legal/legalSearchListRecord.test.ts
git commit -m "feat(legal): list.get 在 keyword 非空时落 legal_search_logs"
```

---

## Task 7：改造 POST /api/v1/legal/search-articles 写搜索日志

**Files:**
- Modify: `server/api/v1/legal/search-articles.post.ts`
- Create: `tests/server/legal/legalSearchArticlesRecord.test.ts`

- [ ] **Step 1: 写失败的集成测试**

文件：`tests/server/legal/legalSearchArticlesRecord.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const recordSearch = vi.fn()
vi.mock('~~/server/services/legal/trending.service', () => ({
    recordSearchService: (params: any) => recordSearch(params),
}))

const searchLaw = vi.fn()
vi.mock('~~/server/services/legal/searchLaw.tool', () => ({
    searchLawService: (params: any) => searchLaw(params),
}))

const { default: articlesHandler } = await import('~~/server/api/v1/legal/search-articles.post')

function buildEvent(body: Record<string, any>, user = { id: 'u9' }) {
    return { context: { auth: { user } }, __body: body } as any
}

beforeEach(() => {
    recordSearch.mockReset()
    searchLaw.mockReset().mockResolvedValue({
        items: [
            { articles_id: 'A1', score: 0.92, content: '...', legal_id: 'L', legal_name: 'X', chapter_hierarchy: [], metadata: {} },
            { articles_id: 'A2', score: 0.81, content: '...', legal_id: 'L', legal_name: 'X', chapter_hierarchy: [], metadata: {} },
        ],
        total: 2,
        mode: 'vector',
    })
})

describe('POST /api/v1/legal/search-articles 搜索日志写入', () => {
    it('总是调 recordSearchService，scope=article 且携带 ids+scores', async () => {
        await articlesHandler(buildEvent({ query: '违约金调整' }))
        expect(recordSearch).toHaveBeenCalledWith({
            scope: 'article',
            rawKeyword: '违约金调整',
            userId: 'u9',
            resultCount: 2,
            resultIds: { ids: ['A1', 'A2'], scores: [0.92, 0.81] },
        })
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/legal/legalSearchArticlesRecord.test.ts --reporter=verbose`
Expected: `recordSearch` 没有被调用，fail。

- [ ] **Step 3: 改造 handler**

打开 `server/api/v1/legal/search-articles.post.ts`，在 import 区追加：

```ts
import { recordSearchService } from '~~/server/services/legal/trending.service'
```

定位 `return resSuccess(event, '搜索成功', response)`，**在它之前**插入：

```ts
await recordSearchService({
    scope: 'article',
    rawKeyword: query,
    userId: user.id,
    resultCount: searchResult.total,
    resultIds: {
        ids: searchResult.items.slice(0, 20).map(i => i.articles_id),
        scores: searchResult.items.slice(0, 20).map(i => i.score ?? 0),
    },
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/legal/legalSearchArticlesRecord.test.ts --reporter=verbose`
Expected: 1 个 case 通过。

- [ ] **Step 5: 跑已有的 search-articles 测试确保未回归**

Run: `npx vitest run tests/server/legal/legalSearchArticles.test.ts --reporter=verbose`
Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/legal/search-articles.post.ts tests/server/legal/legalSearchArticlesRecord.test.ts
git commit -m "feat(legal): search-articles 落 legal_search_logs（含语义分数）"
```

---

## Task 8：注册新接口的 API 权限到 RBAC

**Files:**
- Modify: `prisma/seeds/seedData.sql`（同步新增的 api_permissions 行）

> 操作要点：dev 环境跑通后通过管理后台扫描 + 给"普通用户"角色授权；然后把 dev 库的 api_permissions / role_permissions 增量同步到 seedData.sql，以便新环境（CI / 测试 / 生产）能复现权限。

- [ ] **Step 1: 启动 dev 服务让 Nitro 扫描到新接口**

Run: `bun dev`（保留后台运行，扫描接口需要服务已起）

- [ ] **Step 2: 在 admin 后台扫描 API 权限**

浏览器登录超管账号 → 进入「管理后台 → API 权限」→ 点「扫描」按钮 → 应看到新条目 `GET /api/v1/legal/trending-keywords`。

- [ ] **Step 3: 给「普通用户」/「会员用户」角色授权该接口**

在「管理后台 → 角色」找到面向 dashboard 用户的角色（通常是 `member` / `普通用户`），勾选 `GET /api/v1/legal/trending-keywords` 的权限，保存。

> 项目铁律：legal/list 与 legal/search-articles 已经在哪个角色组，trending-keywords 就跟着挂哪个组。

- [ ] **Step 4: 从 dev 库导出新增的 api_permissions 行 + role_permissions 行**

Run:
```bash
docker exec -i $(docker ps --filter "name=postgres" -q | head -1) \
  psql -U daixin -d ls_new -c \
  "SELECT * FROM api_permissions WHERE path = '/api/v1/legal/trending-keywords'"
```

记下新行的 id、created_at 等字段。同样查 `role_permissions` 表，找到刚授权的关联行（role_id 与新 permission_id 组合）。

- [ ] **Step 5: 同步到 seedData.sql**

在 `prisma/seeds/seedData.sql` 中：
- 找到 `INSERT INTO "public"."api_permissions"` 段的结尾，追加一行 INSERT，结构对照现有的 legal API 那几行（id 选未占用值，建议从已有最大 id +1 顺延，path/method 填新接口，is_public='f'，status=1）
- 找到 `INSERT INTO "public"."role_permissions"` 段，追加对应的 role-permission 关联行

> 严禁写 UPDATE/DELETE，仅追加 INSERT（见 `.claude/rules/database.md`）。

- [ ] **Step 6: 验证 seed 一致性：用 `bun run prisma:studio` 浏览或直接 `psql` 复核新行已写入**

- [ ] **Step 7: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(legal): 注册 trending-keywords 接口到 RBAC（同步 seedData）"
```

---

## Task 9：前端 useTrendingKeywords composable

**Files:**
- Create: `app/composables/useTrendingKeywords.ts`
- Test: `tests/client/composables/useTrendingKeywords.test.ts`

- [ ] **Step 1: 写失败的单元测试**

文件：`tests/client/composables/useTrendingKeywords.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: any[]) => apiFetch(...args),
}))

import { useTrendingKeywords } from '~/composables/useTrendingKeywords'

beforeEach(() => {
    apiFetch.mockReset()
})

describe('useTrendingKeywords', () => {
    it('成功返回 < 5 条时用兜底词补齐到 5 个，去重保序', async () => {
        apiFetch.mockResolvedValueOnce({
            items: [
                { keyword: '建设工程', count: 9 },
                { keyword: '中华人民共和国民法典', count: 7 }, // 与兜底词重复
            ],
        })

        const { keywords, load } = useTrendingKeywords()
        await load('legal')
        expect(keywords.value).toEqual([
            '建设工程',
            '中华人民共和国民法典',
            '劳动合同法',
            '公司法',
            '工程施工',
        ])
    })

    it('返回空数组时完全使用兜底词', async () => {
        apiFetch.mockResolvedValueOnce({ items: [] })
        const { keywords, load } = useTrendingKeywords()
        await load('article')
        expect(keywords.value).toEqual([
            '中华人民共和国民法典',
            '劳动合同法',
            '公司法',
            '工程施工',
            '招标投标法',
        ])
    })

    it('接口报错时也用兜底词', async () => {
        apiFetch.mockResolvedValueOnce(null) // useApiFetch 失败时返回 null
        const { keywords, load } = useTrendingKeywords()
        await load('legal')
        expect(keywords.value).toHaveLength(5)
    })

    it('传入的 scope 透传给接口 query', async () => {
        apiFetch.mockResolvedValueOnce({ items: [] })
        const { load } = useTrendingKeywords()
        await load('article')
        expect(apiFetch).toHaveBeenCalledWith('/api/v1/legal/trending-keywords', {
            query: { scope: 'article' },
        })
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/client/composables/useTrendingKeywords.test.ts --reporter=verbose`
Expected: 文件不存在，导入失败。

- [ ] **Step 3: 实现 composable**

文件：`app/composables/useTrendingKeywords.ts`

```ts
import { ref } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'

const FALLBACK_KEYWORDS = [
    '中华人民共和国民法典',
    '劳动合同法',
    '公司法',
    '工程施工',
    '招标投标法',
] as const

const MAX_COUNT = 5

interface TrendingApiResponse {
    items: { keyword: string; count: number }[]
}

export function useTrendingKeywords() {
    const keywords = ref<string[]>([])
    const loading = ref(false)

    /** 拉取指定 scope 的热搜词，不足 5 条时用 FALLBACK 去重补齐 */
    async function load(scope: 'legal' | 'article') {
        loading.value = true
        try {
            const data = await useApiFetch<TrendingApiResponse>(
                '/api/v1/legal/trending-keywords',
                { query: { scope } },
            )
            const dynamic = data?.items?.map(i => i.keyword) ?? []
            const merged: string[] = []
            for (const kw of [...dynamic, ...FALLBACK_KEYWORDS]) {
                if (!merged.includes(kw)) merged.push(kw)
                if (merged.length >= MAX_COUNT) break
            }
            keywords.value = merged
        } finally {
            loading.value = false
        }
    }

    return { keywords, loading, load }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/client/composables/useTrendingKeywords.test.ts --reporter=verbose`
Expected: 4 个 case 全部通过。

- [ ] **Step 5: Commit**

```bash
git add app/composables/useTrendingKeywords.ts tests/client/composables/useTrendingKeywords.test.ts
git commit -m "feat(legal): 前端 useTrendingKeywords composable（含兜底补齐）"
```

---

## Task 10：改造 /dashboard/legal 页面

**Files:**
- Modify: `app/pages/dashboard/legal/index.vue`

- [ ] **Step 1: 删除硬编码 TRENDING_KEYWORDS 常量**

打开 `app/pages/dashboard/legal/index.vue`，删除：

```ts
/** 热门检索词（前端固定词表） */
const TRENDING_KEYWORDS = [
    '中华人民共和国民法典',
    '劳动合同法',
    '公司法',
    '工程施工',
    '招标投标法',
]
```

- [ ] **Step 2: 引入 useTrendingKeywords 并初始化**

在 `import { useSiteSeo } from '~/composables/useSiteSeo'` 下面追加：

```ts
import { useTrendingKeywords } from '~/composables/useTrendingKeywords'
```

在 `const articleSearch = useArticleSearch()` 下面追加：

```ts
const trending = useTrendingKeywords()
```

- [ ] **Step 3: 模板中替换热门检索按钮列表的数据源**

把模板里这一段：

```vue
<button v-for="kw in TRENDING_KEYWORDS" :key="kw" ...>
```

改成：

```vue
<button v-for="kw in trending.keywords.value" :key="kw" ...>
```

- [ ] **Step 4: 删除 hasSearchResults 守卫，列表区始终渲染**

在脚本里删除：

```ts
/** 是否已执行过搜索（有搜索结果） */
const hasSearchResults = ref(false)
```

把模板里：

```vue
<template v-if="activeTab === 'legal' && hasSearchResults">
```

改为：

```vue
<template v-if="activeTab === 'legal'">
```

并删除 `handleSearch` 内的 `hasSearchResults.value = true`、`handleReset` 内的 `hasSearchResults.value = false`、`restoreFromUrl` 内的 `hasSearchResults.value = true`。

- [ ] **Step 5: 标题行（找到 X 部 + 排序）按 keyword 非空条件渲染**

把模板里这一段：

```vue
<div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
    <h2 class="text-base font-semibold">
        找到 {{ legalSearch.pagination.value.total.toLocaleString() }} 部法律法规（耗时
        {{ legalSearch.searchElapsed.value.toFixed(2) }} 秒）
    </h2>
    ...
</div>
```

外层加 `v-if="searchKeyword.trim()"`：

```vue
<div v-if="searchKeyword.trim()" class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
    ...
</div>
```

- [ ] **Step 6: onMounted 末尾保证默认列表加载 + 拉热搜**

把现有的 `onMounted` 替换为：

```ts
onMounted(async () => {
    await legalSearch.loadIssuingAuthorities()

    isRestoring.value = true
    restoreFromUrl()
    nextTick(() => {
        isRestoring.value = false
    })

    // 进入页面：搜全文 tab 若 URL 未带任何过滤条件，主动拉默认列表
    if (
        activeTab.value === 'legal'
        && !searchKeyword.value
        && !searchFilters.value.type
        && !searchFilters.value.issuingAuthority
    ) {
        await legalSearch.search()
    }

    // 拉当前 tab 的热搜词
    await trending.load(activeTab.value)
})
```

- [ ] **Step 7: 监听 activeTab，切 tab 时换热搜 + 兜底拉默认列表**

把原有的 `watch(activeTab, () => { syncToUrl() })` 替换为：

```ts
watch(activeTab, async (val) => {
    syncToUrl()
    await trending.load(val)
    if (val === 'legal' && legalSearch.legalList.value.length === 0 && !searchKeyword.value) {
        await legalSearch.search()
    }
})
```

- [ ] **Step 8: 空态文案按 keyword 是否存在区分**

把模板里现有的空态：

```vue
<div v-else-if="legalSearch.legalList.value.length === 0" class="bg-card rounded-xl border p-12 text-center">
    <FileText class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
    <h3 class="mb-2 text-lg font-medium">未找到相关法律法规</h3>
    <p class="mb-4 text-sm text-muted-foreground">请尝试调整搜索条件</p>
    <Button variant="outline" @click="handleReset">重置筛选</Button>
</div>
```

替换为：

```vue
<div v-else-if="legalSearch.legalList.value.length === 0" class="bg-card rounded-xl border p-12 text-center">
    <FileText class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
    <h3 class="mb-2 text-lg font-medium">
        {{ searchKeyword.trim() ? '未找到相关法律法规' : '当前筛选条件下没有法律法规' }}
    </h3>
    <p class="mb-4 text-sm text-muted-foreground">请尝试调整搜索条件</p>
    <Button variant="outline" @click="handleReset">重置筛选</Button>
</div>
```

- [ ] **Step 9: typecheck**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 10: Commit**

```bash
git add app/pages/dashboard/legal/index.vue
git commit -m "feat(legal): 搜全文 tab 默认按发布日期倒序加载 + 热门检索动态化"
```

---

## Task 11：浏览器端 E2E 自检

**Files:**（无新增文件，使用 chrome-devtools MCP 工具）

- [ ] **Step 1: 启动 dev 服务（如 Task 8 已起则跳过）**

Run: `bun dev`（后台）

- [ ] **Step 2: 用 chrome-devtools 打开 /dashboard/legal**

调用 `mcp__chrome-devtools__new_page` 打开 `http://localhost:3000/dashboard/legal`，登录测试账号。

- [ ] **Step 3: 验证 1 —— 默认列表**

调用 `mcp__chrome-devtools__take_snapshot`，确认：
- 「搜全文」tab 高亮
- 「热门检索」一行渲染了 5 个胶囊按钮
- **没有**「找到 X 部法律法规」标题行
- 列表区已渲染至少 1 行法律法规，且第一行的发布日期最新

- [ ] **Step 4: 验证 2 —— 搜索后标题行回归**

调用 `mcp__chrome-devtools__fill` 在搜索框输入「民法典」，点检索按钮。
确认：「找到 X 部法律法规（耗时 X 秒）」标题行 + 排序下拉重新出现，结果非空。

- [ ] **Step 5: 验证 3 —— 重置后回到默认列表**

点「重置筛选」。确认：标题行消失，列表回到全量按发布日期倒序状态，且 URL query 已清空。

- [ ] **Step 6: 验证 4 —— 切到搜法条 tab，热搜词换组**

点「搜法条」tab。确认：
- 热门检索行的内容**可能换了**（若 article scope 库存数据不同；冷启动情况下两个 tab 都是兜底 5 个词，视觉相同也算正常）
- URL 同步带上 `?tab=article`

- [ ] **Step 7: 验证 5 —— Redis 实际写入**

Run:
```bash
docker exec -i $(docker ps --filter "name=redis" -q | head -1) redis-cli KEYS 'trending:bucket:*'
```
Expected: 至少 1 个 key（今天的桶，含刚搜的「民法典」）。

```bash
docker exec -i $(docker ps --filter "name=redis" -q | head -1) redis-cli ZRANGE trending:bucket:legal:$(date +%Y%m%d) 0 -1 WITHSCORES
```
Expected: 看到 `民法典 1`。

- [ ] **Step 8: 验证 6 —— DB 实际写入**

Run:
```bash
docker exec -i $(docker ps --filter "name=postgres" -q | head -1) \
  psql -U daixin -d ls_new -c \
  "SELECT scope, keyword, user_id, result_count, jsonb_array_length(result_ids->'ids') as ids_n FROM legal_search_logs ORDER BY created_at DESC LIMIT 3"
```
Expected: 看到刚搜的「民法典」一行，scope='legal'，result_count = 实际命中数，ids_n ≤ 20。

- [ ] **Step 9: 关掉 dev 服务**

如果是 Task 8 起的 bun dev，自检完成后停掉。

- [ ] **Step 10: 全量回归测试**

Run: `bun run test:server`
Expected: 全部通过（重点关注 legal 目录下的测试）。

> 若全量出现非 legal 测试的偶发 `database ls_test_wN does not exist`，按 memory 中 `project_test_suite_worker_db_fragility` 的指引单独重跑可疑文件判断真伪。

- [ ] **Step 11: typecheck 兜底**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 12: 最终 commit（如有 E2E 期间产生的小修复）**

如有：
```bash
git add <files>
git commit -m "fix(legal): E2E 自检发现的回归修复"
```

否则跳过。

---

## 完成标准

- [ ] 所有 11 个 Task 的步骤全部勾选完成
- [ ] `bun run test:server` 全绿
- [ ] `bun run typecheck` 0 errors
- [ ] chrome-devtools E2E 6 个验证场景全部通过
- [ ] dev 库 + seedData.sql 中均能查到新的 api_permission 与 role_permission 行
