/**
 * DELETE /api/v1/admin/rates/pboc-deposit/:id
 *
 * 管理端：软删除央行存款基准利率记录（设置 deletedAt）。
 * 权限由 server/middleware/03.permission.ts 统一 RBAC 拦截。
 */
import { deletePBOCDepositRateService } from '~~/server/services/rates/rates.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return resError(event, 400, 'id 不合法')

    try {
        await deletePBOCDepositRateService(id)
        return resSuccess(event, '删除成功', null)
    } catch (err: any) {
        logger.error('[admin] 删除 PBOC 存款利率失败', err)
        return resError(event, 500, '删除失败')
    }
})
