/**
 * Agent Registry 类型定义
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.3
 */

import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type { Command } from '@langchain/langgraph'

/** Runner 调用上下文：来自 agentRuns + caseSessions 的合并 */
export interface AgentRunnerContext {
    /** agentRuns.id */
    runId: string
    /** caseSessions.id */
    sessionId: string
    /** caseSessions.userId（document/assistant/contract scope 必非空；case scope 也非空）*/
    userId: number
    /** caseSessions.caseId（仅 case scope 非空）*/
    caseId: number | null
    /** 用户最新消息（resume 时为 undefined）*/
    message: string | undefined
    /** LangGraph resume 命令（非首轮时存在）*/
    command: Command | undefined
    /** extended thinking 开关 */
    thinking: boolean | undefined
    /** initAnalysis 选中模块 */
    selectedModules: string[]
    /** 取消信号（来自 agentWorker AbortController）*/
    signal: AbortSignal
    /** initAnalysis / module 等场景的额外 metadata（透传 caseSessions.metadata）*/
    metadata?: Record<string, unknown>
}

/** Runner 函数签名：返回 SSE ReadableStream */
export type AgentRunner = (ctx: AgentRunnerContext) => Promise<ReadableStream>

/** 注册项 */
export interface AgentRegistryEntry {
    scope: SessionScope
    /** 仅 case scope 时使用（按 type 二级路由）；其他 scope 应不传 */
    type?: SessionType | null
    runner: AgentRunner
    description?: string
}

/** Session 路由 key */
export interface SessionRouteKey {
    scope: SessionScope
    type?: SessionType | number | null
    caseId: number | null
    userId: number | null
}
