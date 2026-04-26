/**
 * 删除示范案例
 *
 * DELETE /api/v1/admin/demo-cases/:id
 * Requirements: 18.7
 */

import { z } from 'zod'
import { deleteDemoCaseService } from '~~/server/services/case/demoCase.service'

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
        await deleteDemoCaseService(result.data.id)
        return resSuccess(event, '删除示范案例成功', null)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '示范案例不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除示范案例失败：', error)
        return resError(event, 500, '删除示范案例失败')
    }
})
