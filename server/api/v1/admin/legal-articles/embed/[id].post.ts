import { triggerArticleEmbeddingService } from '~~/server/services/legal/legalArticles.service'
/**
 * 手动触发条文向量化
 * POST /api/v1/admin/legal-articles/embed/:id
 */
export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id) {
        return resError(event, 400, '无效的条文 ID')
    }

    try {
        // 调用服务层触发嵌入
        await triggerArticleEmbeddingService(id)
        logger.info(`用户 ${user.id} 手动触发了条文向量化: ${id}`)
        return resSuccess(event, '向量化成功', null)
    } catch (error) {
        const message = error instanceof Error ? error.message : '向量化失败'
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
