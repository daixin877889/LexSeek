/**
 * GET /api/v1/admin/contract-reviews/:id
 *
 * 管理端合同审查详情。权限由 03.permission 中间件统一拦截。
 * 允许查询已软删记录（deletedAt != null 也返回）。
 * summary 不截断；risks 原样 JSON 返回。
 *
 * **Feature: contract-review-m6.1b**
 */
import { getAdminReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '审查 ID 无效')
    }

    try {
        const detail = await getAdminReviewDAO(id)
        if (!detail) return resError(event, 404, '审查记录不存在')
        return resSuccess(event, '获取成功', detail)
    } catch (error: any) {
        logger.error('[admin] 获取合同审查详情失败', {
            id,
            adminUserId: user.id,
            error: error?.message,
        })
        return resError(event, 500, error?.message || '获取详情失败')
    }
})
