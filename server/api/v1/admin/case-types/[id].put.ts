/**
 * 更新案件类型
 *
 * PUT /api/v1/admin/case-types/:id
 * Requirements: 11.1
 */

import { z } from 'zod'
import { updateCaseTypeService } from '~~/server/services/case/caseType.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '类型名称不能为空')
        .max(100, '类型名称不能超过100个字符')
        .optional(),
    description: z.string()
        .max(255, '类型描述不能超过255个字符')
        .optional()
        .nullable(),
    icon: z.string()
        .max(100, '图标不能超过100个字符')
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
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }

    try {
        const caseType = await updateCaseTypeService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新案件类型成功', caseType)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '案件类型不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '案件类型名称已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('更新案件类型失败：', error)
        return resError(event, 500, '更新案件类型失败')
    }
})
