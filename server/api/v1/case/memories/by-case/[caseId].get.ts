/**
 * GET /api/v1/case/memories/by-case/:caseId
 *
 * 案件记忆时间线列表（按 createdAt 倒序，游标分页）。
 * 权限：仅案件 owner（归档案件允许查，与 search_case_memory 一致）。
 */
import { z } from 'zod'
import { listMemoriesDAO } from '~~/server/services/memory/memory.dao'

const querySchema = z.object({
    source: z.enum(['manual', 'consolidator', 'auto_extract', 'manual_user']).optional(),
    includeInvalidated: z.coerce.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseIdParam = getRouterParam(event, 'caseId')
    const caseId = Number(caseIdParam)
    if (!caseId || Number.isNaN(caseId)) {
        return resError(event, 400, '案件 ID 非法')
    }

    // 权限：owner-only（归档案件允许查）
    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权访问该案件')

    const queryRaw = getQuery(event)
    const parsed = querySchema.safeParse(queryRaw)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]!.message)
    }

    const result = await listMemoriesDAO(caseId, parsed.data)
    return resSuccess(event, '查询成功', result)
})
