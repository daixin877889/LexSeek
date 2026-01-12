/**
 * 创建积分消耗项目
 *
 * POST /api/v1/admin/point-consumption-items
 * Requirements: 17.4
 */

import { z } from 'zod'

/** 请求体验证 */
const bodySchema = z.object({
    key: z.string({ required_error: 'Key不能为空' })
        .min(1, 'Key不能为空')
        .max(50, 'Key不能超过50个字符')
        .regex(/^[a-z][a-z0-9_]*$/, 'Key只能包含小写字母、数字和下划线，且必须以字母开头'),
    group: z.string({ required_error: '分组不能为空' })
        .min(1, '分组不能为空')
        .max(100, '分组不能超过100个字符'),
    name: z.string({ required_error: '名称不能为空' })
        .min(1, '名称不能为空')
        .max(100, '名称不能超过100个字符'),
    description: z.string()
        .max(255, '描述不能超过255个字符')
        .optional()
        .nullable(),
    unit: z.string({ required_error: '单位不能为空' })
        .min(1, '单位不能为空')
        .max(10, '单位不能超过10个字符'),
    pointAmount: z.number({ required_error: '积分数量不能为空' })
        .int('积分数量必须是整数')
        .min(0, '积分数量不能为负数'),
    discount: z.number()
        .min(0, '折扣不能小于0')
        .max(1, '折扣不能大于1')
        .default(1),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .default(1),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    try {
        const item = await createPointConsumptionItemService(result.data)
        return resSuccess(event, '创建积分消耗项目成功', item)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '积分消耗项目名称已存在') {
            return resError(event, 409, error.message)
        }
        if (error.message === '积分消耗项目 Key 已存在') {
            return resError(event, 409, error.message)
        }
        if (error.message === '折扣值必须在 0-1 之间') {
            return resError(event, 400, error.message)
        }
        logger.error('创建积分消耗项目失败：', error)
        return resError(event, 500, '创建积分消耗项目失败')
    }
})
