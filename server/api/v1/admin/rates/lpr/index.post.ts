/**
 * POST /api/v1/admin/rates/lpr
 *
 * 管理端：新增 LPR 利率记录。
 * 权限由 server/middleware/03.permission.ts 统一 RBAC 拦截。
 */
import { z } from 'zod'
import { createLPRRateService } from '~~/server/services/rates/rates.service'

const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
    oneYear: z.number().min(0).max(99.9999),
    fiveYear: z.number().min(0).max(99.9999),
    remark: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const result = schema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]!.message)

    try {
        const data = await createLPRRateService(result.data)
        return resSuccess(event, '创建成功', data)
    } catch (err: any) {
        logger.error('[admin] 创建 LPR 失败', err)
        return resError(event, 500, '创建失败')
    }
})
