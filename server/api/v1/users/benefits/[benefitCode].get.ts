/**
 * 获取当前用户指定权益的详细信息
 *
 * GET /api/v1/users/benefits/:benefitCode
 */

export default defineEventHandler(async (event) => {
    try {
        // 获取当前登录用户
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 获取路由参数
        const benefitCode = getRouterParam(event, 'benefitCode')
        if (!benefitCode) {
            return resError(event, 400, '权益标识码不能为空')
        }

        // 获取用户权益详情
        const benefitDetail = await getUserBenefitDetailService(user.id, benefitCode)

        if (!benefitDetail) {
            return resError(event, 404, '权益类型不存在')
        }

        return resSuccess(event, '获取权益详情成功', benefitDetail)
    } catch (error) {
        logger.error('获取权益详情失败：', error)
        return resError(event, 500, parseErrorMessage(error, '获取权益详情失败'))
    }
})
