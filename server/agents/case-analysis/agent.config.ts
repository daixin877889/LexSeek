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
    // ⚠️ 占位 nodeName：仅给平台 runStateGraphAgent 预加载一次 nodeConfig 用，
    // runStateGraph 内部完全不读 ctx.nodeConfig（直接委托 startCaseAnalysisV2），
    // 主图 createAnalysisNode 内部按 agentName 各自加载 7 个分析节点配置。
    //
    // 选 'caseInfoCheck' 因为：
    //   - 它是 priority=10 的真实 analysis 节点（前置数据校验，独立路径）
    //   - 不在主图 selectedModules 默认列表里（不参与 ReAct 循环）
    //   - 不会引发 nodeConfig 缓存错位 / 工具加载副作用
    //
    // 风险：如未来有别处代码按 nodeName='caseInfoCheck' 调 createAgent 路径会拿到
    // 一个不该用于聊天的节点配置。caseInfoCheck 节点 description 已加占位说明做防御。
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
