/**
 * GET /api/v1/admin/agent-audit-logs/:id
 *
 * 单条审计记录详情。super_admin 独占（由 server/middleware/03.permission.ts 拦截）。
 */

import { z } from 'zod'

const paramSchema = z.object({ id: z.string().uuid() })

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const parsed = paramSchema.safeParse({ id })
    if (!parsed.success) return resError(event, 400, 'id 必须是 UUID')

    const record = await prisma.agentToolAuditLogs.findUnique({ where: { id: parsed.data.id } })
    if (!record) return resError(event, 404, '审计记录不存在')

    return resSuccess(event, '查询成功', {
        id: record.id,
        userId: record.userId,
        sessionId: record.sessionId,
        caseId: record.caseId,
        runId: record.runId,
        toolName: record.toolName,
        verdict: record.verdict,
        denyReason: record.denyReason,
        argsDigest: record.argsDigest,
        latencyMs: record.latencyMs,
        createdAt: record.createdAt.toISOString(),
    })
})
