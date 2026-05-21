import type { benefits } from '~~/generated/prisma/client'
import { getUserBenefitsService } from '~~/server/services/membership/benefit.service'
/**
 * 获取用户权益信息
 *
 * GET /api/v1/memberships/benefits
 *
 * 返回当前登录用户的会员权益列表
 */

export default defineEventHandler(async (event) => {
    try {
        // 获取当前用户 ID（从认证中间件获取）
        const userId = event.context.auth?.user?.id
        if (!userId) {
            return resError(event, 401, '请先登录')
        }

        // 获取用户权益
        const benefits = await getUserBenefitsService(userId)

        return resSuccess(event, '获取用户权益成功', benefits)
    } catch (error) {
        logger.error('获取用户权益失败：', error)
        return resError(event, 500, '获取用户权益失败')
    }
})
