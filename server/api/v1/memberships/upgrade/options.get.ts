/**
 * 获取会员升级选项 API
 *
 * 返回用户可升级的目标级别列表及升级价格
 * 支持传入 membershipId 参数指定要升级的会员记录
 */
import { z } from 'zod'
// import { getUpgradeOptionsService } from '~/server/services/membership/membershipUpgrade.service'

// 查询参数验证
const querySchema = z.object({
    membershipId: z.coerce.number().optional(),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 解析查询参数
        const query = getQuery(event)
        const { membershipId } = querySchema.parse(query)

        const { options, currentMembership } = await getUpgradeOptionsService(user.id, membershipId)

        // 如果没有当前会员
        if (!currentMembership) {
            return resSuccess(event, '获取成功', {
                currentMembership: null,
                options: [],
            })
        }

        return resSuccess(event, '获取成功', {
            currentMembership: {
                id: currentMembership.id,
                levelId: currentMembership.levelId,
                levelName: currentMembership.level.name,
                endDate: currentMembership.endDate,
                remainingDays: options.length > 0 ? options[0].remainingDays : 0,
            },
            options,
        })
    } catch (error) {
        logger.error('获取升级选项失败：', error)
        return resError(event, 500, '获取升级选项失败')
    }
})
