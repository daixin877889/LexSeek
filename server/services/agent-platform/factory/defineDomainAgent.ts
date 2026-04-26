/**
 * defineDomainAgent 工厂入口
 *
 * 业务 vertical 通过本函数声明 Agent 配置，工厂内部统一处理
 * 节点加载、提示词渲染、skills 挂载、SSE 流构造等平台职责，
 * 并自动注册到 agentRegistry 完成 scope → runner 路由绑定。
 *
 * 支持两种路径：
 * - createAgent：由 runtime.runDomainAgent 组装中间件 + 工具并调用 LangChain createAgent
 * - stateGraph：业务自定义图，仅需实现 runStateGraph 函数
 *
 * @example
 * ```typescript
 * export const myAgent = defineDomainAgent({
 *     scope: SessionScope.ASSISTANT,
 *     agentType: 'createAgent',
 *     nodeName: 'legalAssistant',
 *     description: '法律助手',
 * })
 * ```
 *
 * @see docs/superpowers/plans/2026-04-26-ai-unify-stage-2-factory-and-vertical.md Task 11
 */

import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { runDomainAgent } from './runtime'
import type { DomainAgentDefinition, DomainAgent } from './types'

/**
 * 注册并返回 DomainAgent。
 *
 * 调用时（模块 import 阶段）立即注册到 agentRegistry，
 * 运行时调用 runner(ctx) 执行实际 Agent 流程。
 *
 * @throws 若 stateGraph 类型未提供 runStateGraph 则立即抛错
 * @throws 若 (scope, type) 重复注册则立即抛错（agentRegistry.register 保证唯一性）
 */
export function defineDomainAgent(def: DomainAgentDefinition): DomainAgent {
    // 参数校验：stateGraph 类型必须提供 runStateGraph
    if (def.agentType === 'stateGraph' && !def.runStateGraph) {
        throw new Error(
            `[defineDomainAgent] stateGraph 类型的 Agent "${def.scope}/${def.nodeName}" 必须提供 runStateGraph 函数`,
        )
    }

    // 构建 runner
    const runner = async (ctx: Parameters<typeof runDomainAgent>[1]) => {
        if (def.agentType === 'stateGraph') {
            // stateGraph 路径：完全由业务实现，工厂不干预中间件/工具
            return def.runStateGraph!(ctx)
        }
        // createAgent 路径：由 runtime 统一处理
        return runDomainAgent(def, ctx)
    }

    // 自动注册到 AgentRegistry（scope + type 二级路由）
    agentRegistry.register({
        scope: def.scope,
        type: def.type ?? null,
        runner,
        description: def.description ?? `${def.scope}/${def.nodeName}`,
    })

    logger.info('[defineDomainAgent] 注册成功', {
        scope: def.scope,
        type: def.type ?? null,
        nodeName: def.nodeName,
        agentType: def.agentType,
    })

    return { definition: def, runner }
}
