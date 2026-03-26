/**
 * 删除案件类型
 *
 * DELETE /api/v1/admin/case-types/:id
 * Requirements: 11.1
 */

import { z } from 'zod'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        await deleteCaseTypeService(result.data.id)
        return resSuccess(event, '删除案件类型成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '案件类型不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '该案件类型正在被使用，无法删除') {
            return resError(event, 409, error.message)
        }
        logger.error('删除案件类型失败：', error)
        return resError(event, 500, '删除案件类型失败')
    }
})
