/**
 * 获取法律嵌入记录列表
 * GET /api/v1/admin/law-embeddings?legalId=xxx&articleId=xxx&page=1&pageSize=20
 */
import { z } from 'zod'
import { findEmbeddingsByLegalIdDao } from '~~/server/services/legal/lawEmbeddings.dao'
import type { LawEmbeddingInfo } from '#shared/types/legal'

// 查询参数验证
const querySchema = z.object({
    legalId: z.string().min(1, '法律 ID 不能为空'),
    articleId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { legalId, articleId, page, pageSize } = result.data

    try {
        const { list, total } = await findEmbeddingsByLegalIdDao(legalId, articleId, page, pageSize)

        // 转换为前端需要的格式
        const items: LawEmbeddingInfo[] = list.map(row => {
            const metadata = row.metadata
            return {
                id: row.id,
                text: row.text,
                metadata: metadata ? {
                    articleId: metadata.articleId,
                    legalId: metadata.legalId,
                    legalName: metadata.legalName,
                    legalCode: metadata.legalCode,
                    legalType: metadata.legalType,
                    articleType: metadata.articleType,
                    hierarchyPath: metadata.hierarchyPath || '',
                    publishDate: metadata.publishDate,
                    effectiveDate: metadata.effectiveDate,
                    invalidDate: metadata.invalidDate,
                    isValid: metadata.isValid ?? (metadata.invalidDate === null),
                } : null,
                lastEmbeddingAt: (metadata as any)?.last_embedding_at || null,
            }
        })

        return resSuccess(event, '获取成功', {
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : '获取失败'
        logger.error(`获取嵌入列表失败: ${message}`)
        return resError(event, 500, message)
    }
})
