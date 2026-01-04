/**
 * 获取法律条文详情
 * GET /api/v1/admin/legal-articles/:id
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

    // 调用服务层获取详情
    const article = await getLegalArticleDetailService(id)
    if (!article) {
        return resError(event, 404, '条文不存在')
    }

    return resSuccess(event, '获取成功', article)
})
