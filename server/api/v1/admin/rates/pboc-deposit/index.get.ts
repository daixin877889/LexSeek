/**
 * GET /api/v1/admin/rates/pboc-deposit
 *
 * 管理端：查询全部央行存款基准利率记录。
 * 权限由 server/middleware/03.permission.ts 统一 RBAC 拦截。
 */
import { listPBOCDepositRatesService } from '~~/server/services/rates/rates.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    try {
        const data = await listPBOCDepositRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err: any) {
        logger.error('[admin] 查询 PBOC 存款利率失败', err)
        return resError(event, 500, '查询失败')
    }
})
