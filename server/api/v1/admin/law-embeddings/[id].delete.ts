/**
 * 删除嵌入记录
 * DELETE /api/v1/admin/law-embeddings/:id
 */
import { deleteEmbeddingByIdDao, findEmbeddingByIdDao } from '~~/server/services/legal/lawEmbeddings.dao'

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
        // 检查记录是否存在
        const existing = await findEmbeddingByIdDao(id)
        if (!existing) {
            return resError(event, 404, '嵌入记录不存在')
        }

        // 删除记录
        const success = await deleteEmbeddingByIdDao(id)
        if (!success) {
            return resError(event, 500, '删除失败')
        }

        logger.info(`用户 ${user.id} 删除了嵌入记录: ${id}`)
        return resSuccess(event, '删除成功', null)
    } catch (error) {
        const message = error instanceof Error ? error.message : '删除失败'
        logger.error(`删除嵌入记录失败: ${message}`)
        return resError(event, 500, message)
    }
})
