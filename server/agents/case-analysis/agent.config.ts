/**
 * 案件初分 vertical（StateGraph 形态）
 *
 * scope=CASE / type=ANALYSIS：替代阶段 2 临时的 registerLegacyRunners.ts。
 * 保留 caseAnalysisV2.workflow.ts 的主图状态机；内层 ReAct 已在阶段 8 改造为
 * runAnalysisSubAgent（复用平台中间件管道 + skillsMiddleware）。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §6 阶段 8
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

export const caseAnalysisAgent = defineDomainAgent({
    scope: SessionScope.CASE,
    type: SessionType.ANALYSIS,
    agentType: 'stateGraph',
    // priority=10 入口节点，仅供平台预加载 nodeConfig 用；
    // 主图 createAnalysisNode 内部按 agentName 各自加载 7 个分析节点配置。
    nodeName: 'caseInfoCheck',
    description: '案件初分（StateGraph + 7 个 analysis 子模块顺序执行）',
    runStateGraph: async (ctx) => {
        const { startCaseAnalysisV2 } = await import(
            '~~/server/services/workflow/caseAnalysisV2.executor'
        )
        if (ctx.caseId == null) {
            throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
        }
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
