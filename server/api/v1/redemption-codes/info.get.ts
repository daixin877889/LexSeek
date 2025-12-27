/**
 * 查询兑换码信息
 *
 * GET /api/v1/redemption-codes/info?code=xxx
 *
 * 返回兑换码的详细信息（不执行兑换）
 */
import { z } from 'zod'
import { getRedemptionCodeInfoService } from '~/server/services/redemption/redemption.service'

// 查询参数验证 schema
const querySchema = z.object({
    code: z.string().min(1, '兑换码不能为空').max(32, '兑换码格式错误'),
})

export default defineEventHandler(async (event) => {
    try {
        // 验证查询参数
        const query = getQuery(event)
        const result = querySchema.safeParse(query)

        if (!result.success) {
            return resError(event, 400, result.error.errors[0].message)
        }

        const { code } = result.data

        // 查询兑换码信息
        const codeInfo = await getRedemptionCodeInfoService(code)

        if (!codeInfo) {
            return resError(event, 404, '兑换码不存在')
        }

        return resSuccess(event, '获取兑换码信息成功', codeInfo)
    } catch (error) {
        logger.error('查询兑换码信息失败：', error)
        return resError(event, 500, '查询兑换码信息失败')
    }
})
