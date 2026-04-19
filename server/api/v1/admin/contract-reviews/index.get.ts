/**
 * GET /api/v1/admin/contract-reviews
 *
 * 管理端合同审查列表。不做 owner 过滤；权限由 03.permission 中间件统一拦截
 * （非 super_admin 访问 /api/v1/admin/** 一律 403）。
 *
 * Query：
 *  - skip   int >= 0，默认 0
 *  - take   int >= 1，<= 100，默认 20
 *  - status 可选字符串（精确匹配）
 *  - q      可选字符串（模糊搜原文件名，跨用户）
 *  - userId 可选 int（按用户筛选）
 *  - includeDeleted 可选 bool（默认 false，仍过滤软删）
 *
 * 排序：createdAt desc
 *
 * **Feature: contract-review-m6.1b**
 */
import { z } from 'zod'
import { listAdminReviewsDAO } from '~~/server/services/assistant/contract/contractReview.dao'

const QuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().min(1).max(30).optional(),
    q: z.string().min(1).max(100).optional(),
    userId: z.coerce.number().int().positive().optional(),
    includeDeleted: z.coerce.boolean().optional().default(false),
}).strict()

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const { skip, take, status, q, userId, includeDeleted } = parsed.data

    try {
        const { items, total } = await listAdminReviewsDAO({
            skip,
            take,
            status,
            q,
            userId,
            includeDeleted,
        })
        return resSuccess(event, '获取成功', { items, total, skip, take })
    } catch (error: any) {
        logger.error('[admin] 获取合同审查列表失败', {
            adminUserId: user.id,
            error: error?.message,
        })
        return resError(event, 500, error?.message || '获取列表失败')
    }
})
