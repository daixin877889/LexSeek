/**
 * 更新示范案例
 *
 * PUT /api/v1/admin/demo-cases/:id
 * Requirements: 18.9
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 材料项验证 */
const materialSchema = z.object({
    name: z.string().min(1, '材料名称不能为空').max(255, '材料名称不能超过255个字符'),
    type: z.number().int().min(1).max(4),
    content: z.string().optional(),
    fileUrl: z.string().url('文件URL格式不正确').optional(),
})

/** 请求体验证 */
const bodySchema = z.object({
    title: z.string()
        .min(1, '标题不能为空')
        .max(200, '标题不能超过200个字符')
        .optional(),
    description: z.string()
        .max(500, '简介不能超过500个字符')
        .optional()
        .nullable(),
    caseTypeId: z.number()
        .int('案件类型ID必须是整数')
        .positive('案件类型ID必须是正整数')
        .optional(),
    materials: z.array(materialSchema).optional(),
    coverImage: z.string()
        .max(500, '封面图片URL不能超过500个字符')
        .optional()
        .nullable(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(0, '优先级不能为负数')
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
        const demoCase = await updateDemoCaseService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新示范案例成功', demoCase)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '示范案例不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '示范案例标题已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('更新示范案例失败：', error)
        return resError(event, 500, '更新示范案例失败')
    }
})
