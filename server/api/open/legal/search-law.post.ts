/**
 * 对外法条搜索 API（apiKey 鉴权）
 * POST /api/open/legal/search-law
 *
 * 第三方通过 apikey 请求头调用。鉴权由 server/middleware/02.auth.ts 完成。
 * 限流：每分钟 60 次 + 每小时 100 次（按用户计数）。结果 Redis 缓存 1 小时。
 */
import crypto from 'node:crypto'
import { z } from 'zod'
import { LegalType } from '#shared/types/legal'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'
import type { ArticleSearchResponse, ValidityStatusFilter } from '#shared/types/legal-search'
import { searchLawService } from '~~/server/services/legal/searchLaw.tool'
import { checkRateLimit } from '~~/server/utils/rateLimit'
import { getRedisClient } from '~~/server/lib/redis'

/** 限流窗口（移植自旧项目：每分钟 60、每小时 100） */
const RATE_LIMIT_MINUTE = { windowMs: 60_000, maxRequests: 60 }
const RATE_LIMIT_HOUR = { windowMs: 3_600_000, maxRequests: 100 }
/** 搜索结果缓存时长（秒） */
const CACHE_TTL_SECONDS = 3600

const requestSchema = z.object({
    query: z.string().min(1, '搜索查询不能为空').max(500, '搜索查询过长'),
    legalType: z.nativeEnum(LegalType).optional(),
    validityStatus: z.enum(VALIDITY_STATUS_FILTERS).optional().default('valid'),
    limit: z.number().int().min(1).max(100).optional().default(10),
})

/** 生效状态 → 搜索服务的 validOnly 参数 */
function convertValidityStatus(status: ValidityStatusFilter): boolean | undefined {
    if (status === 'valid') return true
    if (status === 'invalid') return false
    return undefined
}

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    // 限流：每分钟 + 每小时双窗口，按用户计数
    const windows = [
        ['ratelimit:open:searchLaw:minute', RATE_LIMIT_MINUTE],
        ['ratelimit:open:searchLaw:hour', RATE_LIMIT_HOUR],
    ] as const
    for (const [keyPrefix, window] of windows) {
        const rl = await checkRateLimit(keyPrefix, user.id, window)
        setResponseHeader(event, 'X-RateLimit-Limit', String(rl.limit))
        setResponseHeader(event, 'X-RateLimit-Remaining', String(rl.remaining))
        setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)))
        if (!rl.allowed) {
            setResponseHeader(event, 'Retry-After', Math.max(0, Math.ceil((rl.resetAt - Date.now()) / 1000)))
            return resError(event, 429, '请求过于频繁，请稍后再试')
        }
    }

    // 参数校验
    const body = await readBody(event)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)
    const { query, legalType, validityStatus, limit } = parsed.data

    // Redis 结果缓存（key = 请求参数 md5）
    const cacheKey = `cache:open:searchLaw:${crypto.createHash('md5').update(JSON.stringify(parsed.data)).digest('hex')}`
    const redis = getRedisClient()
    try {
        const cached = await redis.get(cacheKey)
        if (cached) return resSuccess(event, '搜索成功', JSON.parse(cached) as ArticleSearchResponse)
    } catch (error) {
        logger.warn('对外法条搜索读缓存失败', error)
    }

    try {
        const searchResult = await searchLawService({
            query,
            legalType,
            validOnly: convertValidityStatus(validityStatus),
            limit,
        })
        const response: ArticleSearchResponse = {
            items: searchResult.items,
            total: searchResult.total,
        }
        try {
            await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SECONDS)
        } catch (error) {
            logger.warn('对外法条搜索写缓存失败', error)
        }
        return resSuccess(event, '搜索成功', response)
    } catch (error) {
        logger.error('对外法条搜索失败:', error)
        return resError(event, 500, '搜索失败')
    }
})
