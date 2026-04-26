import { deleteLegalMainService } from '~~/server/services/legal/legalMain.service'
/**
 * 删除法律法规（软删除）
 * DELETE /api/v1/admin/legal-main/:id
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
        return resError(event, 400, '无效的法律法规 ID')
    }

    try {
        // 调用服务层删除
        await deleteLegalMainService(id)
        logger.info(`用户 ${user.id} 删除了法律法规: ${id}`)
        return resSuccess(event, '删除成功', null)
    } catch (error) {
        const message = error instanceof Error ? error.message : '删除失败'
        if (message.includes('不存在')) {
            return resError(event, 404, message)
        }
        return resError(event, 400, message)
    }
})
