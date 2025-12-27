/**
 * 获取用户兑换记录
 *
 * GET /api/v1/redemption-codes/me
 *
 * 返回当前登录用户的兑换记录（分页）
 */
import dayjs from 'dayjs'
import { z } from 'zod'
import { findRedemptionRecordsByUserIdDao } from '~/server/services/redemption/redemptionRecord.dao'
import { RedemptionCodeType, type RedemptionRecordInfo } from '#shared/types/redemption'

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

        // 查询用户兑换记录
        const { list, total } = await findRedemptionRecordsByUserIdDao(userId, { page, pageSize })

        // 转换为响应格式
        const data: RedemptionRecordInfo[] = list.map((record) => ({
            id: record.id,
            userId: record.userId,
            codeId: record.codeId,
            code: record.code.code,
            type: record.code.type as RedemptionCodeType,
            levelName: record.code.level?.name || null,
            duration: record.code.duration,
            pointAmount: record.code.pointAmount,
            createdAt: dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        }))

        return resSuccess(event, '获取兑换记录成功', {
            list: data,
            total,
            page,
            pageSize,
        })
    } catch (error) {
        logger.error('获取用户兑换记录失败：', error)
        return resError(event, 500, '获取兑换记录失败')
    }
})
