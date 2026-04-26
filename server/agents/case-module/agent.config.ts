/**
 * case-module vertical（模块对话）Agent 配置
 *
 * 使用 defineDomainAgent 工厂声明，通过 stateGraph 路径代理到现有
 * runModuleChat 实现，保留模块对话全部业务逻辑：
 *
 * - 5 段式 system prompt（buildSystemPromptForAgent）
 * - saveAnalysisResult 工具（需 model 实例，由 runModuleChat 内部创建）
 * - 计费 / summarization / safetyTrim 中间件栈
 * - skills 挂载（模块级单例）
 *
 * 路由绑定：scope=CASE / type=MODULE（来自 caseSessions.type === SessionType.MODULE）
 *
 * 动态节点名：从 ctx.metadata.moduleName 读取，由会话创建 API 写入。
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 14
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope, SessionType } from '#shared/types/agentEvent'
import { runModuleChat } from '~~/server/services/workflow/agents/moduleAgent'

export const caseModuleAgent = defineDomainAgent({
    scope: SessionScope.CASE,
    type: SessionType.MODULE,
    agentType: 'stateGraph',
    nodeName: (ctx) => String(ctx.metadata?.moduleName ?? ''),
    description: 'Case module chat（模块对话）',

    /**
     * stateGraph 路径：直接委托给 runModuleChat。
     *
     * runModuleChat 负责：
     * 1. 加载节点配置 + 创建 chatModel
     * 2. 构建 5 段式 system prompt（含案件材料 / 其他模块结果）
     * 3. 创建 saveAnalysisResult 工具（需 model 实例，在此内部完成）
     * 4. 组装中间件栈 + agent + 返回 SSE 流
     */
    runStateGraph: async (ctx) => {
        const moduleName = String(ctx.metadata?.moduleName ?? '')
        const nodeId = Number(ctx.metadata?.nodeId ?? 0)

        if (!moduleName) {
            throw new Error('[case-module] ctx.metadata.moduleName 缺失，请检查会话创建逻辑')
        }
        if (!ctx.caseId) {
            throw new Error('[case-module] caseId 缺失，模块对话必须在案件上下文中运行')
        }

        return runModuleChat(ctx.sessionId, ctx.message, {
            userId: ctx.userId,
            caseId: ctx.caseId,
            moduleName,
            nodeId,
            command: ctx.command,
            runId: ctx.runId,
            thinking: ctx.thinking,
            signal: ctx.signal,
        })
    },
})
