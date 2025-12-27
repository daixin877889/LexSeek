/**
 * 执行会员升级 API
 *
 * 执行会员升级操作，需要先完成支付
 */
import { z } from 'zod'
import { executeMembershipUpgradeService } from '~/server/services/membership/membershipUpgrade.service'

// 请求参数验证
const bodySchema = z.object({
    targetLevelId: z.number().int().positive({ message: '目标级别 ID 必须为正整数' }),
    orderId: z.number().int().positive({ message: '订单 ID 必须为正整数' }),
})

export default defineEventHandler(async (event) => {
    // 获取当前用户
    const user = event.context.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求参数
    const body = await readBody(event)
    const parseResult = bodySchema.safeParse(body)

    if (!parseResult.success) {
        return resError(event, 400, parseResult.error.errors[0].message)
    }

    const { targetLevelId, orderId } = parseResult.data

    try {
        // 使用事务执行升级
        const result = await prisma.$transaction(async (tx) => {
            // 验证订单是否属于当前用户且已支付
            const order = await tx.orders.findUnique({
                where: { id: orderId, deletedAt: null },
            })

            if (!order) {
                return { success: false, errorMessage: '订单不存在' }
            }

            if (order.userId !== user.id) {
                return { success: false, errorMessage: '订单不属于当前用户' }
            }

            if (order.status !== 1) {
                return { success: false, errorMessage: '订单未支付' }
            }

            // 执行升级
            return await executeMembershipUpgradeService(
                user.id,
                targetLevelId,
                orderId,
                tx as typeof prisma
            )
        })

        if (!result.success) {
            return resError(event, 400, result.errorMessage || '升级失败')
        }

        return resSuccess(event, '升级成功', {
            membershipId: result.newMembership?.id,
        })
    } catch (error) {
        logger.error('执行会员升级失败：', error)
        return resError(event, 500, '执行会员升级失败')
    }
})
