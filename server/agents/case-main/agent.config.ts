/**
 * case-main vertical（小索）Agent 配置
 *
 * 使用 defineDomainAgent 工厂声明：
 * - scope: CASE / type: null（CASE 域默认入口，CHAT / 无 type 均命中此 runner）
 * - agentType: createAgent（ReAct 循环）
 * - nodeName: caseMain（对应 nodes 表中的配置节点）
 *
 * 业务私有中间件：
 * - caseProcessMaterialMiddleware：Agent 启动前预处理未向量化材料
 * - caseMaterialContextMiddleware：材料上下文注入（首次全量 / 增量）
 *
 * 子代理工具：
 * - createSubAgentTools：从 analysis / document 类型子节点生成专家工具
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 13
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'
import {
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '~~/server/services/agent-platform/middleware/types'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { createSubAgentTools } from '~~/server/services/agent-platform/subAgent/subAgentToolFactory'
import { getNodeConfigsByTypes } from '~~/server/services/node/node.service'

/** 子代理节点类型（与 caseMainAgent 保持一致） */
const SUB_AGENT_NODE_TYPES = ['analysis', 'document']

export const caseMainAgent = defineDomainAgent({
    scope: SessionScope.CASE,
    type: null,          // CASE 域默认 runner；type=null 作为 fallback 匹配 CHAT / 无 type 场景
    agentType: 'createAgent',
    nodeName: 'caseMain',
    description: 'Case main chat（小索）',

    /**
     * 业务私有中间件：
     * 1. caseProcessMaterial（PROCESS_MATERIAL=10）：材料预处理，优先于材料上下文注入
     * 2. caseMaterialContext（MATERIAL_CONTEXT=30）：注入材料上下文到 system prompt
     *
     * 两者均依赖 caseId，因此 case scope 请求必须携带 caseId。
     */
    customMiddlewares: async (ctx) => [
        {
            middleware: caseProcessMaterialMiddleware(ctx.userId, ctx.caseId!),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
        },
        {
            middleware: caseMaterialContextMiddleware(ctx.userId, ctx.caseId!),
            priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
            name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
        },
        {
            middleware: afterAgentMemoryMiddleware({
                caseId: ctx.caseId!,
                sessionId: ctx.sessionId,
                userId: ctx.userId,
            }),
            priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
            name: 'afterAgentMemory',
        },
    ],

    /**
     * 子代理工具：
     * 把 analysis / document 类型的节点包装成专家工具（ask_xxx_expert）。
     * 工具列表与节点配置数量动态对应，不依赖硬编码名称。
     */
    customTools: async (ctx) => {
        if (!ctx.caseId) {
            logger.warn('[case-main] customTools: caseId 为空，跳过子代理工具加载')
            return []
        }
        const subAgentConfigs = await getNodeConfigsByTypes(SUB_AGENT_NODE_TYPES)
        return createSubAgentTools(subAgentConfigs, {
            userId: ctx.userId,
            caseId: ctx.caseId,
            sessionId: ctx.sessionId,
            runId: ctx.runId,
        })
    },
})
