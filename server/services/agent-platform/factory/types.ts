/**
 * defineDomainAgent 工厂类型定义
 *
 * 业务 vertical 通过 defineDomainAgent 声明 Agent 配置，工厂内部统一处理
 * 节点加载、prompt 渲染、skills 挂载、SSE 流构造等平台职责。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3
 */

import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type { MiddlewareWithPriority } from '~~/server/services/agent-platform/middleware/types'
import type { AgentRunner, AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import type { Tool } from '@langchain/core/tools'

/** Agent 类型：createAgent（ReAct 循环）或 stateGraph（自定义图） */
export type DomainAgentType = 'createAgent' | 'stateGraph'

/** 业务 vertical 的 Agent 声明 */
export interface DomainAgentDefinition {
    /** 路由身份，用于 AgentRegistry 分发 */
    scope: SessionScope
    /** 仅 case scope 下需要 type 二级路由；其他 scope 不传 */
    type?: SessionType | null
    /** Agent 类型 */
    agentType: DomainAgentType
    /** 关联节点 nodes.name；提示词/模型/工具/skills 都从此节点读取 */
    nodeName: string
    /** 业务私有中间件（与平台通用中间件按 priority 合并） */
    customMiddlewares?: (ctx: AgentRunnerContext) => Promise<MiddlewareWithPriority[]>
    /** 业务私有工具（与节点 tools + skill 工具合并；同名以业务工具胜出） */
    customTools?: (ctx: AgentRunnerContext) => Promise<Tool[]>
    /** 生命周期钩子 */
    hooks?: {
        /** 运行前钩子，可用于上下文预热、参数校验等 */
        beforeRun?: (ctx: AgentRunnerContext) => Promise<void>
        /** 运行后钩子，success 标记本次 run 是否正常结束 */
        afterRun?: (ctx: AgentRunnerContext, success: boolean) => Promise<void>
    }
    /** 仅 stateGraph 类型使用：自定义图运行入口，返回 SSE ReadableStream */
    runStateGraph?: (ctx: AgentRunnerContext) => Promise<ReadableStream>
    /** 描述信息（admin 面板 / introspection 用途） */
    description?: string
}

/** defineDomainAgent 返回值：定义 + runner（已注册到 AgentRegistry） */
export interface DomainAgent {
    definition: DomainAgentDefinition
    runner: AgentRunner
}
