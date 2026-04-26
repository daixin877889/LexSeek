/**
 * 创建案件类型
 *
 * POST /api/v1/admin/case-types
 * Requirements: 11.1
 */

import { z } from 'zod'
import { createCaseTypeService } from '~~/server/services/case/caseType.service'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '类型名称不能为空')
        .max(100, '类型名称不能超过100个字符'),
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
        .default(100),
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
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const caseType = await createCaseTypeService(result.data)
        return resSuccess(event, '创建案件类型成功', caseType)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '案件类型名称已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('创建案件类型失败：', error)
        return resError(event, 500, '创建案件类型失败')
    }
})
