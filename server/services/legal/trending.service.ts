/**
 * 法律法规检索热门词服务
 *
 * 关键词归一化、Redis NX 防刷、ZUNIONSTORE 7 天滑动窗口聚合、60s 查询缓存。
 */

import dayjs from 'dayjs'
import { getRedisClient } from '~~/server/lib/redis'
import { prisma } from '~~/server/utils/db'

const MIN_LEN = 2
const MAX_LEN = 50

const DEDUPE_TTL = 30
const BUCKET_TTL = 60 * 60 * 24 * 8 // 8 天

export type TrendingScope = 'legal' | 'article'

/**
 * 关键词归一化：trim + 合并连续空白；长度 ∈ [2, 50] 且非纯标点才返回，否则 null
 */
export function normalizeKeywordService(raw: string): string | null {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim().replace(/\s+/g, ' ')
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null
    if (!/[\p{L}\p{N}]/u.test(trimmed)) return null
    return trimmed
}

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
                    resultIds: params.resultIds ?? undefined,
                },
            }),
        ])
    } catch (err) {
        logger.warn('[legal-trending] recordSearchService 失败', err)
    }
}

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
