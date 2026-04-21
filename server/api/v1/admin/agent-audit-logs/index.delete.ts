/**
 * DELETE /api/v1/admin/agent-audit-logs
 *
 * 清理指定日期之前的审计记录（含边界以 00:00+08:00 为准，即"删除早于该日期凌晨的"）。
 * 分批删除避免一次锁表；每批 10_000 条。
 */

import { z } from 'zod'

const bodySchema = z.object({
    beforeDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD')
        .refine(v => !Number.isNaN(new Date(v).getTime()), '无效日期'),
})

export default defineEventHandler(async (event) => {
    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const before = new Date(`${parsed.data.beforeDate}T00:00:00+08:00`)

    let deleted = 0
    while (true) {
        const batch = await prisma.agentToolAuditLogs.findMany({
            where: { createdAt: { lt: before } },
            select: { id: true },
            take: 10_000,
        })
        if (batch.length === 0) break
        const result = await prisma.agentToolAuditLogs.deleteMany({
            where: { id: { in: batch.map(b => b.id) } },
        })
        deleted += result.count
        if (batch.length < 10_000) break
    }

    return resSuccess(event, '清理完成', { deleted })
})
