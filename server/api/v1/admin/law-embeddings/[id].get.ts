/**
 * 获取单个嵌入记录详情
 * GET /api/v1/admin/law-embeddings/:id
 */
import { findEmbeddingByIdDao } from '~~/server/services/legal/lawEmbeddings.dao'
import type { LawEmbeddingInfo } from '#shared/types/legal'

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id) {
        return resError(event, 400, '无效的嵌入记录 ID')
    }

    try {
        const row = await findEmbeddingByIdDao(id)
        if (!row) {
            return resError(event, 404, '嵌入记录不存在')
        }

        // 转换为前端需要的格式（数据库使用下划线命名，前端使用驼峰命名）
        const dbMetadata = row.metadata as any
        const info: LawEmbeddingInfo = {
            id: row.id,
            text: row.text,
            metadata: dbMetadata ? {
                articleId: dbMetadata.articles_id,
                legalId: dbMetadata.legal_id,
                legalName: dbMetadata.legal_name,
                legalCode: dbMetadata.document_number,
                legalType: dbMetadata.legal_type,
                articleType: dbMetadata.article_type,
                hierarchyPath: dbMetadata.chapter_hierarchy?.join(' > ') || '',
                publishDate: dbMetadata.publish_date,
                effectiveDate: dbMetadata.effective_date,
                invalidDate: dbMetadata.invalid_date,
                isValid: dbMetadata.invalid_date === null,
            } : null,
            lastEmbeddingAt: dbMetadata?.last_embedding_at || null,
        }

        return resSuccess(event, '获取成功', info)
    } catch (error) {
        const message = error instanceof Error ? error.message : '获取失败'
        logger.error(`获取嵌入详情失败: ${message}`)
        return resError(event, 500, message)
    }
})
