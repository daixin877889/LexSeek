/**
 * 删除案件（软删除）
 *
 * DELETE /api/v1/cases/:caseId
 */

import { z } from 'zod'
import { deleteCaseService, validateCaseAccessService } from '~~/server/services/case/case.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    caseId: z.coerce.number().int().positive('案件ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    // 验证路由参数
    const caseId = getRouterParam(event, 'caseId')
    const result = paramsSchema.safeParse({ caseId })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        // 验证用户对案件的访问权限
        await validateCaseAccessService(result.data.caseId, user.id)

        // 执行软删除
        await deleteCaseService(result.data.caseId)
        return resSuccess(event, '删除案件成功', null)
    } catch (error: any) {
        if (error.message === '案件不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }
        logger.error('删除案件失败：', error)
        return resError(event, 500, '删除案件失败')
    }
})
