/**
 * 获取法律法规统计信息
 * GET /api/v1/admin/legal-main/:id/statistics
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

    // 调用服务层获取统计信息
    const statistics = await getLegalStatisticsService(id)
    if (!statistics) {
        return resError(event, 404, '法律法规不存在')
    }

    return resSuccess(event, '获取成功', statistics)
})
