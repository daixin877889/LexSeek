/**
 * GET /api/v1/admin/document-templates
 *
 * 后台管理端列出文书模板。权限由 03.permission 中间件拦截
 * （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 *
 * 作用域约束（隐私保护）：
 *   仅返回 `scope='global'` 系统模板。用户私人模板（scope='user'）属于个人数据，
 *   不对后台开放浏览。即便入参试图指定 scope='user' 也会被强制改回 global。
 *
 * Query 参数：
 * - category: 分类 key（可选）
 * - q: 名称模糊搜索（可选）
 * - skip: 偏移量，默认 0
 * - take: 每页数量，最大 100，默认 20
 */

import { z } from 'zod'
import { listDocumentTemplatesDAO } from '~~/server/services/assistant/document/documentTemplate.dao'

const QuerySchema = z.object({
    category: z.string().optional(),
    q: z.string().optional(),
    skip: z.coerce.number().int().nonnegative().optional().default(0),
    take: z.coerce.number().int().positive().max(100).optional().default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const { category, q, skip, take } = parsed.data
        // 管理端强制 scope=global；不传 viewerUserId，DAO 对 global 模板本就不做用户维度过滤
        const result = await listDocumentTemplatesDAO({
            scope: 'global',
            category,
            q,
            skip,
            take,
        })
        return resSuccess(event, '获取模板列表成功', {
            list: result.list,
            total: result.total,
            skip,
            take,
        })
    } catch (error: any) {
        logger.error('[admin] 获取文书模板列表失败', { userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取模板列表失败')
    }
})
