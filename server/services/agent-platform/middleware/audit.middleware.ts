/**
 * audit 中间件
 *
 * 所有工具调用（allowed/denied/error）全部持久化到 agent_tool_audit_logs。
 * 异步写库，不阻塞业务；写库失败进 logger.error 但不抛出。
 *
 * ToolMessage 从 @langchain/core/messages 导入（canonical source；
 * langchain 根模块只是 re-export，与 scopeGuard middleware 保持一致）。
 */

import { createHash } from 'node:crypto'
import { createMiddleware } from 'langchain'
import { ToolMessage } from '@langchain/core/messages'
import { isGraphBubbleUp } from '@langchain/langgraph'
import { z } from 'zod'
import { writeAgentToolAuditLogService } from '~~/server/services/audit/agentToolAudit.service'
import { AgentAuditVerdict } from '#shared/types/agentAudit'

/** 单字符串字段最大长度（存储成本规避，非安全脱敏） */
const MAX_STRING_LENGTH = 2000

/** 摘要化工具参数：write_skill_file.content 单独 SHA 化，其他字段原样但长串截断 */
function digestArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (toolName === 'write_skill_file' && typeof args.content === 'string') {
        const sha = createHash('sha256').update(args.content).digest('hex')
        return {
            ...args,
            content: { sha256: sha, length: args.content.length },
        }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string' && v.length > MAX_STRING_LENGTH) {
            out[k] = v.slice(0, MAX_STRING_LENGTH)
        } else {
            out[k] = v
        }
    }
    return out
}

/** 由 handler 返回的 ToolMessage 判定 verdict */
function verdictOf(result: unknown): { verdict: AgentAuditVerdict, denyReason: string | null } {
    if (result instanceof ToolMessage) {
        if (result.status === 'error') {
            const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
            // scopeGuard 的拒绝信息以 "Error: " 开头，视为 denied；其他 error 状态（如工具内部抛错）视为 error
            if (content.startsWith('Error: ')) {
                return { verdict: AgentAuditVerdict.DENIED, denyReason: content.slice('Error: '.length).slice(0, 256) }
            }
            return { verdict: AgentAuditVerdict.ERROR, denyReason: content.slice(0, 256) }
        }
    }
    return { verdict: AgentAuditVerdict.ALLOWED, denyReason: null }
}

export function createAuditMiddleware() {
    return createMiddleware({
        name: 'AuditMiddleware',
        stateSchema: z.object({
            _auditEnabled: z.boolean().default(true),
        }),
        wrapToolCall: async (request, handler) => {
            const startedAt = Date.now()
            const toolName = request.toolCall.name
            const args = (request.toolCall.args ?? {}) as Record<string, unknown>
            const rawCtx = (request.runtime as { context?: Record<string, unknown> }).context ?? {}
            const ctx = {
                userId: Number(rawCtx.userId ?? 0),
                sessionId: String(rawCtx.sessionId ?? ''),
                caseId: (rawCtx.caseId as number | null | undefined) ?? null,
                runId: (rawCtx.runId as string | null | undefined) ?? null,
            }

            type HandlerResult = Awaited<ReturnType<typeof handler>>
            let result: HandlerResult | undefined
            let thrown: unknown = null
            try {
                result = await handler(request)
            } catch (err) {
                thrown = err
            }

            const latencyMs = Date.now() - startedAt

            // LangGraph 的 bubble-up 异常（GraphInterrupt / ParentCommand）是控制流，不是真正的错误。
            // 例如 parseAndAskStance 通过 interrupt() 等待用户立场，会抛 GraphInterrupt；
            // 这种情况工具本身成功执行了，按 ALLOWED 归档。
            const isBubbleUp = thrown != null && isGraphBubbleUp(thrown)
            const { verdict, denyReason } = thrown && !isBubbleUp
                ? { verdict: AgentAuditVerdict.ERROR, denyReason: (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 256) }
                : isBubbleUp
                    ? { verdict: AgentAuditVerdict.ALLOWED, denyReason: null }
                    : verdictOf(result)

            writeAgentToolAuditLogService({
                userId: ctx.userId,
                sessionId: ctx.sessionId,
                caseId: ctx.caseId,
                runId: ctx.runId,
                toolName,
                verdict,
                denyReason,
                argsDigest: digestArgs(toolName, args),
                latencyMs,
            }).catch(err => logger.error('agent 工具审计写库失败', { err, toolName, sessionId: ctx.sessionId }))

            if (thrown) throw thrown
            return result!
        },
    })
}
