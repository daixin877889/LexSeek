/**
 * 获取用户会员历史记录
 *
 * GET /api/v1/memberships/history
 *
 * 返回当前登录用户的会员历史记录（分页）
 */
import { z } from 'zod'
import { getMembershipHistoryService } from '~/server/services/membership/userMembership.service'

// 查询参数验证 schema
const querySchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
    pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default('10'),
})

export default defineEventHandler(async (event) => {
    try {
        // 获取当前用户 ID（从认证中间件获取）
        const userId = event.context.auth?.userId
        if (!userId) {
            return resError(event, 401, '请先登录')
        }

        // 验证查询参数
        const query = getQuery(event)
        const result = querySchema.safeParse(query)

        if (!result.success) {
            return resError(event, 400, result.error.errors[0].message)
        }

        const { page, pageSize } = result.data

        // 获取用户会员历史记录
        const { list, total } = await getMembershipHistoryService(userId, { page, pageSize })

        return resSuccess(event, '获取会员历史记录成功', {
            list,
            total,
            page,
            pageSize,
        })
    } catch (error) {
        logger.error('获取用户会员历史记录失败：', error)
        return resError(event, 500, '获取会员历史记录失败')
    }
})
