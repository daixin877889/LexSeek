/**
 * 获取审计日志列表
 * GET /api/v1/admin/audit
 */
import { z } from 'zod'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().optional(),
    targetType: z.string().optional(),
    operatorId: z.coerce.number().int().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误')
    }

    const { page, pageSize, action, targetType, operatorId, startTime, endTime } = result.data

    // 构建查询条件
    const findQuery: any = {}
    if (action) findQuery.action = action
    if (targetType) findQuery.targetType = targetType
    if (operatorId) findQuery.operatorId = operatorId
    if (startTime) findQuery.startTime = new Date(startTime)
    if (endTime) findQuery.endTime = new Date(endTime)

    // 查询数据
    const data = await findAuditLogsDao(findQuery, { page, pageSize })

    return resSuccess(event, '获取成功', data)
})
