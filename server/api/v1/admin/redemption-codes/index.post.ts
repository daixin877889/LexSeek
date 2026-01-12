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
    type: z.nativeEnum(RedemptionCodeType, { message: '兑换码类型无效' }),
    quantity: z.number({ message: '数量必须是数字' }).int('数量必须是整数').min(1, '数量至少为1').max(1000, '数量最多为1000'),
    levelId: z.number({ message: '会员级别ID必须是数字' }).int('会员级别ID必须是整数').optional(),
    duration: z.number({ message: '时长必须是数字' }).int('时长必须是整数').min(1, '时长至少为1天').optional(),
    pointAmount: z.number({ message: '积分数量必须是数字' }).int('积分数量必须是整数').min(1, '积分数量至少为1').optional(),
    expiredAt: z.string().datetime('过期时间格式无效').optional(),
    remark: z.string().max(500, '备注最多500个字符').optional(),
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
