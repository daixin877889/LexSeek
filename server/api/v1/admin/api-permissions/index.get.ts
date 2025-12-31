/**
 * 获取 API 权限列表
 * GET /api/v1/admin/api-permissions
 */
import { z } from 'zod'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    method: z.string().optional(),
    groupId: z.coerce.number().int().optional(),
    isPublic: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    status: z.coerce.number().int().optional(),
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

    const { page, pageSize, keyword, method, groupId, isPublic, status } = result.data

    // 使用 DAO 查询
    const data = await findApiPermissionsDao(
        { keyword, method, groupId, isPublic, status },
        { page, pageSize }
    )

    return resSuccess(event, '获取成功', data)
})
