/**
 * 计算会员升级价格 API
 *
 * 计算升级到指定级别的价格和积分补偿
 * 支持传入 membershipId 参数指定要升级的会员记录
 */
import { z } from 'zod'
// import { calculateUpgradePriceService } from '~/server/services/membership/membershipUpgrade.service'

// 请求参数验证
const bodySchema = z.object({
    targetLevelId: z.number().int().positive({ message: '目标级别 ID 必须为正整数' }),
    membershipId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求参数
    const body = await readBody(event)
    const parseResult = bodySchema.safeParse(body)

    if (!parseResult.success) {
        return resError(event, 400, parseResult.error.issues[0].message)
    }

    const { targetLevelId, membershipId } = parseResult.data

    try {
        const result = await calculateUpgradePriceService(user.id, targetLevelId, membershipId)

        if (!result.success) {
            return resError(event, 400, result.errorMessage || '计算升级价格失败')
        }

        return resSuccess(event, '计算成功', result.result)
    } catch (error) {
        logger.error('计算升级价格失败：', error)
        return resError(event, 500, '计算升级价格失败')
    }
})
