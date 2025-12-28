/**
 * 兑换码兑换
 *
 * POST /api/v1/redemption-codes/redeem
 *
 * 执行兑换码兑换操作
 */
// import { z } from 'zod'
// import { redeemCodeService } from '~/server/services/redemption/redemption.service'

// 请求体验证 schema
const bodySchema = z.object({
    code: z.string().min(1, '兑换码不能为空').max(32, '兑换码格式错误'),
})

export default defineEventHandler(async (event) => {
    try {
        // 获取当前用户 ID（从认证中间件获取）
        const userId = event.context.auth?.user?.id
        if (!userId) {
            return resError(event, 401, '请先登录')
        }

        // 验证请求体
        const body = await readBody(event)
        const result = bodySchema.safeParse(body)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0].message)
        }

        const { code } = result.data

        // 执行兑换
        const redeemResult = await redeemCodeService(userId, code)

        if (!redeemResult.success) {
            return resError(event, 400, redeemResult.message || '兑换失败')
        }

        return resSuccess(event, '兑换成功', {
            membershipId: redeemResult.membershipId,
            pointRecordId: redeemResult.pointRecordId,
        })
    } catch (error) {
        logger.error('兑换码兑换失败：', error)
        return resError(event, 500, '兑换失败')
    }
})
