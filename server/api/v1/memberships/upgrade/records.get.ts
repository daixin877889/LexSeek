/**
 * 获取会员升级记录 API
 *
 * 返回用户的会员升级历史记录
 */
import { z } from 'zod'
import { getUserUpgradeRecordsService } from '~/server/services/membership/membershipUpgrade.service'

// 查询参数验证
const querySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(10),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证查询参数
    const query = getQuery(event)
    const parseResult = querySchema.safeParse(query)

    if (!parseResult.success) {
        return resError(event, 400, parseResult.error.errors[0].message)
    }

    const { page, pageSize } = parseResult.data

    try {
        const { list, total } = await getUserUpgradeRecordsService(user.id, {
            page,
            pageSize,
        })

        return resSuccess(event, '获取成功', {
            list,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        })
    } catch (error) {
        logger.error('获取升级记录失败：', error)
        return resError(event, 500, '获取升级记录失败')
    }
})
