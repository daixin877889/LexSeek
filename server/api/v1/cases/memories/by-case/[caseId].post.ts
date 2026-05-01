/**
 * POST /api/v1/cases/memories/by-case/:caseId
 *
 * 用户手动添加案件记忆（source=manual_user）。
 * subjectKey 留空时调 caseMemorySubjectInfer 节点推断；推断失败 fallback null。
 * 归档案件由 writeMemoryService 内部 assertCaseWritableService 拒绝（403）。
 */
import { z } from 'zod'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'
import { findActiveMemoryBySubjectDAO } from '~~/server/services/memory/memory.dao'

const bodySchema = z.object({
    text: z.string().min(5, '内容至少 5 字'),
    kind: z.enum(['fact', 'event', 'decision', 'note']),
    subjectKey: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseId = Number(getRouterParam(event, 'caseId'))
    if (!caseId || Number.isNaN(caseId)) return resError(event, 400, '案件 ID 非法')

    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权操作该案件')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    let subjectKey: string | null = parsed.data.subjectKey ?? null
    if (!subjectKey) {
        subjectKey = await inferSubjectKeyService(parsed.data.text)
    }

    // assertCaseWritableService 内部已查归档状态（writeMemoryService 内调用）
    const { id } = await writeMemoryService({
        caseId,
        kind: parsed.data.kind,
        text: parsed.data.text,
        subjectKey: subjectKey ?? undefined,
        source: 'manual_user',
    })

    // 回查完整记录返回（前端立即更新时间线）
    const fresh = subjectKey ? await findActiveMemoryBySubjectDAO(caseId, subjectKey) : null
    return resSuccess(event, '添加成功', {
        id,
        text: parsed.data.text,
        kind: parsed.data.kind,
        subjectKey,
        source: 'manual_user',
        createdAt: fresh?.metadata.createdAt ?? new Date().toISOString(),
        invalidatedAt: null,
    })
})
