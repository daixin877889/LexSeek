/**
 * 批量生成兑换码
 * POST /api/v1/admin/redemption-codes
 *
 * 使用 Zod 验证参数
 * _Requirements: 2.1-2.8_
 */
import { z } from 'zod'
import { RedemptionCodeType } from '#shared/types/redemption'

// 请求体验证
const bodySchema = z.object({
    type: z.nativeEnum(RedemptionCodeType),
    quantity: z.number().int().min(1).max(1000),
    levelId: z.number().int().optional(),
    duration: z.number().int().min(1).optional(),
    pointAmount: z.number().int().min(1).optional(),
    expiredAt: z.string().datetime().optional(),
    remark: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        const errorMsg = result.error.issues.map(i => i.message).join(', ')
        return resError(event, 400, `参数错误: ${errorMsg}`)
    }

    const { type, quantity, levelId, duration, pointAmount, expiredAt, remark } = result.data

    try {
        const data = await generateRedemptionCodesService({
            type,
            quantity,
            levelId,
            duration,
            pointAmount,
            expiredAt: expiredAt ? new Date(expiredAt) : undefined,
            remark,
        })

        logger.info(`用户 ${user.id} 生成了 ${data.count} 个兑换码`, { type, quantity })
        return resSuccess(event, `成功生成 ${data.count} 个兑换码`, data)
    } catch (error: any) {
        logger.error('生成兑换码失败：', error)
        return resError(event, 500, error.message || '生成兑换码失败')
    }
})
