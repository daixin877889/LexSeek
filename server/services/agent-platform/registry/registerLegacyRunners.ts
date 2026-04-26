/**
 * 把现有 5 个 runner 注册到 AgentRegistry。
 *
 * 阶段 1 用：把 agentWorker 中硬编码的 scope/type switch 解耦为注册表分发。
 * 阶段 2 起 defineDomainAgent 工厂会接管这些注册（按业务 vertical 自动 register），
 *        本文件届时整体删除。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.3
 */

import { agentRegistry } from './agentRegistry'
import type { AgentRunnerContext } from './types'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

let registered = false

/**
 * 注册现有 5 个 runner（实际 6 个 entry，因为 case 域有 3 种 type）。
 * 重复调用会被幂等保护（仅首次生效）。
 */
export function registerLegacyRunners(): void {
    if (registered) return
    registered = true

    // ── 文书生成 ──
    agentRegistry.register({
        scope: SessionScope.DOCUMENT,
        description: 'runDocumentChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`document session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runDocumentChat } = await import('~~/server/services/workflow/agents/documentMainAgent')
            return runDocumentChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId ?? undefined,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 法律助手 ──
    agentRegistry.register({
        scope: SessionScope.ASSISTANT,
        description: 'runAssistantChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`assistant session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runAssistantChat } = await import('~~/server/services/workflow/agents')
            return runAssistantChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                command: ctx.command,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })

    // ── 合同审查 ──
    agentRegistry.register({
        scope: SessionScope.CONTRACT,
        description: 'runContractReviewChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`contract session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
            return runContractReviewChat(ctx.sessionId, {
                userId: ctx.userId,
                runId: ctx.runId,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 案件初分（StateGraph）──
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: SessionType.ANALYSIS,
        description: 'startCaseAnalysisV2 (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')
            return startCaseAnalysisV2({
                sessionId: ctx.sessionId,
                userId: ctx.userId,
                caseId: ctx.caseId,
                selectedModules: ctx.selectedModules,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 模块对话 ──
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: SessionType.MODULE,
        description: 'runModuleChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const meta = (ctx.metadata ?? {}) as { moduleName?: string; nodeId?: number }
            if (!meta.moduleName || meta.nodeId == null) {
                throw new Error(`module session ${ctx.sessionId} 缺失 metadata.moduleName / nodeId`)
            }
            const { runModuleChat } = await import('~~/server/services/workflow/agents/moduleAgent')
            return runModuleChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId,
                moduleName: meta.moduleName,
                nodeId: meta.nodeId,
                command: ctx.command,
                runId: ctx.runId,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })

    // ── 案件主对话（默认）── 注册为 (CASE, null)，二级路由 fallback
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: null,
        description: 'runCaseChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const { runCaseChat } = await import('~~/server/services/workflow/agents')
            return runCaseChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId,
                runId: ctx.runId,
                command: ctx.command,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })
}
