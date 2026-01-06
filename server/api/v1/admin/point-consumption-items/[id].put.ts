/**
 * 更新积分消耗项目
 *
 * PUT /api/v1/admin/point-consumption-items/:id
 * Requirements: 17.5
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    group: z.string()
        .min(1, '分组不能为空')
        .max(100, '分组不能超过100个字符')
        .optional(),
    name: z.string()
        .min(1, '名称不能为空')
        .max(100, '名称不能超过100个字符')
        .optional(),
    description: z.string()
        .max(255, '描述不能超过255个字符')
        .optional()
        .nullable(),
    unit: z.string()
        .min(1, '单位不能为空')
        .max(10, '单位不能超过10个字符')
        .optional(),
    pointAmount: z.number()
        .int('积分数量必须是整数')
        .min(0, '积分数量不能为负数')
        .optional(),
    discount: z.number()
        .min(0, '折扣不能小于0')
        .max(1, '折扣不能大于1')
        .optional(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0].message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0].message)
    }

    try {
        const item = await updatePointConsumptionItemService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新积分消耗项目成功', item)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '积分消耗项目不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '积分消耗项目名称已存在') {
            return resError(event, 409, error.message)
        }
        if (error.message === '折扣值必须在 0-1 之间') {
            return resError(event, 400, error.message)
        }
        logger.error('更新积分消耗项目失败：', error)
        return resError(event, 500, '更新积分消耗项目失败')
    }
})
