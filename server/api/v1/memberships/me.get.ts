/**
 * 获取当前用户会员信息
 *
 * GET /api/v1/memberships/me
 *
 * 返回当前登录用户的有效会员信息
 */
// import { getCurrentMembershipService } from '~/server/services/membership/userMembership.service'

export default defineEventHandler(async (event) => {
    try {
        // 获取当前用户 ID（从认证中间件获取）
        const userId = event.context.auth?.userId
        if (!userId) {
            return resError(event, 401, '请先登录')
        }

        // 获取用户当前有效会员
        const membership = await getCurrentMembershipService(userId)

        return resSuccess(event, '获取会员信息成功', membership)
    } catch (error) {
        logger.error('获取当前用户会员信息失败：', error)
        return resError(event, 500, '获取会员信息失败')
    }
})
