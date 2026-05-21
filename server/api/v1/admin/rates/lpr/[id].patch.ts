/**
 * PATCH /api/v1/admin/rates/lpr/:id
 *
 * 管理端：更新 LPR 利率记录。
 * 权限由 server/middleware/03.permission.ts 统一 RBAC 拦截。
 */
import { z } from 'zod'
import { updateLPRRateService } from '~~/server/services/rates/rates.service'

const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD').optional(),
    oneYear: z.number().min(0).max(99.9999).optional(),
    fiveYear: z.number().min(0).max(99.9999).optional(),
    remark: z.string().nullable().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return resError(event, 400, 'id 不合法')

    const body = await readBody(event)
    const result = schema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]!.message)

    try {
        const data = await updateLPRRateService(id, result.data)
        return resSuccess(event, '更新成功', data)
    } catch (err: any) {
        logger.error('[admin] 更新 LPR 失败', err)
        return resError(event, 500, '更新失败')
    }
})
