/**
 * 把 CASE+ANALYSIS legacy runner 注册到 AgentRegistry。
 *
 * 阶段 2：其余 5 个业务 vertical（document/assistant/contract/case-main/case-module）
 * 已迁移至 defineDomainAgent 工厂，本文件只保留尚未完成阶段 8 迁移的
 * caseAnalysisV2（CASE, ANALYSIS）entry。
 *
 * 阶段 8 完成后本文件整体删除。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md T18
 */

import { agentRegistry } from './agentRegistry'
import type { AgentRunnerContext } from './types'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

let registered = false

/**
 * 注册 CASE+ANALYSIS legacy runner（caseAnalysisV2）。
 * 重复调用会被幂等保护（仅首次生效）。
 */
export function registerLegacyRunners(): void {
    if (registered) return
    registered = true

    // ── 案件初分（StateGraph，阶段 8 前暂保留）──
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
}
