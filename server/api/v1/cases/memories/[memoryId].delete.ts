/**
 * DELETE /api/v1/cases/memories/:memoryId
 *
 * 严格限制：仅 source='manual_user' + 案件 owner 可删。
 * 软删：jsonb_set(metadata, '{invalidatedAt}', now)，与 LangChain 同构表对齐。
 */
import { softDeleteMemoryDAO } from '~~/server/services/memory/memory.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const memoryId = getRouterParam(event, 'memoryId')
    if (!memoryId) return resError(event, 400, '记忆 ID 缺失')

    // 查记忆元数据：caseId + source
    const rows = await prisma.$queryRawUnsafe<Array<{ caseId: number | null; source: string | null }>>(
        `SELECT (metadata->>'caseId')::int as "caseId", metadata->>'source' as "source"
         FROM case_memories WHERE id = $1::uuid`,
        memoryId,
    )
    if (rows.length === 0) return resError(event, 404, '记忆不存在')

    const { caseId, source } = rows[0]!
    if (source !== 'manual_user') {
        return resError(event, 403, '该记忆不可删除（仅可删除自己手动添加的）')
    }

    if (!caseId) return resError(event, 500, '记忆数据异常：缺 caseId')

    // 校验案件 owner
    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '关联案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权操作该案件')

    await softDeleteMemoryDAO(memoryId)
    return resSuccess(event, '删除成功', { id: memoryId })
})
