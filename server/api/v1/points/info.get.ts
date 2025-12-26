/**
 * 获取用户积分汇总信息
 * GET /api/v1/points/info
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('points')
    const user = event.context.auth.user

    try {
        // 获取用户积分汇总
        const summary = await getUserPointSummary(user.id)

        return resSuccess(event, '获取积分信息成功', summary)
    } catch (error) {
        logger.error('获取积分信息失败：', error)
        return resError(event, 500, '获取积分信息失败')
    }
})
