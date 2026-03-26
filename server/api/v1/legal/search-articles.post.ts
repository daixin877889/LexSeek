/**
 * 法条搜索 API
 * POST /api/v1/legal/search-articles
 *
 * 复用现有的向量搜索服务进行法条内容搜索
 */

import { z } from 'zod'
import type { ArticleSearchResponse, ValidityStatus } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'
import { searchLawService } from '../../../services/legal/searchLaw.tool'

// 请求参数验证
const requestSchema = z.object({
    query: z.string().min(1, '搜索查询不能为空').max(500, '搜索查询过长'),
    legalType: z.nativeEnum(LegalType).optional(),
    // 生效状态：all-全部, valid-现行有效, pending-尚未生效, invalid-已失效
    validityStatus: z.enum(['all', 'valid', 'pending', 'invalid']).optional().default('valid'),
    limit: z.number().int().min(1).max(100).optional().default(10),
})

/**
 * 根据生效状态转换为搜索服务参数
 * @param validityStatus 生效状态
 * @returns validOnly 参数（true: 仅有效, false: 仅无效, undefined: 全部）
 */
function convertValidityStatus(validityStatus: ValidityStatus): boolean | undefined {
    switch (validityStatus) {
        case 'valid':
            return true // 现行有效
        case 'invalid':
            return false // 已失效
        case 'pending':
        case 'all':
        default:
            return undefined // 全部（pending 暂时也返回全部，后续可优化）
    }
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取请求体
        const body = await readBody(event)
        const result = requestSchema.safeParse(body)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0]!!.message)
        }

        const { query, legalType, validityStatus, limit } = result.data

        // 转换生效状态为搜索服务参数
        const validOnly = convertValidityStatus(validityStatus)

        // 调用搜索服务
        const searchResult = await searchLawService({
            query,
            legalType,
            validOnly,
            limit,
        })

        // 格式化响应
        const response: ArticleSearchResponse = {
            items: searchResult.items,
            total: searchResult.total,
        }

        return resSuccess(event, '搜索成功', response)
    } catch (error) {
        logger.error('法条搜索失败:', error)
        return resError(event, 500, '搜索失败')
    }
})