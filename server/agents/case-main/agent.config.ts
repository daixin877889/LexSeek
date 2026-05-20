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
 * - caseContextSyncMiddleware：每轮注入案件 4 段 HumanMessage（档案 + 模块摘要 + 召回记忆 + 材料清单）+ 双轨 metadata 标记
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
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { createSubAgentTools } from '~~/server/services/agent-platform/subAgent/subAgentToolFactory'
import { getNodeConfigsByTypes } from '~~/server/services/node/node.service'
import { prisma } from '~~/server/utils/db'

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
     * 1. caseProcessMaterial（PROCESS_MATERIAL=10）：材料预处理，优先于上下文注入
     * 2. caseContext（MODULE_CONTEXT=30）：5 段式上下文注入（档案 + 模块摘要 + 召回记忆 + 材料清单）
     *
     * 两者均依赖 caseId，因此 case scope 请求必须携带 caseId。
     * agentName='caseMain' 让 buildContextSegments 内部 NOT { analysisType: 'caseMain' } 不会
     * 误过滤任何分析模块（无名为 caseMain 的 analysisType），全部 7 个模块摘要都会注入。
     */
    customMiddlewares: async (ctx) => [
        {
            middleware: caseProcessMaterialMiddleware(ctx.userId, ctx.caseId!, ctx.runId, ctx.sessionId),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
        },
        {
            middleware: caseContextSyncMiddleware({
                caseId: ctx.caseId!,
                agentName: 'caseMain',
            }),
            priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
            name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
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
        // contextLabel：透传给子代理计费中间件，与主代理共享同一 contextLabel
        const caseRow = await prisma.cases.findUnique({
            where: { id: ctx.caseId },
            select: { title: true },
        }).catch(() => null)
        return createSubAgentTools(subAgentConfigs, {
            userId: ctx.userId,
            caseId: ctx.caseId,
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            // 与 case-main 主代理共享同一后缀，确保聚合行的 contextLabel 一致（runtime.ts 内 case-main 也加了 · 小索对话）
            contextLabel: `${caseRow?.title ?? `案件_${ctx.caseId}`} · 小索对话`,
        })
    },
})
