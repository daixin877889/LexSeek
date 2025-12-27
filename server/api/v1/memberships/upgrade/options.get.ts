/**
 * 获取会员升级选项 API
 *
 * 返回用户可升级的目标级别列表及升级价格
 */
import { z } from 'zod'
// import { getUpgradeOptionsService } from '~/server/services/membership/membershipUpgrade.service'

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        const { options, currentMembership } = await getUpgradeOptionsService(user.id)

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
