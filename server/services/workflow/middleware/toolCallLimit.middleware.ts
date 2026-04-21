/**
 * toolCallLimit 中间件（数组式薄封装）
 *
 * LangChain 1.3.x 原生 toolCallLimitMiddleware 一次只能限一个工具名；
 * 对多工具分层配额必须为每个工具创建一个实例，装配时 spread 展开。
 *
 * exitBehavior 'continue'：超限后当前工具调用返回 error 结果，Agent 可继续
 * 推进其他动作（不会终止整个会话）。对齐 spec §4.3 优雅降级。
 *
 * threadLimit 按 LangGraph thread_id 计数——与 sessionId 一一对应，
 * 天然实现 spec §4.3 "per-session" 语义。
 */

import { toolCallLimitMiddleware, type AgentMiddleware } from 'langchain'
import { DEFAULT_TOOL_LIMITS, LIMITED_TOOL_NAMES } from '#shared/types/agentAudit'

/**
 * 为 LIMITED_TOOL_NAMES 中每个工具创建一个 toolCallLimitMiddleware 实例。
 * 返回数组，由 agent 装配处用 `...createToolCallLimitMiddlewares()` 展开到 middleware 数组。
 */
export function createToolCallLimitMiddlewares(): AgentMiddleware[] {
    return LIMITED_TOOL_NAMES.map(name => toolCallLimitMiddleware({
        toolName: name,
        threadLimit: DEFAULT_TOOL_LIMITS[name],
        exitBehavior: 'continue',
    }))
}
