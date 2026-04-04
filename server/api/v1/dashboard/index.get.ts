import { getDashboardData } from '~~/server/services/dashboard.service'

/**
 * 获取 Dashboard 数据
 *
 * GET /api/v1/dashboard
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        const data = await getDashboardData(user.id)
        return resSuccess(event, '获取成功', data)
    } catch (error) {
        logger.error('获取 Dashboard 数据失败:', error)
        return resError(event, 500, '获取 Dashboard 数据失败')
    }
})
