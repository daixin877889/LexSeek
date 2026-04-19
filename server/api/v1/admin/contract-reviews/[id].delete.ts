/**
 * DELETE /api/v1/admin/contract-reviews/:id
 *
 * 管理端软删合同审查。权限由 03.permission 中间件统一拦截。
 * 幂等：已删记录返回 alreadyDeleted=true；正常记录写入 deletedAt 并返回 alreadyDeleted=false。
 *
 * **Feature: contract-review-m6.1b**
 */
import { softDeleteAdminReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, '审查 ID 无效')
    }

    try {
        const result = await softDeleteAdminReviewDAO(id)
        if (result.status === 'not_found') {
            return resError(event, 404, '审查记录不存在')
        }
        return resSuccess(event, '删除成功', {
            id,
            alreadyDeleted: result.status === 'already_deleted',
        })
    } catch (error) {
        logger.error('[admin] 删除合同审查失败', {
            id,
            adminUserId: user.id,
            error: error instanceof Error ? error.message : String(error),
        })
        return resError(event, 500, '删除失败')
    }
})
