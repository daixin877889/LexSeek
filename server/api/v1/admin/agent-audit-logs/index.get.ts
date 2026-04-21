/**
 * GET /api/v1/admin/agent-audit-logs
 *
 * 列表查询 + 分页 + 筛选。super_admin 独占（由 server/middleware/03.permission.ts 拦截）。
 */

import { z } from 'zod'
import type { AgentAuditRecord } from '#shared/types/agentAudit'

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.coerce.number().int().optional(),
    toolName: z.string().max(64).optional(),
    verdict: z.enum(['allowed', 'denied', 'error']).optional(),
    caseId: z.coerce.number().int().optional(),
    sessionId: z.string().max(128).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default defineEventHandler(async (event) => {
    const raw = getQuery(event)
    const parsed = querySchema.safeParse(raw)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }
    const { page, pageSize, userId, toolName, verdict, caseId, sessionId, from, to } = parsed.data

    const where: Record<string, unknown> = {}
    if (userId !== undefined) where.userId = userId
    if (toolName) where.toolName = toolName
    if (verdict) where.verdict = verdict
    if (caseId !== undefined) where.caseId = caseId
    if (sessionId) where.sessionId = sessionId
    if (from || to) {
        const createdAt: Record<string, Date> = {}
        if (from) createdAt.gte = new Date(`${from}T00:00:00+08:00`)
        if (to) {
            const end = new Date(`${to}T00:00:00+08:00`)
            end.setDate(end.getDate() + 1)
            createdAt.lt = end
        }
        where.createdAt = createdAt
    }

    const [items, total] = await Promise.all([
        prisma.agentToolAuditLogs.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.agentToolAuditLogs.count({ where }),
    ])

    const payload: { items: AgentAuditRecord[], total: number, page: number, pageSize: number } = {
        items: items.map(r => ({
            id: r.id,
            userId: r.userId,
            sessionId: r.sessionId,
            caseId: r.caseId,
            runId: r.runId,
            toolName: r.toolName,
            verdict: r.verdict as AgentAuditRecord['verdict'],
            denyReason: r.denyReason,
            argsDigest: r.argsDigest as Record<string, unknown>,
            latencyMs: r.latencyMs,
            createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
    }
    return resSuccess(event, '查询成功', payload)
})
