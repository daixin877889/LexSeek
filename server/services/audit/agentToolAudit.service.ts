/**
 * Agent 工具审计日志写入服务
 *
 * 独立服务层便于中间件 vi.mock；不放在 middleware 内部直接调 prisma，
 * 是因为自动导入的 prisma 无法用 vi.mock 替换。
 */

import { uuidv7 } from '~~/shared/utils/uuid'
import { Prisma } from '~~/generated/prisma/client'
import type { AgentAuditRecord, AgentAuditVerdict } from '#shared/types/agentAudit'

/** 写入请求参数（中间件构造） */
export interface WriteAgentToolAuditLogInput {
    userId: number
    sessionId: string
    caseId: number | null
    runId: string | null
    toolName: string
    verdict: AgentAuditVerdict
    denyReason: string | null
    argsDigest: Record<string, unknown>
    latencyMs: number
}

/**
 * 异步写一条审计记录。
 */
export async function writeAgentToolAuditLogService(input: WriteAgentToolAuditLogInput): Promise<AgentAuditRecord> {
    const record = await prisma.agentToolAuditLogs.create({
        data: {
            id: uuidv7(),
            userId: input.userId,
            sessionId: input.sessionId,
            caseId: input.caseId,
            runId: input.runId,
            toolName: input.toolName,
            verdict: input.verdict,
            denyReason: input.denyReason,
            argsDigest: input.argsDigest as Prisma.InputJsonValue,
            latencyMs: input.latencyMs,
        },
    })
    return {
        id: record.id,
        userId: record.userId,
        sessionId: record.sessionId,
        caseId: record.caseId,
        runId: record.runId,
        toolName: record.toolName,
        verdict: record.verdict as AgentAuditVerdict,
        denyReason: record.denyReason,
        argsDigest: record.argsDigest as Record<string, unknown>,
        latencyMs: record.latencyMs,
        createdAt: record.createdAt.toISOString(),
    }
}
