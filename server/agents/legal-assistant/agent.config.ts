/**
 * legal-assistant vertical（通用问答）Agent 配置
 *
 * 使用 defineDomainAgent 工厂声明：
 * - scope: ASSISTANT（通用问答域，全局通用，无 caseId 绑定）
 * - agentType: createAgent（ReAct 循环）
 * - nodeName: assistantMain（静态节点，所有助手会话共用）
 *
 * 业务私有中间件：
 * - assistantProcessMaterial：Agent 启动前解析用户上传附件、按会话建材料并跑识别流水线，
 *   让 process_materials / search_case_materials 可读到内容。
 *
 * 平台工厂负责：
 * - 系统提示词：renderSystemPrompt(nodeConfig, ctx)
 * - 中间件：messageIntegrity + scopeGuard + pointConsumption(assistant_token)
 *   + summarization + safetyTrim + audit
 * - 工具：nodeConfig.tools（由 assistantMain 节点配置管理）
 * - skills：buildSkillsMiddlewareForNode（若节点关联则自动挂载）
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 15
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'
import {
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '~~/server/services/agent-platform/middleware/types'
import { assistantProcessMaterialMiddleware } from '~~/server/agents/legal-assistant/assistantProcessMaterial.middleware'

export const legalAssistantAgent = defineDomainAgent({
    scope: SessionScope.ASSISTANT,
    agentType: 'createAgent',
    nodeName: 'assistantMain',
    description: '通用问答（assistantMain 节点）',

    /**
     * 业务私有中间件：
     * - assistantProcessMaterial（priority=PROCESS_MATERIAL=10）：Agent 启动前解析用户
     *   上传附件、按会话建材料并跑识别流水线，让 process_materials /
     *   search_case_materials 可读到内容。
     */
    customMiddlewares: async (ctx) => [
        {
            middleware: assistantProcessMaterialMiddleware(ctx.userId, ctx.sessionId, ctx.runId),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.ASSISTANT_PROCESS_MATERIAL,
        },
    ],
})
