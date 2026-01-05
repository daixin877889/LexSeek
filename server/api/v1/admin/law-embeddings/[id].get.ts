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

        // 直接返回数据库中的 snake_case 格式数据
        const info: LawEmbeddingInfo = {
            id: row.id,
            text: row.text,
            metadata: row.metadata,
            lastEmbeddingAt: row.metadata?.last_embedding_at || null,
        }

        return resSuccess(event, '获取成功', info)
    } catch (error) {
        const message = error instanceof Error ? error.message : '获取失败'
        logger.error(`获取嵌入详情失败: ${message}`)
        return resError(event, 500, message)
    }
})
