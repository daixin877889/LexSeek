/**
 * 文书生成 vertical Agent 配置
 *
 * 使用 stateGraph 路径，因为文书生成需要从 sessionId 反查 draft + template，
 * 动态构造 responseFormat schema（toolStrategy），以及 draftId 特化工具上下文。
 * 这些设置超出了 createAgent 路径的通用化范围，委托给 runDocumentChat 处理。
 *
 * 本文件由 T18 的 agents-load.ts 插件导入后生效（agentRegistry 注册触发）。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 16
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'

export const documentAgent = defineDomainAgent({
    scope: SessionScope.DOCUMENT,
    agentType: 'stateGraph',
    nodeName: 'documentMain',
    description: '文书生成主 Agent（标准 ReAct + skill 加载 + 三入口共享工具）',
    runStateGraph: async (ctx) => {
        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )
        return runDocumentChat(ctx.sessionId, ctx.message, {
            userId: ctx.userId,
            caseId: ctx.caseId ?? undefined,
            command: ctx.command,
            signal: ctx.signal,
        })
    },
})
