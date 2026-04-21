/**
 * GET /api/v1/admin/agent-audit-logs/stats
 *
 * 返回今日 / 近 7 天的 verdict 分布。super_admin 独占。
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { AgentAuditStatsPayload } from '#shared/types/agentAudit'

dayjs.extend(utc)
dayjs.extend(timezone)

async function countByVerdict(since: Date) {
    const rows = await prisma.agentToolAuditLogs.groupBy({
        by: ['verdict'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
    })
    const base = { allowed: 0, denied: 0, error: 0 }
    for (const row of rows) {
        if (row.verdict === 'allowed' || row.verdict === 'denied' || row.verdict === 'error') {
            base[row.verdict] = row._count._all
        }
    }
    return base
}

export default defineEventHandler(async (event) => {
    const tz = 'Asia/Shanghai'
    const todayStart = dayjs.tz(dayjs(), tz).startOf('day').toDate()
    const weekStart = dayjs.tz(dayjs(), tz).subtract(6, 'day').startOf('day').toDate()

    const [today, last7d] = await Promise.all([
        countByVerdict(todayStart),
        countByVerdict(weekStart),
    ])

    const payload: AgentAuditStatsPayload = { today, last7d }
    return resSuccess(event, '查询成功', payload)
})
