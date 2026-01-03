/**
 * 获取当前用户的所有权益汇总
 *
 * GET /api/v1/users/benefits
 */

export default defineEventHandler(async (event) => {
    try {
        // 获取当前登录用户
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 获取用户权益汇总
        const benefits = await getUserBenefitSummaryService(user.id)

        return resSuccess(event, '获取用户权益成功', benefits)
    } catch (error) {
        logger.error('获取用户权益失败：', error)
        return resError(event, 500, parseErrorMessage(error, '获取用户权益失败'))
    }
})
