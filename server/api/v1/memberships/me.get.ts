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
        // 获取当前用户（从认证中间件获取）
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }
        const userId = user.id

        // 获取用户当前有效会员
        const membership = await getCurrentMembershipService(userId)

        // 如果没有会员,返回 null
        if (!membership) {
            return resSuccess(event, '获取会员信息成功', null)
        }

        // 返回简化的会员信息,包含 expiresAt 字段
        return resSuccess(event, '获取会员信息成功', {
            levelId: membership.levelId,
            levelName: membership.levelName,
            expiresAt: membership.endDate, // endDate 已经是格式化后的字符串
        })
    } catch (error) {
        logger.error('获取当前用户会员信息失败：', error)
        return resError(event, 500, '获取会员信息失败')
    }
})
