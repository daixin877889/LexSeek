/**
 * 合同审查 vertical Agent 配置
 *
 * 使用 stateGraph 路径，因为合同审查拥有自定义的 resume 逻辑
 * （interrupt 等待用户立场 → resume 后直接执行 runAnalyzeLoop，不再经 agent.stream）。
 * 阶段 4 将重写 resume 路径，届时可考虑迁移到 createAgent 路径。
 *
 * 本文件由 T18 的 agents-load.ts 插件导入后生效（agentRegistry 注册触发）。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 17
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'

export const contractAgent = defineDomainAgent({
    scope: SessionScope.CONTRACT,
    agentType: 'stateGraph',
    nodeName: 'contractReviewMain',
    description: '合同审查主 Agent（首轮 parseAndAskStance interrupt + resume 执行 runAnalyzeLoop）',
    runStateGraph: async (ctx) => {
        const { runContractReviewChat } = await import(
            '~~/server/services/workflow/agents/contractReviewMainAgent'
        )
        return runContractReviewChat(ctx.sessionId, {
            userId: ctx.userId,
            runId: ctx.runId,
            // command 来自 stance.post.ts 的 enqueueRunService input.command，
            // 格式为 { stance, partyA?, partyB? }（阶段 4 统一迁移为 LangGraph Command）
            command: ctx.command as unknown,
            signal: ctx.signal,
        })
    },
})
